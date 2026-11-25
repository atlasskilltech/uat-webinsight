import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Per-organization forwarding isolation (the core of the simplified product):
 * each organization forwards to its OWN destination + CC, and one org's settings
 * never leak into another's. There is no cross-org fallback: if an org has no
 * destination, nothing is forwarded (rather than borrowing another org's).
 */

const H = vi.hoisted(() => ({
  dest: { "ORG-A": "accounts@companyA.com", "ORG-B": "purchase@companyB.com" } as Record<string, string | null>,
  cc: { "ORG-A": ["manager@companyA.com"], "ORG-B": ["admin@companyB.com"] } as Record<string, string[]>,
}));

vi.mock("@/lib/invoice/db", () => ({
  isMissingTableError: () => false,
  ijson: (v: unknown) => (v == null ? null : JSON.stringify(v)),
  iExecute: vi.fn(async () => ({ affectedRows: 1 })),
  iQueryOne: vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes("FROM `forwarding_settings`")) {
      const org = params[0] as string;
      return { finance_destination: H.dest[org] ?? null, min_confidence: "70.00", enabled: 1 };
    }
    return null;
  }),
  iQuery: vi.fn(async (sql: string, params: unknown[]) => {
    const org = params?.[0] as string;
    if (sql.includes("`forwarding_cc_recipients`")) return (H.cc[org] ?? []).map((email) => ({ id: email, email }));
    return []; // no rules / destinations configured
  }),
}));

import { getForwardingSettings } from "@/lib/invoice/services/forwarding";
import { resolveForwardingPlan } from "@/lib/invoice/services/routing";

const signals = { integrationId: "m1", sender: "x@supplier.com", categoryKey: "invoice", confidencePct: 90 };

beforeEach(() => {
  H.dest = { "ORG-A": "accounts@companyA.com", "ORG-B": "purchase@companyB.com" };
  H.cc = { "ORG-A": ["manager@companyA.com"], "ORG-B": ["admin@companyB.com"] };
});

describe("each organization uses only its own destination + CC", () => {
  it("getForwardingSettings returns the org's own destination", async () => {
    expect((await getForwardingSettings("ORG-A")).financeDestination).toBe("accounts@companyA.com");
    expect((await getForwardingSettings("ORG-B")).financeDestination).toBe("purchase@companyB.com");
  });

  it("Organisation A resolves to A's destination and A's CC only", async () => {
    const plan = await resolveForwardingPlan("ORG-A", signals);
    expect(plan.destination).toBe("accounts@companyA.com");
    expect(plan.cc).toContain("manager@companya.com"); // lowercased
    expect(plan.cc).not.toContain("admin@companyb.com"); // never Org B's CC
  });

  it("Organisation B resolves to B's destination and B's CC only", async () => {
    const plan = await resolveForwardingPlan("ORG-B", signals);
    expect(plan.destination).toBe("purchase@companyB.com");
    expect(plan.cc).toContain("admin@companyb.com");
    expect(plan.cc).not.toContain("manager@companya.com");
  });

  it("changing one org's data cannot affect the other (independent lookups)", async () => {
    H.dest["ORG-A"] = "new-ap@companyA.com"; // edit A only
    expect((await resolveForwardingPlan("ORG-A", signals)).destination).toBe("new-ap@companyA.com");
    expect((await resolveForwardingPlan("ORG-B", signals)).destination).toBe("purchase@companyB.com"); // unchanged
  });

  it("no cross-org fallback: an org with no destination forwards NOWHERE", async () => {
    H.dest["ORG-A"] = null; // A has no destination configured
    const plan = await resolveForwardingPlan("ORG-A", signals);
    expect(plan.destination).toBeNull(); // not B's address
    expect(plan.source).toBe("none");
  });
});
