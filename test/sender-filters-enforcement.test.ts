import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Send-time enforcement of the per-organisation sender filters across EVERY
 * forward path — the drain worker (runForwarding), manual approval
 * (approveAndForward) and the AI-agent forward (forwardEmailById). The gate is
 * re-checked at send time, so a sender excluded (or an allowed-senders list
 * changed) AFTER a task was queued/approved is never forwarded. Organisation
 * isolation is verified throughout.
 *
 * These drive the REAL service functions with the DB and Gmail layers mocked, so
 * they exercise the actual queue→approve→send logic, not just the pure matcher.
 */

type Row = Record<string, unknown> & {
  id: string;
  organization_id: string;
  source_gmail_message_id: string;
  destination: string;
  status: string;
  from_address: string | null;
  last_error: string | null;
};

const H = vi.hoisted(() => ({
  filters: {} as Record<string, { kind: "allow" | "block"; pattern: string }[]>,
  settings: {} as Record<string, string | null>,
  forwards: {} as Record<string, Row>,
  emails: {} as Record<string, Record<string, unknown> & { organization_id: string }>,
}));

const api = vi.hoisted(() => ({
  gmailSend: vi.fn(async () => ({ id: "sent-1", threadId: "thr-1" })),
  gmailGetRaw: vi.fn(async () => Buffer.from("From: v@x.com\r\n\r\nhi", "utf8").toString("base64url")),
  gmailGetAttachment: vi.fn(async () => Buffer.from([1, 2, 3])),
  gmailGetMessage: vi.fn(async () => ({ id: "m", threadId: "t", payload: {} })),
}));

function rowDefaults(p: Partial<Row> & Pick<Row, "id" | "organization_id" | "status" | "from_address">): Row {
  return {
    gmail_integration_id: "gi",
    email_message_id: "em-" + p.id,
    source_gmail_message_id: "gm-" + p.id,
    destination: "fin@" + p.organization_id + ".com",
    confidence: "90.00",
    subject: "Invoice INV-1",
    to_address: "ap@org.com",
    received_at: null,
    account_email: null,
    organisation_name: "Org " + p.organization_id,
    forwarded_message_id: null,
    attempts: 0,
    forwarded_at: null,
    created_at: new Date(),
    last_error: null,
    ...p,
  };
}
function seedForward(p: Partial<Row> & Pick<Row, "id" | "organization_id" | "status" | "from_address">) {
  H.forwards[p.id] = rowDefaults(p);
}
const clone = (r: Row) => ({ ...r });

