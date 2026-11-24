import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FinanceRole } from "@/lib/invoice/types";

/**
 * Backend permission enforcement (scenarios 6–10). Every Invoice-Agent server
 * action funnels through requireCapability(); this proves it REJECTS the three
 * restricted capabilities (org.manage, settings.manage, gmail.manage) for every
 * non-Finance-Admin role — so a direct server-action / API call by a Finance
 * Manager, Editor, Approver or Viewer cannot bypass the frontend gating.
 */

const H = vi.hoisted(() => ({
  ctx: null as null | { organizationId: string | null; role: FinanceRole | null; user: { id: string; email: string } },
}));

// Break the next-auth import chain (guard.ts → session.ts → @/auth) in tests.
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/lib/invoice/org", () => ({
  // requireCapability passes requestedOrgId through; our mock ignores it and
  // returns the configured context (role under test).
  getInvoiceContext: vi.fn(async () => H.ctx),
}));

import { requireCapability } from "@/lib/invoice/permissions";
import { isAuthError } from "@/lib/auth/guard";

function ctxFor(role: FinanceRole) {
  return { organizationId: "ORG", role, user: { id: "u1", email: "u@atlas.test" } };
}
async function statusOf(fn: () => Promise<unknown>): Promise<number | "ok"> {
  try { await fn(); return "ok"; } catch (e) { return isAuthError(e) ? (e as { status: number }).status : -1; }
}

const RESTRICTED = ["org.manage", "settings.manage", "gmail.manage"] as const;
const NON_ADMIN: FinanceRole[] = ["FINANCE_VIEWER", "APPROVER", "FINANCE_USER", "FINANCE_MANAGER"];

beforeEach(() => { H.ctx = null; });

describe("requireCapability — restricted settings are Finance Admin only", () => {
  for (const role of NON_ADMIN) {
    for (const cap of RESTRICTED) {
      it(`rejects ${role} for ${cap} with 403`, async () => {
        H.ctx = ctxFor(role);
        expect(await statusOf(() => requireCapability(cap))).toBe(403);
      });
    }
  }

  for (const cap of RESTRICTED) {
    it(`allows FINANCE_ADMIN for ${cap}`, async () => {
      H.ctx = ctxFor("FINANCE_ADMIN");
      expect(await statusOf(() => requireCapability(cap))).toBe("ok");
    });
  }

  it("rejects an unauthenticated caller (401)", async () => {
    H.ctx = null;
    expect(await statusOf(() => requireCapability("settings.manage"))).toBe(401);
  });

  it("rejects a member with no resolved organization (403)", async () => {
    H.ctx = { organizationId: null, role: null, user: { id: "u1", email: "u@atlas.test" } };
    expect(await statusOf(() => requireCapability("org.manage"))).toBe(403);
  });

  it("still allows a Finance Viewer to READ invoices (operational roles unchanged)", async () => {
    H.ctx = ctxFor("FINANCE_VIEWER");
    expect(await statusOf(() => requireCapability("invoice.read"))).toBe("ok");
  });
});
