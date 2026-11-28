import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Enabling auto-forward must also send invoices that were queued as 'pending'
 * BEFORE it was turned on — not only ones that arrive afterward. runForwarding
 * promotes 'pending' forwards to 'approved' for mailboxes whose auto_forward is
 * ON (a 'pending' row already passed the confidence threshold), then sends them.
 * 'review' rows are never promoted, and auto_forward OFF leaves 'pending' alone.
 */

type Row = Record<string, unknown> & { id: string; organization_id: string; status: string; from_address: string | null; email_message_id: string; gmail_integration_id: string };

const H = vi.hoisted(() => ({
  autoForward: {} as Record<string, boolean>, // keyed by gmail_integration_id
  forwards: {} as Record<string, Row>,
}));

const api = vi.hoisted(() => ({
  gmailSend: vi.fn(async () => ({ id: "sent-1", threadId: "t1" })),
  gmailGetRaw: vi.fn(async () => Buffer.from("From: v\r\n\r\nhi", "utf8").toString("base64url")),
  gmailGetAttachment: vi.fn(async () => Buffer.from([1])),
  gmailGetMessage: vi.fn(async () => ({ id: "m", threadId: "t", payload: {} })),
}));

function seedForward(p: Partial<Row> & Pick<Row, "id" | "organization_id" | "status" | "gmail_integration_id">) {
  H.forwards[p.id] = {
    email_message_id: "em-" + p.id,
    source_gmail_message_id: "gm-" + p.id,
    destination: "fin@" + p.organization_id + ".com",
    confidence: "90.00",
    subject: "Statement",
    from_address: "<ap@vendor.com>",
    to_address: null,
    received_at: null,
    account_email: null,
    account_display_name: null,
    account_status: "connected", // a healthy account by default; the gate allows it
    organisation_name: "Org",
    classification: "general_finance", // non-invoice → GSTIN gate skipped
    is_invoice_candidate: 0,
    approved_by: null,
    forwarded_message_id: null,
    attempts: 0,
    forwarded_at: null,
    created_at: new Date(),
    last_error: null,
    ...p,
  };
}
const clone = (r: Row) => ({ ...r });

