import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FinanceRole } from "@/lib/invoice/types";

/**
 * Strict per-organization authorization (requirement 2).
 *
 * requireCapabilityForOrg validates membership + role for EXACTLY the targeted
 * org and NEVER falls back to another org:
 *   - not an active member of that org            -> 403
 *   - a member but the role lacks the capability  -> 403
 *   - a Finance Admin member                      -> ok (even if the org is inactive,
 *                                                    so it can be reactivated)
 */

const H = vi.hoisted(() => ({
  user: { id: "u1", email: "admin@atlas.test" } as { id: string; email: string } | null,
  member: null as { id: string; role: FinanceRole } | null,
  orgStatus: "active" as string,
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => H.user) }));
vi.mock("@/lib/invoice/org", () => ({ getInvoiceContext: vi.fn(async () => null) }));
vi.mock("@/lib/invoice/db", () => ({
  iQueryOne: vi.fn(async (sql: string) => {
    if (sql.includes("`organization_members`")) return H.member;
    if (sql.includes("FROM `organizations`")) return { id: "B", name: "ISDI", status: H.orgStatus };
    return null;
  }),
}));

import { requireCapabilityForOrg } from "@/lib/invoice/permissions";
import { isAuthError } from "@/lib/auth/guard";

async function statusOf(fn: () => Promise<unknown>): Promise<number | "ok"> {
  try { await fn(); return "ok"; } catch (e) { return isAuthError(e) ? (e as { status: number }).status : -1; }
}

beforeEach(() => {
  H.user = { id: "u1", email: "admin@atlas.test" };
  H.member = null;
  H.orgStatus = "active";
});

describe("requireCapabilityForOrg — explicit org, no silent fallback", () => {
  it("403 when the user is NOT a member of the targeted org (never falls back to org A)", async () => {
    H.member = null; // not a member of B
    expect(await statusOf(() => requireCapabilityForOrg("org.manage", "B"))).toBe(403);
  });

  it("403 when a member of the targeted org lacks the capability", async () => {
    H.member = { id: "m1", role: "FINANCE_MANAGER" }; // member of B but not admin
    expect(await statusOf(() => requireCapabilityForOrg("org.manage", "B"))).toBe(403);
  });

  it("ok when a Finance Admin member targets their own org", async () => {
    H.member = { id: "m1", role: "FINANCE_ADMIN" };
    expect(await statusOf(() => requireCapabilityForOrg("org.manage", "B"))).toBe("ok");
  });

  it("still ok for a Finance Admin when the org is INACTIVE (so it can be reactivated)", async () => {
    H.member = { id: "m1", role: "FINANCE_ADMIN" };
    H.orgStatus = "inactive";
    const ctx = await requireCapabilityForOrg("org.manage", "B");
    expect(ctx.organizationId).toBe("B");
    expect(ctx.role).toBe("FINANCE_ADMIN");
  });

  it("401 when unauthenticated", async () => {
    H.user = null;
    expect(await statusOf(() => requireCapabilityForOrg("org.manage", "B"))).toBe(401);
  });

  it("returns a context for exactly the targeted org (no cross-org leakage)", async () => {
    H.member = { id: "m1", role: "FINANCE_ADMIN" };
    const ctx = await requireCapabilityForOrg("settings.manage", "B");
    expect(ctx.organizationId).toBe("B");
  });
});
