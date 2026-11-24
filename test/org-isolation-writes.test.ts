import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Organization-scoped write isolation (security audit).
 *
 * Team-member management does not accept an org id from the frontend — it uses
 * the server-resolved active org. This proves the underlying service is
 * org-scoped: a member id belonging to ANOTHER organization can never be
 * role-changed or removed while acting in a different org (the scoped SELECT
 * returns nothing → "not found"), so a cross-org entity id is inert.
 */

const H = vi.hoisted(() => ({
  // The only member row that exists lives in ORG-A with id m-A.
  exec: vi.fn(async () => ({ affectedRows: 1 })),
}));

vi.mock("@/lib/invoice/audit", () => ({ logInvoiceAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/db", () => ({ queryOne: vi.fn(async () => null) }));
vi.mock("@/lib/invoice/db", () => ({
  iExecute: (...a: unknown[]) => H.exec(...(a as [])),
  iQuery: vi.fn(async () => []),
  iQueryOne: vi.fn(async (sql: string, params: unknown[]) => {
    const [org, id] = params as string[];
    // Org-scoped member lookups (updateMemberRole / removeMember).
    if (sql.includes("FROM `organization_members`") && sql.includes("`id`=?")) {
      if (org === "ORG-A" && id === "m-A") {
        return sql.includes("user_email")
          ? { id: "m-A", role: "FINANCE_USER", user_email: "emp@atlas.test" }
          : { id: "m-A", role: "FINANCE_USER" };
      }
      return null; // m-B (ORG-B) is invisible from ORG-A's scope
    }
    if (sql.includes("COUNT(*) c FROM `organization_members`")) return { c: 2 };
    return null;
  }),
}));

import { updateMemberRole, removeMember } from "@/lib/invoice/services/org-admin";

const actor = { id: "admin", email: "admin@atlas.test" };

beforeEach(() => H.exec.mockClear());

describe("team-member management is org-scoped (no cross-org writes)", () => {
  it("cannot change the role of a member belonging to another organization", async () => {
    const res = await updateMemberRole("ORG-A", actor, "m-B", "FINANCE_MANAGER");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/i);
    expect(H.exec).not.toHaveBeenCalled();
  });

  it("cannot remove a member belonging to another organization", async () => {
    const res = await removeMember("ORG-A", actor, "m-B");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/i);
    expect(H.exec).not.toHaveBeenCalled();
  });

  it("CAN manage a member of the acting organization", async () => {
    const res = await updateMemberRole("ORG-A", actor, "m-A", "FINANCE_MANAGER");
    expect(res.ok).toBe(true);
    expect(H.exec).toHaveBeenCalled();
  });
});
