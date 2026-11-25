import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * GSTIN validation gate for AUTO-forwarding GST invoices.
 *
 * A GST invoice is auto-forwarded only when its extracted BUYER GSTIN matches
 * the organisation's GSTIN. On mismatch, missing/unreadable GSTIN, or an org
 * without a GSTIN, it is held for manual review (status 'review') and never
 * auto-sent. The gate applies only to invoice-type documents, only on the AUTO
 * path (a human/agent approval carries approved_by and bypasses it), and the
 * sender allow/exclude gate still runs first.
 */

type Row = Record<string, unknown> & { id: string; organization_id: string; status: string; from_address: string | null; email_message_id: string };

const H = vi.hoisted(() => ({
  filters: {} as Record<string, { kind: "allow" | "block"; pattern: string }[]>,
  orgGstin: {} as Record<string, string | null>,
  buyerGstin: {} as Record<string, string | null>, // keyed by email_message_id
  forwards: {} as Record<string, Row>,
  columnMissing: false, // simulate invoices.buyer_gstin not migrated (012 pending)
  gstinValidation: true, // opt-in (migration 013); these tests exercise the gate ON
}));

const api = vi.hoisted(() => ({
  gmailSend: vi.fn(async () => ({ id: "sent-1", threadId: "t1" })),
  gmailGetRaw: vi.fn(async () => Buffer.from("From: v\r\n\r\nhi", "utf8").toString("base64url")),
  gmailGetAttachment: vi.fn(async () => Buffer.from([1])),
  gmailGetMessage: vi.fn(async () => ({ id: "m", threadId: "t", payload: {} })),
}));

