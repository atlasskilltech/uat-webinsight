import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Organisation management: profile validation (optional GSTIN/PAN), the role
 * capability matrix (only Finance Admin administers org/settings), the
 * activate/deactivate safeguard, and multi-org membership.
 */

const H = vi.hoisted(() => ({
  org: null as { id: string; status: string; name: string } | null,
  activeOrgCount: 2,
  webUser: null as { id: string; email: string; name: string | null; status: string } | null,
  memberOrgIds: [] as string[],
  exec: vi.fn(async () => ({ affectedRows: 1 })),
}));

vi.mock("@/lib/invoice/audit", () => ({ logInvoiceAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/db", () => ({ queryOne: vi.fn(async () => H.webUser) }));
vi.mock("@/lib/invoice/db", () => ({
  iExecute: (...a: unknown[]) => H.exec(...(a as [])),
  iQuery: vi.fn(async (sql: string) => {
    if (sql.includes("DISTINCT `organization_id`")) return H.memberOrgIds.map((id) => ({ organization_id: id }));
    return [];
  }),
  iQueryOne: vi.fn(async (sql: string) => {
    if (sql.includes("FROM `organizations` WHERE `id`=?")) return H.org;
    if (sql.includes("COUNT(*) c FROM `organization_members`")) return { c: H.activeOrgCount };
    return null;
  }),
}));

import { validateOrgProfile, setOrganizationActive, addMemberByEmail, BASE_CURRENCIES } from "@/lib/invoice/services/org-admin";
import { roleHasCapability, FINANCE_ROLES } from "@/lib/invoice/types";

const actor = { id: "u1", email: "admin@atlas.test" };

beforeEach(() => {
  H.org = { id: "ORG", status: "active", name: "Atlas" };
  H.activeOrgCount = 2;
  H.webUser = { id: "emp1", email: "emp@atlas.test", name: "Emp", status: "active" };
  H.memberOrgIds = [];
  H.exec.mockClear();
});

describe("validateOrgProfile — GSTIN/PAN optional, well-formed when present", () => {
  const base = { name: "Acme Inc", legalName: null, gstin: null, pan: null, baseCurrency: "INR", address: null };

  it("accepts a name-only profile (non-Indian entity, no GSTIN/PAN)", () => {
    const r = validateOrgProfile(base);
    expect(r.ok).toBe(true);
  });
  it("rejects a malformed GSTIN but accepts a valid 15-char one", () => {
    expect(validateOrgProfile({ ...base, gstin: "BADGST" }).ok).toBe(false);
    expect(validateOrgProfile({ ...base, gstin: "27AAAAA0000A1Z5" }).ok).toBe(true);
  });
  it("rejects a malformed PAN but accepts a valid 10-char one", () => {
    expect(validateOrgProfile({ ...base, pan: "SHORT" }).ok).toBe(false);
    expect(validateOrgProfile({ ...base, pan: "AAAAA0000A" }).ok).toBe(true);
  });
  it("requires a name", () => {
    expect(validateOrgProfile({ ...base, name: "" }).ok).toBe(false);
  });
  it("falls back to INR for an unsupported currency and stores address as JSON", () => {
    const r = validateOrgProfile({ ...base, baseCurrency: "XYZ", address: " 1 Road " });
    expect(r.ok && r.currency).toBe("INR");
    expect(r.ok && r.address).toBe(JSON.stringify({ text: "1 Road" }));
    expect((BASE_CURRENCIES as readonly string[]).includes("AED")).toBe(true);
  });
});

describe("role capability matrix — only Finance Admin administers org + settings", () => {
  it("FINANCE_ADMIN holds org.manage, settings.manage and gmail.manage", () => {
    expect(roleHasCapability("FINANCE_ADMIN", "org.manage")).toBe(true);
    expect(roleHasCapability("FINANCE_ADMIN", "settings.manage")).toBe(true);
    expect(roleHasCapability("FINANCE_ADMIN", "gmail.manage")).toBe(true);
  });
  it("no OTHER role holds org.manage or settings.manage", () => {
    for (const role of FINANCE_ROLES.filter((r) => r !== "FINANCE_ADMIN")) {
      expect(roleHasCapability(role, "org.manage"), `${role} org.manage`).toBe(false);
      expect(roleHasCapability(role, "settings.manage"), `${role} settings.manage`).toBe(false);
      expect(roleHasCapability(role, "gmail.manage"), `${role} gmail.manage`).toBe(false);
    }
  });
  it("Finance Manager keeps its operational capabilities but NOT admin ones (no silent promotion)", () => {
    expect(roleHasCapability("FINANCE_MANAGER", "invoice.approve")).toBe(true);
    expect(roleHasCapability("FINANCE_MANAGER", "email.send")).toBe(true);
    expect(roleHasCapability("FINANCE_MANAGER", "org.manage")).toBe(false);
  });
});

describe("setOrganizationActive — activate/deactivate with safeguards", () => {
  it("refuses to deactivate the caller's ONLY active organization", async () => {
    H.activeOrgCount = 1;
    const res = await setOrganizationActive("ORG", actor, false);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/only active organization/i);
    expect(H.exec).not.toHaveBeenCalled();
  });
  it("deactivates when the caller has other active organizations", async () => {
    H.activeOrgCount = 3;
    const res = await setOrganizationActive("ORG", actor, false);
    expect(res.ok).toBe(true);
    expect(H.exec).toHaveBeenCalled();
  });
  it("activates an inactive organization", async () => {
    H.org = { id: "ORG", status: "inactive", name: "Atlas" };
    const res = await setOrganizationActive("ORG", actor, true);
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/activated/i);
  });
  it("reports not-found for a missing org", async () => {
    H.org = null;
    expect((await setOrganizationActive("GONE", actor, false)).ok).toBe(false);
  });
});

describe("addMemberByEmail — multi-org membership", () => {
  it("adds an employee who already belongs to a DIFFERENT organization (multi-org allowed)", async () => {
    H.memberOrgIds = ["OTHER-ORG"]; // already a member elsewhere, but not of ORG
    const res = await addMemberByEmail("ORG", actor, "emp@atlas.test", "FINANCE_USER");
    expect(res.ok).toBe(true);
    expect(H.exec).toHaveBeenCalled();
  });
  it("refuses to add someone already in THIS organization", async () => {
    H.memberOrgIds = ["ORG"];
    const res = await addMemberByEmail("ORG", actor, "emp@atlas.test", "FINANCE_USER");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/already a member of this organization/i);
  });
  it("refuses an email with no Web Insight account (never creates a login)", async () => {
    H.webUser = null;
    const res = await addMemberByEmail("ORG", actor, "ghost@atlas.test", "FINANCE_USER");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/No Web Insight account/i);
  });
  it("refuses an invalid finance role", async () => {
    const res = await addMemberByEmail("ORG", actor, "emp@atlas.test", "SUPERUSER");
    expect(res.ok).toBe(false);
  });
});