vi.mock("@/lib/invoice/db", () => ({
  isMissingTableError: () => false,
  isMissingColumnError: () => false,
  ijson: (v: unknown) => (v == null ? null : JSON.stringify(v)),
  iQuery: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("`forwarding_sender_filters`")) return [{ id: "a", kind: "allow", pattern: "vendor.com" }]; // sender allowed
    if (sql.includes("`forwarding_cc_recipients`")) return [];
    if (sql.includes("FROM `invoice_forwards` f")) {
      const org = params[0] as string;
      return Object.values(H.forwards).filter((r) => r.organization_id === org && r.status === "approved").map(clone);
    }
    if (sql.includes("`email_attachments`")) return [];
    return [];
  }),
  iQueryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM `forwarding_settings`")) return { finance_destination: "fin@x.com", min_confidence: "70.00", enabled: 1 };
    if (sql.includes("COUNT(*) c FROM `invoice_forwards`")) {
      const org = params[0] as string;
      return { c: Object.values(H.forwards).filter((r) => r.organization_id === org && ["pending", "review"].includes(r.status)).length };
    }
    if (sql.includes("FROM `forwarding_destinations`")) return null;
    return null;
  }),
  iExecute: vi.fn(async (sql: string, params: unknown[] = []) => {
    const P = params as unknown[];
    // Promotion: pending -> approved for auto_forward mailboxes.
    if (sql.includes("JOIN `gmail_integrations`") && sql.includes("SET f.`status`='approved'")) {
      const org = P[0] as string;
      for (const r of Object.values(H.forwards)) {
        if (r.organization_id === org && r.status === "pending" && H.autoForward[r.gmail_integration_id]) r.status = "approved";
      }
      return { affectedRows: 1 };
    }
    // Demotion (disable authoritative): approved(auto) -> pending when the mailbox
    // now has auto_forward OFF. Human approvals (approved_by set) are untouched.
    if (sql.includes("JOIN `gmail_integrations`") && sql.includes("SET f.`status`='pending'")) {
      const org = P[0] as string;
      for (const r of Object.values(H.forwards)) {
        if (r.organization_id === org && r.status === "approved" && r.approved_by == null && !H.autoForward[r.gmail_integration_id]) {
          r.status = "pending";
        }
      }
      return { affectedRows: 1 };
    }
    const last = P[P.length - 1] as string;
    if (sql.includes("SET `status`='sending'")) {
      const r = H.forwards[last];
      if (r && r.status === "approved") { r.status = "sending"; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (sql.includes("SET `status`='forwarded'")) {
      const r = H.forwards[last];
      if (r) { r.status = "forwarded"; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (sql.includes("SET `status`='skipped'") || sql.includes("SET `status`='review'")) {
      const r = H.forwards[last];
      if (r) { r.status = sql.includes("review") ? "review" : "skipped"; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    return { affectedRows: 1 };
  }),
}));

vi.mock("@/lib/invoice/services/gmail", () => ({ getAccountAccessToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/invoice/gmail/api", () => api);
vi.mock("@/lib/invoice/gmail/oauth", () => ({ GmailApiError: class extends Error { status = 0; } }));
vi.mock("@/lib/invoice/services/org-admin", () => ({ isOrganizationActive: vi.fn(async () => true), normalizeGstin: (s: string | null) => (s ? s.trim().toUpperCase() : null) }));
vi.mock("@/lib/invoice/audit", () => ({ logInvoiceAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/invoice/services/original-body", () => ({ buildOriginalBodyHtml: vi.fn(async () => "") }));

import { runForwarding } from "@/lib/invoice/services/forwarding";

beforeEach(() => {
  H.autoForward = {};
  H.forwards = {};
  api.gmailSend.mockClear();
});

describe("runForwarding — auto-approve for auto-forward mailboxes", () => {
  it("promotes & sends a 'pending' invoice when the mailbox has auto-forward ON", async () => {
    H.autoForward["gi-on"] = true;
    seedForward({ id: "P1", organization_id: "ORG", status: "pending", gmail_integration_id: "gi-on" });
    const r = await runForwarding("ORG");
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
    expect(r.forwarded).toBe(1);
    expect(H.forwards["P1"].status).toBe("forwarded");
  });

  it("leaves a 'pending' invoice alone when the mailbox has auto-forward OFF", async () => {
    H.autoForward["gi-off"] = false;
    seedForward({ id: "P2", organization_id: "ORG", status: "pending", gmail_integration_id: "gi-off" });
    const r = await runForwarding("ORG");
    expect(api.gmailSend).not.toHaveBeenCalled();
    expect(r.forwarded).toBe(0);
    expect(H.forwards["P2"].status).toBe("pending");
  });

  it("disable is authoritative: demotes an auto-approved-but-unsent row back to 'pending' when auto-forward is OFF", async () => {
    H.autoForward["gi-off"] = false; // mailbox auto-forward turned OFF
    // Row was auto-created 'approved' while ON (approved_by null), not yet sent.
    seedForward({ id: "P4", organization_id: "ORG", status: "approved", gmail_integration_id: "gi-off", approved_by: null });
    const r = await runForwarding("ORG");
    expect(api.gmailSend).not.toHaveBeenCalled();
    expect(r.forwarded).toBe(0);
    expect(H.forwards["P4"].status).toBe("pending");
  });

  it("disable does NOT cancel a human/agent approval (approved_by set still sends when auto-forward is OFF)", async () => {
    H.autoForward["gi-off"] = false;
    seedForward({ id: "P5", organization_id: "ORG", status: "approved", gmail_integration_id: "gi-off", approved_by: "user-1" });
    const r = await runForwarding("ORG");
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
    expect(r.forwarded).toBe(1);
    expect(H.forwards["P5"].status).toBe("forwarded");
  });

  it("never promotes a 'review' item even with auto-forward ON (still needs a human)", async () => {
    H.autoForward["gi-on"] = true;
    seedForward({ id: "P3", organization_id: "ORG", status: "review", gmail_integration_id: "gi-on" });
    const r = await runForwarding("ORG");
    expect(api.gmailSend).not.toHaveBeenCalled();
    expect(H.forwards["P3"].status).toBe("review");
    expect(r.forwarded).toBe(0);
  });
});
