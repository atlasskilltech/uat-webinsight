import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SafeUser } from "@/lib/auth/types";

/**
 * Active-organization resolution + isolation (scenarios 11–12).
 *
 * getInvoiceContext resolves the org the user is acting in. The active-org
 * cookie is a HINT ONLY: it is honored solely when the user is an active member
 * of that org and the org is active. A cookie naming an org the user does not
 * belong to (or an inactive org) is IGNORED — it can never reach another
 * organization's data. isMemberOf is the membership primitive the switch action
 * validates against.
 */

const H = vi.hoisted(() => ({
  user: { id: "u1", email: "u@atlas.test" } as Pick<SafeUser, "id" | "email"> & Partial<SafeUser>,
  memberships: [] as { organization_id: string; role: string }[],
  activeOrgs: [] as { id: string; name: string; status: string }[],
  cookie: null as string | null,
  memberRow: null as { id: string } | null,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (_n: string) => (H.cookie ? { value: H.cookie } : undefined) }),
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => H.user) }));
vi.mock("@/lib/invoice/services/org-admin", () => ({ anyActiveOrganizationExists: vi.fn(async () => H.activeOrgs.length > 0) }));
vi.mock("@/lib/invoice/db", () => ({
  iQuery: vi.fn(async (sql: string) => {
    if (sql.includes("`organization_members`")) return H.memberships;
    if (sql.includes("FROM `organizations`")) return H.activeOrgs;
    return [];
  }),
  iQueryOne: vi.fn(async (sql: string) => {
    if (sql.includes("FROM `organization_members`")) return H.memberRow;
    return null;
  }),
}));

import { getInvoiceContext, isMemberOf } from "@/lib/invoice/org";

const user = (): SafeUser => ({
  id: "u1", name: "U", email: "u@atlas.test", role: "user", status: "active",
  accessScope: "full", lastLoginAt: null, createdAt: new Date(0),
});

beforeEach(() => {
  H.user = user();
  H.memberships = [];
  H.activeOrgs = [];
  H.cookie = null;
  H.memberRow = null;
});

describe("getInvoiceContext — active-org resolution", () => {
  it("uses the single membership's org when there is one", async () => {
    H.memberships = [{ organization_id: "A", role: "FINANCE_ADMIN" }];
    H.activeOrgs = [{ id: "A", name: "Atlas", status: "active" }];
    const ctx = await getInvoiceContext();
    expect(ctx?.organizationId).toBe("A");
    expect(ctx?.role).toBe("FINANCE_ADMIN");
  });

  it("switches to the cookie'd org when the user is an active member of it", async () => {
    H.memberships = [{ organization_id: "A", role: "FINANCE_ADMIN" }, { organization_id: "B", role: "FINANCE_MANAGER" }];
    H.activeOrgs = [{ id: "A", name: "Atlas", status: "active" }, { id: "B", name: "ISDI", status: "active" }];
    H.cookie = "B";
    const ctx = await getInvoiceContext();
    expect(ctx?.organizationId).toBe("B");
    expect(ctx?.role).toBe("FINANCE_MANAGER"); // per-org role
  });

  it("IGNORES a cookie naming an org the user is not a member of (isolation)", async () => {
    H.memberships = [{ organization_id: "A", role: "FINANCE_ADMIN" }];
    H.activeOrgs = [{ id: "A", name: "Atlas", status: "active" }];
    H.cookie = "EVIL"; // not in memberships
    const ctx = await getInvoiceContext();
    expect(ctx?.organizationId).toBe("A"); // falls back to own org, never EVIL
  });

  it("IGNORES a cookie naming an INACTIVE org and falls back to an active membership", async () => {
    H.memberships = [{ organization_id: "A", role: "FINANCE_ADMIN" }, { organization_id: "B", role: "FINANCE_ADMIN" }];
    H.activeOrgs = [{ id: "A", name: "Atlas", status: "active" }]; // B is not active
    H.cookie = "B";
    const ctx = await getInvoiceContext();
    expect(ctx?.organizationId).toBe("A");
  });

  it("honors an explicit requestedOrgId over the cookie (validated against membership)", async () => {
    H.memberships = [{ organization_id: "A", role: "FINANCE_ADMIN" }, { organization_id: "B", role: "FINANCE_USER" }];
    H.activeOrgs = [{ id: "A", name: "Atlas", status: "active" }, { id: "B", name: "ISDI", status: "active" }];
    H.cookie = "A";
    const ctx = await getInvoiceContext("B");
    expect(ctx?.organizationId).toBe("B");
  });

  it("returns no org (setup/none) when every membership's org is inactive", async () => {
    H.memberships = [{ organization_id: "A", role: "FINANCE_ADMIN" }];
    H.activeOrgs = []; // A deactivated
    const ctx = await getInvoiceContext();
    expect(ctx?.organizationId).toBeNull();
  });
});

describe("isMemberOf — membership primitive the switch action validates against", () => {
  it("true when an active membership row exists", async () => {
    H.memberRow = { id: "m1" };
    expect(await isMemberOf(user(), "A")).toBe(true);
  });
  it("false when no membership row exists (cannot switch to a non-member org)", async () => {
    H.memberRow = null;
    expect(await isMemberOf(user(), "EVIL")).toBe(false);
  });
});
