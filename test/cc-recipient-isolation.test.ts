import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * CC recipient edit/remove are organization-scoped and report "Recipient not
 * found" for a missing or cross-organization id (instead of a false success),
 * and never touch another organization's recipient (the SQL always carries
 * organization_id).
 */

const H = vi.hoisted(() => ({
  existsInOrg: true, // whether the id belongs to the acting org (ORG-A)
  exec: vi.fn(async (_sql: string, ..._p: unknown[]) => ({ affectedRows: 0 })),
}));

vi.mock("@/lib/invoice/audit", () => ({ logInvoiceAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/invoice/db", () => ({
  isMissingTableError: () => false,
  ijson: (v: unknown) => (v === undefined ? null : JSON.stringify(v)),
  iExecute: (sql: string, ...p: unknown[]) => H.exec(sql, ...p),
  iQuery: vi.fn(async () => []),
  iQueryOne: vi.fn(async (sql: string) => {
    // duplicate check: ... WHERE organization_id=? AND email=? AND id<>?
    if (sql.includes("`forwarding_cc_recipients`") && sql.includes("email=?")) return null;
    // existence check: SELECT id ... WHERE organization_id=? AND id=?
    if (sql.includes("`forwarding_cc_recipients`") && sql.includes("AND id=?")) {
      return H.existsInOrg ? { id: "cc-1" } : null;
    }
    return null;
  }),
}));

import { updateCcRecipient, removeCcRecipient } from "@/lib/invoice/services/forwarding";

beforeEach(() => {
  H.existsInOrg = true;
  H.exec.mockReset();
  H.exec.mockImplementation(async () => ({ affectedRows: H.existsInOrg ? 1 : 0 }));
});

describe("updateCcRecipient", () => {
  it("returns 'Recipient not found' for an id missing in the active org", async () => {
    H.existsInOrg = false;
    const res = await updateCcRecipient("ORG-A", "missing", "new@atlas.test");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/i);
    expect(H.exec).not.toHaveBeenCalled(); // no UPDATE ran
  });

  it("returns 'Recipient not found' for a cross-organization id (org-scoped SELECT misses it)", async () => {
    H.existsInOrg = false; // id belongs to ORG-B → not visible from ORG-A
    const res = await updateCcRecipient("ORG-A", "cc-of-org-b", "x@atlas.test");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/i);
  });

  it("updates a recipient that exists in the active org", async () => {
    H.existsInOrg = true;
    const res = await updateCcRecipient("ORG-A", "cc-1", "updated@atlas.test");
    expect(res.ok).toBe(true);
    // the UPDATE is organization-scoped
    const call = H.exec.mock.calls.find((c) => String(c[0]).includes("UPDATE `forwarding_cc_recipients`"));
    expect(call?.[1]).toContain("ORG-A");
  });

  it("rejects an invalid email before any lookup", async () => {
    const res = await updateCcRecipient("ORG-A", "cc-1", "not-an-email");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/valid email/i);
  });
});

describe("removeCcRecipient", () => {
  it("returns 'Recipient not found' when the id is missing / belongs to another org", async () => {
    H.existsInOrg = false; // DELETE affects 0 rows
    const res = await removeCcRecipient("ORG-A", "cc-of-org-b");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/i);
    // the DELETE is organization-scoped (never another org's row)
    const call = H.exec.mock.calls.find((c) => String(c[0]).includes("DELETE FROM `forwarding_cc_recipients`"));
    expect(String(call?.[0])).toContain("organization_id=?");
    expect(call?.[1]).toContain("ORG-A");
  });

  it("removes a recipient that exists in the active org", async () => {
    H.existsInOrg = true;
    const res = await removeCcRecipient("ORG-A", "cc-1");
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/removed/i);
  });
});