vi.mock("@/lib/invoice/db", () => ({
  isMissingTableError: () => false,
  ijson: (v: unknown) => (v == null ? null : JSON.stringify(v)),
  iQuery: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("`forwarding_sender_filters`")) {
      const org = params[0] as string;
      return (H.filters[org] ?? []).map((f) => ({ id: `${org}::${f.kind}::${f.pattern}`, kind: f.kind, pattern: f.pattern }));
    }
    if (sql.includes("`forwarding_cc_recipients`")) return [];
    if (sql.includes("FROM `invoice_forwards` f")) {
      // listForwards(org, {status:'approved'}) — strictly org-scoped.
      const org = params[0] as string;
      return Object.values(H.forwards).filter((r) => r.organization_id === org && r.status === "approved").map(clone);
    }
    if (sql.includes("`email_attachments`")) return [];
    return [];
  }),
  iQueryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM `forwarding_settings`")) {
      const org = params[0] as string;
      return { finance_destination: H.settings[org] ?? null, min_confidence: "70.00", enabled: 1 };
    }
    if (sql.includes("SELECT id FROM `invoice_forwards`")) {
      const [org, srcId, dest] = params as string[];
      const r = Object.values(H.forwards).find((x) => x.organization_id === org && x.source_gmail_message_id === srcId && x.destination === dest);
      return r ? { id: r.id } : null;
    }
    if (sql.includes("SELECT status FROM `invoice_forwards`")) {
      const r = H.forwards[params[0] as string];
      return r ? { status: r.status } : null;
    }
    if (sql.includes("COUNT(*) c FROM `invoice_forwards`")) return { c: 0 };
    if (sql.includes("FROM `invoice_forwards` f")) {
      const [org, id] = params as string[];
      const r = H.forwards[id];
      return r && r.organization_id === org ? clone(r) : null;
    }
    if (sql.includes("FROM `email_messages`")) {
      const [org, id] = params as string[];
      const e = H.emails[id];
      return e && e.organization_id === org ? e : null;
    }
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
    if (sql.includes("SET `status`='skipped'")) {
      const r = H.forwards[last];
      if (r && ["approved", "pending", "review", "failed"].includes(r.status)) { r.status = "skipped"; r.last_error = P[0] as string; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (sql.includes("SET `status`='approved'")) {
      const r = H.forwards[last];
      if (r && ["pending", "review", "failed", "approved"].includes(r.status)) { r.status = "approved"; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (sql.includes("SET `status`='forwarded'")) {
      const r = H.forwards[last];
      if (r) { r.status = "forwarded"; r.forwarded_message_id = P[0] as string; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (sql.includes("INSERT INTO `invoice_forwards`")) {
      const [id, org, integ, emId, srcId, dest] = P as string[];
      const existing = Object.values(H.forwards).find((r) => r.organization_id === org && r.source_gmail_message_id === srcId && r.destination === dest);
      if (!existing) {
        seedForward({ id, organization_id: org, gmail_integration_id: integ, email_message_id: emId, source_gmail_message_id: srcId, destination: dest, status: "approved", from_address: (H.emails[emId]?.from_address as string) ?? null });
      }
      return { affectedRows: existing ? 0 : 1 };
    }
    return { affectedRows: 1 };
  }),
}));

vi.mock("@/lib/invoice/services/gmail", () => ({ getAccountAccessToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/invoice/gmail/api", () => api);
vi.mock("@/lib/invoice/gmail/oauth", () => ({
  GmailApiError: class GmailApiError extends Error {
    status: number;
    permanent: boolean;
    constructor(message: string, status = 0, permanent = false) { super(message); this.status = status; this.permanent = permanent; }
  },
}));
vi.mock("@/lib/invoice/services/org-admin", () => ({ isOrganizationActive: vi.fn(async () => true) }));
vi.mock("@/lib/invoice/audit", () => ({ logInvoiceAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/invoice/services/original-body", () => ({ buildOriginalBodyHtml: vi.fn(async () => "") }));

import { approveAndForward, runForwarding, forwardEmailById } from "@/lib/invoice/services/forwarding";

const actor = { id: "u1", email: "admin@atlas.edu" };

beforeEach(() => {
  H.filters = {};
  H.settings = {};
  H.forwards = {};
  H.emails = {};
  api.gmailSend.mockClear();
});

describe("approveAndForward — send-time sender gate", () => {
  it("sends when the sender is allowed", async () => {
    H.filters["ORG-A"] = [{ kind: "allow", pattern: "acme.com" }];
    seedForward({ id: "F1", organization_id: "ORG-A", status: "pending", from_address: '"Vendor" <ap@acme.com>' });
    const res = await approveAndForward("ORG-A", actor, "F1");
    expect(res.ok).toBe(true);
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
    expect(H.forwards["F1"].status).toBe("forwarded");
  });

  it("does NOT send an excluded sender (block wins) and marks it skipped with a reason", async () => {
    H.filters["ORG-A"] = [{ kind: "allow", pattern: "acme.com" }, { kind: "block", pattern: "razorpay.com" }];
    seedForward({ id: "F2", organization_id: "ORG-A", status: "pending", from_address: "<pay@razorpay.com>" });
    const res = await approveAndForward("ORG-A", actor, "F2");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/excluded/i);
    expect(api.gmailSend).not.toHaveBeenCalled();
    expect(H.forwards["F2"].status).toBe("skipped");
    expect(H.forwards["F2"].last_error).toMatch(/excluded/i);
  });

  it("sends when the organisation has an empty allow-list (no restriction, default behaviour)", async () => {
    H.filters["ORG-A"] = []; // configured, but no allowed senders → no restriction, forward all
    seedForward({ id: "F3", organization_id: "ORG-A", status: "pending", from_address: "<x@acme.com>" });
    const res = await approveAndForward("ORG-A", actor, "F3");
    expect(res.ok).toBe(true);
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
    expect(H.forwards["F3"].status).toBe("forwarded");
  });

  it("a PENDING email that becomes EXCLUDED before approval is not forwarded", async () => {
    // Queued while the sender was allowed…
    H.filters["ORG-A"] = [{ kind: "allow", pattern: "acme.com" }];
    seedForward({ id: "F4", organization_id: "ORG-A", status: "pending", from_address: "<ap@acme.com>" });
    // …then an admin excludes that sender's domain.
    H.filters["ORG-A"].push({ kind: "block", pattern: "acme.com" });
    const res = await approveAndForward("ORG-A", actor, "F4");
    expect(res.ok).toBe(false);
    expect(api.gmailSend).not.toHaveBeenCalled();
    expect(H.forwards["F4"].status).toBe("skipped");
    expect(H.forwards["F4"].last_error).toMatch(/excluded/i);
  });
});

describe("runForwarding (drain worker) — send-time sender gate", () => {
  it("does NOT send an approved row whose sender is excluded", async () => {
    H.filters["ORG-A"] = [{ kind: "allow", pattern: "acme.com" }, { kind: "block", pattern: "razorpay.com" }];
    seedForward({ id: "F5", organization_id: "ORG-A", status: "approved", from_address: "<pay@razorpay.com>" });
    const res = await runForwarding("ORG-A");
    expect(api.gmailSend).not.toHaveBeenCalled();
    expect(res.forwarded).toBe(0);
    expect(H.forwards["F5"].status).toBe("skipped");
  });

  it("sends an approved row whose sender is allowed", async () => {
    H.filters["ORG-B"] = [{ kind: "allow", pattern: "acme.com" }];
    seedForward({ id: "F6", organization_id: "ORG-B", status: "approved", from_address: "<ap@acme.com>", destination: "fin@b.com" });
    const res = await runForwarding("ORG-B");
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
    expect(res.forwarded).toBe(1);
    expect(H.forwards["F6"].status).toBe("forwarded");
  });
});

describe("forwardEmailById (AI-agent / explicit forward) — send-time sender gate", () => {
  it("refuses an excluded sender and creates no forward", async () => {
    H.settings["ORG-A"] = "fin@a.com";
    H.filters["ORG-A"] = [{ kind: "block", pattern: "razorpay.com" }, { kind: "allow", pattern: "acme.com" }];
    H.emails["E1"] = { id: "E1", organization_id: "ORG-A", gmail_integration_id: "gi", gmail_message_id: "gm-E1", from_address: "<pay@razorpay.com>", classification_confidence: "90.00" };
    const res = await forwardEmailById("ORG-A", actor, "E1");
    expect(res.ok).toBe(false);
    expect(api.gmailSend).not.toHaveBeenCalled();
    expect(Object.keys(H.forwards)).toHaveLength(0);
  });

  it("forwards an allowed sender", async () => {
    H.settings["ORG-A"] = "fin@a.com";
    H.filters["ORG-A"] = [{ kind: "allow", pattern: "acme.com" }];
    H.emails["E2"] = { id: "E2", organization_id: "ORG-A", gmail_integration_id: "gi", gmail_message_id: "gm-E2", from_address: "<ap@acme.com>", classification_confidence: "90.00" };
    const res = await forwardEmailById("ORG-A", actor, "E2");
    expect(res.ok).toBe(true);
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
  });
});

describe("organisation isolation of sender filters", () => {
  it("one org's exclusion does not affect another org that allows the same sender", async () => {
    H.filters["ORG-A"] = [{ kind: "allow", pattern: "acme.com" }, { kind: "block", pattern: "razorpay.com" }];
    H.filters["ORG-B"] = [{ kind: "allow", pattern: "razorpay.com" }]; // B explicitly allows the vendor A excludes
    seedForward({ id: "A1", organization_id: "ORG-A", status: "approved", from_address: "<pay@razorpay.com>", destination: "fin@a.com" });
    seedForward({ id: "B1", organization_id: "ORG-B", status: "approved", from_address: "<pay@razorpay.com>", destination: "fin@b.com" });

    await runForwarding("ORG-A"); // A excludes razorpay → withheld
    expect(H.forwards["A1"].status).toBe("skipped");
    expect(api.gmailSend).not.toHaveBeenCalled();

    await runForwarding("ORG-B"); // B allows razorpay → sent
    expect(H.forwards["B1"].status).toBe("forwarded");
    expect(api.gmailSend).toHaveBeenCalledTimes(1); // only B's
  });
});
