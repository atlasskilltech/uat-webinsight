import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Deactivation pauses EXECUTION, not just enqueue (scenario/audit #2), and the
 * push lookup resolves every organization that has the inbox connected (#3).
 *
 * The DB layer is mocked so the org-active guard (isOrganizationActive) and the
 * multi-org integration lookup can be driven directly, without a live database.
 */

const H = vi.hoisted(() => ({
  orgStatus: "active" as string,
  integrations: [] as { id: string; organization_id: string }[],
  approvedQueried: false,
}));

vi.mock("@/lib/invoice/db", () => ({
  isMissingTableError: () => false,
  ijson: (v: unknown) => (v === undefined ? null : JSON.stringify(v)),
  iExecute: vi.fn(async () => ({ affectedRows: 1 })),
  iQueryOne: vi.fn(async (sql: string) => {
    if (sql.includes("FROM `organizations` WHERE `id`=?")) return { status: H.orgStatus };
    if (sql.includes("COUNT(*) c FROM `invoice_forwards`")) return { c: 0 };
    return null;
  }),
  iQuery: vi.fn(async (sql: string) => {
    if (sql.includes("`invoice_forwards`")) { H.approvedQueried = true; return []; }
    if (sql.includes("`gmail_integrations`")) return H.integrations;
    return [];
  }),
}));

import { runForwarding } from "@/lib/invoice/services/forwarding";
import { syncGmailAccount, findConnectedIntegrationsByEmail } from "@/lib/invoice/services/gmail";

beforeEach(() => {
  H.orgStatus = "active";
  H.integrations = [];
  H.approvedQueried = false;
});

describe("#2 deactivation pauses already-queued forwarding execution", () => {
  it("runForwarding is a no-op for an inactive org and never reads approved forwards", async () => {
    H.orgStatus = "inactive";
    const res = await runForwarding("ORG");
    expect(res).toEqual({ forwarded: 0, failed: 0, unknown: 0, pending: 0 });
    expect(H.approvedQueried).toBe(false); // short-circuited before touching the queue
  });

  it("runForwarding proceeds for an active org (guard lets it through)", async () => {
    H.orgStatus = "active";
    await runForwarding("ORG");
    expect(H.approvedQueried).toBe(true);
  });

  it("missing org is treated as paused (no processing)", async () => {
    H.orgStatus = "__none__"; // iQueryOne returns a non-'active' status
    const res = await runForwarding("GONE");
    expect(res.forwarded).toBe(0);
    expect(H.approvedQueried).toBe(false);
  });
});

describe("#2 deactivation pauses already-queued Gmail sync execution", () => {
  it("syncGmailAccount returns a paused no-op for an inactive org", async () => {
    H.orgStatus = "inactive";
    const summary = await syncGmailAccount("ORG", "intg-1", { id: "sys", email: "w@x" });
    expect(summary.newMessages).toBe(0);
    expect(summary.scanned).toBe(0);
    expect(summary.message).toMatch(/paused/i);
  });
});

describe("#3 push lookup resolves every organization with the inbox connected", () => {
  it("returns all connected integrations for an email (multi-org fan-out)", async () => {
    H.integrations = [
      { id: "intg-atlas", organization_id: "ORG-ATLAS" },
      { id: "intg-isdi", organization_id: "ORG-ISDI" },
    ];
    const rows = await findConnectedIntegrationsByEmail("ap@shared.test");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.organization_id).sort()).toEqual(["ORG-ATLAS", "ORG-ISDI"]);
    // Each row carries its own org id so the sync runs in the correct context.
    expect(rows.every((r) => r.id && r.organization_id)).toBe(true);
  });

  it("returns nothing when the inbox is connected nowhere active", async () => {
    H.integrations = [];
    expect(await findConnectedIntegrationsByEmail("nobody@x.test")).toHaveLength(0);
  });
});