function seedForward(p: Partial<Row> & Pick<Row, "id" | "organization_id" | "status" | "from_address"> & { classification?: string; is_invoice_candidate?: number; approved_by?: string | null }) {
  H.forwards[p.id] = {
    gmail_integration_id: "gi",
    email_message_id: "em-" + p.id,
    source_gmail_message_id: "gm-" + p.id,
    destination: "fin@" + p.organization_id + ".com",
    confidence: "90.00",
    subject: "Tax Invoice",
    to_address: null,
    received_at: null,
    account_email: null,
    organisation_name: "Org",
    classification: "supplier_invoice",
    is_invoice_candidate: 1,
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
  isMissingColumnError: (e: unknown) => {
    const err = e as { code?: string; errno?: number } | null;
    return Boolean(err && (err.code === "ER_BAD_FIELD_ERROR" || err.errno === 1054));
  },
  ijson: (v: unknown) => (v == null ? null : JSON.stringify(v)),
  iQuery: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("`forwarding_sender_filters`")) {
      const org = params[0] as string;
      return (H.filters[org] ?? []).map((f) => ({ id: `${org}:${f.kind}:${f.pattern}`, kind: f.kind, pattern: f.pattern }));
    }
    if (sql.includes("`forwarding_cc_recipients`")) return [];
    if (sql.includes("FROM `invoice_forwards` f")) {
      const org = params[0] as string;
      return Object.values(H.forwards).filter((r) => r.organization_id === org && r.status === "approved").map(clone);
    }
    if (sql.includes("`email_attachments`")) return [];
    return [];
  }),
  iQueryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM `organizations`")) {
      return { gstin: H.orgGstin[params[0] as string] ?? null };
    }
    if (sql.includes("FROM `invoices`")) {
      if (H.columnMissing) {
        const err = new Error("Unknown column 'buyer_gstin'") as Error & { code?: string };
        err.code = "ER_BAD_FIELD_ERROR";
        throw err;
      }
      const emId = params[1] as string;
      return { buyer_gstin: H.buyerGstin[emId] ?? null };
    }
    if (sql.includes("FROM `forwarding_settings`")) return { finance_destination: "fin@x.com", min_confidence: "70.00", enabled: 1, gstin_validation: H.gstinValidation ? 1 : 0 };
    if (sql.includes("FROM `invoice_forwards` f")) {
      const [org, id] = params as string[];
      const r = H.forwards[id];
      return r && r.organization_id === org ? clone(r) : null;
    }
    if (sql.includes("SELECT status FROM `invoice_forwards`")) {
      const r = H.forwards[params[0] as string];
      return r ? { status: r.status } : null;
    }
    if (sql.includes("COUNT(*) c FROM `invoice_forwards`")) return { c: 0 };
    if (sql.includes("FROM `forwarding_destinations`")) return null;
    return null;
  }),
  iExecute: vi.fn(async (sql: string, params: unknown[] = []) => {
    const P = params as unknown[];
    const last = P[P.length - 1] as string;
    if (sql.includes("SET `status`='sending'")) {
      const r = H.forwards[last];
      if (r && r.status === "approved") { r.status = "sending"; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (sql.includes("SET `status`='review'")) {
      const r = H.forwards[last];
      if (r && r.status === "approved") { r.status = "review"; r.last_error = P[0] as string; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (sql.includes("SET `status`='skipped'")) {
      const r = H.forwards[last];
      if (r && ["approved", "pending", "review", "failed"].includes(r.status)) { r.status = "skipped"; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (sql.includes("SET `status`='approved'")) {
      const r = H.forwards[last];
      if (r) { r.status = "approved"; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (sql.includes("SET `status`='forwarded'")) {
      const r = H.forwards[last];
      if (r) { r.status = "forwarded"; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    return { affectedRows: 1 };
  }),
}));

vi.mock("@/lib/invoice/services/gmail", () => ({ getAccountAccessToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/invoice/gmail/api", () => api);
vi.mock("@/lib/invoice/gmail/oauth", () => ({
  GmailApiError: class GmailApiError extends Error { status: number; constructor(m: string, s = 0) { super(m); this.status = s; } },
}));
vi.mock("@/lib/invoice/services/org-admin", async (orig) => {
  // Keep the real normalizeGstin (pure), stub isOrganizationActive.
  const actual = await orig<typeof import("@/lib/invoice/services/org-admin")>();
  return { ...actual, isOrganizationActive: vi.fn(async () => true) };
});
vi.mock("@/lib/invoice/audit", () => ({ logInvoiceAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/invoice/services/original-body", () => ({ buildOriginalBodyHtml: vi.fn(async () => "") }));

import { runForwarding, approveAndForward } from "@/lib/invoice/services/forwarding";

const actor = { id: "u1", email: "admin@atlas.edu" };

beforeEach(() => {
  H.filters = { ORG: [{ kind: "allow", pattern: "vendor.com" }] }; // sender gate passes
  H.orgGstin = { ORG: "27AAAAA0000A1Z5" };
  H.buyerGstin = {};
  H.forwards = {};
  H.columnMissing = false;
  H.gstinValidation = true;
  api.gmailSend.mockClear();
});

describe("GSTIN auto-forward gate", () => {
  it("auto-forwards a GST invoice when the buyer GSTIN matches the org GSTIN", async () => {
    seedForward({ id: "F1", organization_id: "ORG", status: "approved", from_address: "<ap@vendor.com>" });
    H.buyerGstin["em-F1"] = "27aaaaa0000a1z5"; // same, different case → normalised match
    const r = await runForwarding("ORG");
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
    expect(r.forwarded).toBe(1);
    expect(H.forwards["F1"].status).toBe("forwarded");
  });

  it("holds a GST invoice for review when the buyer GSTIN does NOT match", async () => {
    seedForward({ id: "F2", organization_id: "ORG", status: "approved", from_address: "<ap@vendor.com>" });
    H.buyerGstin["em-F2"] = "29BBBBB1111B2Z6"; // different GST entity
    const r = await runForwarding("ORG");
    expect(api.gmailSend).not.toHaveBeenCalled();
    expect(r.forwarded).toBe(0);
    expect(H.forwards["F2"].status).toBe("review");
    expect(String(H.forwards["F2"].last_error)).toMatch(/does not match/i);
  });

  it("holds for review when the buyer GSTIN is missing/unreadable", async () => {
    seedForward({ id: "F3", organization_id: "ORG", status: "approved", from_address: "<ap@vendor.com>" });
    // no buyerGstin entry → null
    const r = await runForwarding("ORG");
    expect(api.gmailSend).not.toHaveBeenCalled();
    expect(H.forwards["F3"].status).toBe("review");
  });

  it("holds for review when the organisation has no GSTIN configured", async () => {
    H.orgGstin["ORG"] = null;
    seedForward({ id: "F4", organization_id: "ORG", status: "approved", from_address: "<ap@vendor.com>" });
    H.buyerGstin["em-F4"] = "27AAAAA0000A1Z5";
    const r = await runForwarding("ORG");
    expect(api.gmailSend).not.toHaveBeenCalled();
    expect(H.forwards["F4"].status).toBe("review");
  });

  it("does NOT apply the GSTIN gate to a non-invoice document", async () => {
    seedForward({ id: "F5", organization_id: "ORG", status: "approved", from_address: "<ap@vendor.com>", classification: "general_finance", is_invoice_candidate: 0 });
    // No buyer GSTIN at all, but it's a statement — gate is skipped, so it forwards.
    const r = await runForwarding("ORG");
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
    expect(r.forwarded).toBe(1);
  });

  it("is DORMANT when invoices.buyer_gstin is not migrated yet (auto-forwards as before)", async () => {
    // Deploy-safety: the GSTIN code is live but migration 012 has not been
    // applied, so the column read throws ER_BAD_FIELD_ERROR. The gate must NOT
    // block — it stays dormant until 012, exactly like the sender-filter gate.
    H.columnMissing = true;
    seedForward({ id: "F7", organization_id: "ORG", status: "approved", from_address: "<ap@vendor.com>" });
    const r = await runForwarding("ORG");
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
    expect(r.forwarded).toBe(1);
    expect(H.forwards["F7"].status).toBe("forwarded");
  });

  it("is OPT-IN: when GSTIN validation is OFF, a mismatched/absent buyer GSTIN still auto-forwards", async () => {
    // Default for an organisation (migration 013): the gate is off, so an invoice
    // auto-forwards without requiring a readable/matching buyer GSTIN.
    H.gstinValidation = false;
    seedForward({ id: "F8", organization_id: "ORG", status: "approved", from_address: "<ap@vendor.com>" });
    H.buyerGstin["em-F8"] = "29BBBBB1111B2Z6"; // mismatch — but validation is off
    const r = await runForwarding("ORG");
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
    expect(r.forwarded).toBe(1);
    expect(H.forwards["F8"].status).toBe("forwarded");
  });

  it("a human approval bypasses the GSTIN gate (approver has reviewed)", async () => {
    seedForward({ id: "F6", organization_id: "ORG", status: "pending", from_address: "<ap@vendor.com>" });
    H.buyerGstin["em-F6"] = "29BBBBB1111B2Z6"; // mismatch — but a human approves
    const res = await approveAndForward("ORG", actor, "F6");
    expect(res.ok).toBe(true);
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
    expect(H.forwards["F6"].status).toBe("forwarded");
  });
});
