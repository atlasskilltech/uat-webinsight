import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Phase 6 — configurable forwarding routing resolver.
 *
 * Verifies the PURE resolver and dry-run against the spec:
 *   - Legacy single-destination fallback is preserved when no rule matches.
 *   - Priority order + enabled filter + match conditions (mailbox/sender/category).
 *   - Fallback destination when the primary is inactive.
 *   - Organization isolation (another org's rules/destinations are invisible).
 *   - CC merge (destination CC ∪ org-wide CC, de-duplicated, case-insensitive).
 *   - Classification → category mapping.
 *   - Dry-run never forwards and reports the action honestly.
 *
 * The DB and the legacy forwarding settings are mocked so the test is pure logic
 * (no database), exercising listRules/listDestinations/resolveForwardingPlan as
 * the live sync uses them.
 */

const H = vi.hoisted(() => ({
  state: {
    rules: [] as Record<string, unknown>[],
    destinations: [] as Record<string, unknown>[],
  },
  legacy: { financeDestination: null as string | null, minConfidence: 70, enabled: true },
  orgCc: [] as { id: string; email: string }[],
}));

vi.mock("@/lib/invoice/db", () => ({
  iQuery: vi.fn(async (sql: string, params: unknown[]) => {
    const org = params?.[0];
    if (sql.includes("`forwarding_rules`")) {
      // Mirror listRules' deterministic ORDER BY priority, created_at, id.
      return H.state.rules
        .filter((r) => r.organization_id === org)
        .sort(
          (a, b) =>
            Number(a.priority) - Number(b.priority) ||
            String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
            String(a.id).localeCompare(String(b.id)),
        );
    }
    if (sql.includes("`forwarding_destinations`")) {
      return H.state.destinations.filter((d) => d.organization_id === org);
    }
    return [];
  }),
  iQueryOne: vi.fn(async () => null),
  iExecute: vi.fn(async () => ({ affectedRows: 1 })),
  isMissingTableError: () => false,
  ijson: (v: unknown) => (v === undefined ? null : JSON.stringify(v)),
}));

vi.mock("@/lib/invoice/services/forwarding", () => ({
  getForwardingSettings: vi.fn(async () => ({ ...H.legacy })),
  listCcRecipients: vi.fn(async () => H.orgCc),
  normalizeEmail: (raw: string) => {
    const e = raw.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
  },
}));

import {
  resolveForwardingPlan,
  testForwardingRules,
  categoryKeyForClassification,
} from "@/lib/invoice/services/routing";

const ORG = "org-atlas";
const OTHER = "org-isdi";

function dest(id: string, email: string, opts: { cc?: string[]; active?: boolean; org?: string } = {}) {
  return {
    id, organization_id: opts.org ?? ORG, name: id, email,
    cc_emails: opts.cc ? JSON.stringify(opts.cc) : null,
    is_active: opts.active === false ? 0 : 1,
  };
}
function rule(id: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    id, organization_id: ORG, name: id, priority: 100,
    match_integration_id: null, match_sender: null, match_category_key: null,
    destination_id: "", fallback_destination_id: null, auto_forward: 0, min_confidence: null, enabled: 1,
    ...over,
  };
}

const signals = (over: Partial<{ integrationId: string; sender: string; categoryKey: string; confidencePct: number }> = {}) => ({
  integrationId: "mbx-1", sender: "billing@acme.com", categoryKey: "invoice", confidencePct: 90, ...over,
});

beforeEach(() => {
  H.state.rules = [];
  H.state.destinations = [];
  H.legacy = { financeDestination: null, minConfidence: 70, enabled: true };
  H.orgCc = [];
});

describe("resolveForwardingPlan — legacy fallback (backward compatibility)", () => {
  it("uses the legacy default destination when no rules exist", async () => {
    H.legacy = { financeDestination: "finance@atlas.test", minConfidence: 70, enabled: true };
    const plan = await resolveForwardingPlan(ORG, signals());
    expect(plan.source).toBe("legacy");
    expect(plan.destination).toBe("finance@atlas.test");
    expect(plan.minConfidence).toBe(70);
    expect(plan.autoForward).toBe(false);
    expect(plan.matchedRuleId).toBeNull();
  });

  it("forwards nowhere when the legacy destination is disabled/unset", async () => {
    H.legacy = { financeDestination: null, minConfidence: 70, enabled: true };
    const plan = await resolveForwardingPlan(ORG, signals());
    expect(plan.source).toBe("none");
    expect(plan.destination).toBeNull();
  });
});

describe("resolveForwardingPlan — rule matching", () => {
  it("routes by document category to the rule's destination", async () => {
    H.state.destinations = [dest("D-po", "procurement@atlas.test")];
    H.state.rules = [rule("R1", { match_category_key: "purchase_order", destination_id: "D-po", auto_forward: 1, min_confidence: "60.00" })];
    const plan = await resolveForwardingPlan(ORG, signals({ categoryKey: "purchase_order" }));
    expect(plan.source).toBe("rule");
    expect(plan.destination).toBe("procurement@atlas.test");
    expect(plan.autoForward).toBe(true);
    expect(plan.minConfidence).toBe(60);
    expect(plan.matchedRuleId).toBe("R1");
  });

  it("does NOT match when the category differs → legacy fallback", async () => {
    H.legacy = { financeDestination: "finance@atlas.test", minConfidence: 70, enabled: true };
    H.state.destinations = [dest("D-po", "procurement@atlas.test")];
    H.state.rules = [rule("R1", { match_category_key: "purchase_order", destination_id: "D-po" })];
    const plan = await resolveForwardingPlan(ORG, signals({ categoryKey: "invoice" }));
    expect(plan.source).toBe("legacy");
    expect(plan.destination).toBe("finance@atlas.test");
  });

  it("matches sender as a case-insensitive substring", async () => {
    H.state.destinations = [dest("D-acme", "acme-ap@atlas.test")];
    H.state.rules = [rule("R1", { match_sender: "ACME.com", destination_id: "D-acme" })];
    const hit = await resolveForwardingPlan(ORG, signals({ sender: "Billing@Acme.Com" }));
    expect(hit.source).toBe("rule");
    const miss = await resolveForwardingPlan(ORG, signals({ sender: "billing@other.com" }));
    expect(miss.source).not.toBe("rule");
  });

  it("matches a specific mailbox and ignores other mailboxes", async () => {
    H.state.destinations = [dest("D1", "d1@atlas.test")];
    H.state.rules = [rule("R1", { match_integration_id: "mbx-1", destination_id: "D1" })];
    expect((await resolveForwardingPlan(ORG, signals({ integrationId: "mbx-1" }))).source).toBe("rule");
    expect((await resolveForwardingPlan(ORG, signals({ integrationId: "mbx-9" }))).source).not.toBe("rule");
  });

  it("honours priority (lower number wins) and skips disabled rules", async () => {
    H.state.destinations = [dest("D-low", "low@atlas.test"), dest("D-high", "high@atlas.test")];
    H.state.rules = [
      rule("R-low", { priority: 100, destination_id: "D-low" }),
      rule("R-high", { priority: 10, destination_id: "D-high" }),
      rule("R-disabled", { priority: 1, destination_id: "D-low", enabled: 0 }),
    ];
    const plan = await resolveForwardingPlan(ORG, signals());
    expect(plan.matchedRuleId).toBe("R-high"); // priority 10 beats 100; disabled priority-1 skipped
    expect(plan.destination).toBe("high@atlas.test");
  });
});

describe("resolveForwardingPlan — fallback destination", () => {
  it("uses the fallback when the primary destination is inactive", async () => {
    H.state.destinations = [dest("D-primary", "primary@atlas.test", { active: false }), dest("D-fallback", "fallback@atlas.test")];
    H.state.rules = [rule("R1", { destination_id: "D-primary", fallback_destination_id: "D-fallback" })];
    const plan = await resolveForwardingPlan(ORG, signals());
    expect(plan.source).toBe("rule_fallback");
    expect(plan.destination).toBe("fallback@atlas.test");
  });

  it("falls back to the legacy default when a matched rule has no usable destination", async () => {
    H.legacy = { financeDestination: "finance@atlas.test", minConfidence: 70, enabled: true };
    H.state.destinations = [dest("D-primary", "primary@atlas.test", { active: false })];
    H.state.rules = [rule("R1", { destination_id: "D-primary" })];
    const plan = await resolveForwardingPlan(ORG, signals());
    expect(plan.source).toBe("legacy");
    expect(plan.destination).toBe("finance@atlas.test");
    expect(plan.matchedRuleId).toBe("R1"); // records which rule matched but couldn't route
  });
});

describe("resolveForwardingPlan — organization isolation", () => {
  it("never sees another organization's rules or destinations", async () => {
    H.legacy = { financeDestination: null, minConfidence: 70, enabled: true };
    H.state.destinations = [dest("D-other", "other@isdi.test", { org: OTHER })];
    H.state.rules = [rule("R-other", { organization_id: OTHER, destination_id: "D-other" })];
    const plan = await resolveForwardingPlan(ORG, signals());
    expect(plan.source).toBe("none"); // ORG has no rules, no legacy dest
    expect(plan.destination).toBeNull();
  });
});

describe("resolveForwardingPlan — CC merge", () => {
  it("merges destination CC with org-wide CC, de-duplicated and lowercased", async () => {
    H.orgCc = [{ id: "c1", email: "Acc@Atlas.test" }];
    H.state.destinations = [dest("D1", "d1@atlas.test", { cc: ["team@atlas.test", "acc@atlas.test"] })];
    H.state.rules = [rule("R1", { destination_id: "D1" })];
    const plan = await resolveForwardingPlan(ORG, signals());
    expect(plan.cc).toEqual(["team@atlas.test", "acc@atlas.test"]); // 'acc@atlas.test' not duplicated
  });
});

describe("categoryKeyForClassification", () => {
  it("maps classifications to the four system categories", () => {
    expect(categoryKeyForClassification("supplier_invoice")).toBe("invoice");
    expect(categoryKeyForClassification("credit_note")).toBe("invoice");
    expect(categoryKeyForClassification("purchase_order")).toBe("purchase_order");
    expect(categoryKeyForClassification("general_finance")).toBe("statement");
    expect(categoryKeyForClassification("payment_confirmation")).toBe("other");
    expect(categoryKeyForClassification("irrelevant")).toBe("other");
  });
});

describe("testForwardingRules — dry run (never forwards)", () => {
  it("reports queue_for_approval for a non-auto rule above the threshold", async () => {
    H.state.destinations = [dest("D1", "d1@atlas.test")];
    H.state.rules = [rule("R1", { destination_id: "D1", auto_forward: 0, min_confidence: "70.00" })];
    const r = await testForwardingRules(ORG, signals({ confidencePct: 90 }));
    expect(r.wouldAction).toBe("queue_for_approval");
    expect(r.destination).toBe("d1@atlas.test");
  });

  it("reports auto_forward for an auto rule at/above threshold", async () => {
    H.state.destinations = [dest("D1", "d1@atlas.test")];
    H.state.rules = [rule("R1", { destination_id: "D1", auto_forward: 1, min_confidence: "70.00" })];
    const r = await testForwardingRules(ORG, signals({ confidencePct: 95 }));
    expect(r.wouldAction).toBe("auto_forward");
  });

  it("reports hold_for_review below the effective threshold", async () => {
    H.state.destinations = [dest("D1", "d1@atlas.test")];
    H.state.rules = [rule("R1", { destination_id: "D1", auto_forward: 1, min_confidence: "80.00" })];
    const r = await testForwardingRules(ORG, signals({ confidencePct: 50 }));
    expect(r.wouldAction).toBe("hold_for_review");
  });

  it("legacy path uses the mailbox auto-forward switch", async () => {
    H.legacy = { financeDestination: "finance@atlas.test", minConfidence: 70, enabled: true };
    const auto = await testForwardingRules(ORG, signals({ confidencePct: 90 }));
    expect(auto.source).toBe("legacy");
    expect(auto.wouldAction).toBe("queue_for_approval"); // mailboxAutoForward defaults off
    const withAuto = await testForwardingRules(ORG, { ...signals({ confidencePct: 90 }), mailboxAutoForward: true });
    expect(withAuto.wouldAction).toBe("auto_forward");
  });

  it("reports no_forward when nothing routes", async () => {
    H.legacy = { financeDestination: null, minConfidence: 70, enabled: true };
    const r = await testForwardingRules(ORG, signals());
    expect(r.wouldAction).toBe("no_forward");
    expect(r.destination).toBeNull();
  });
});

// --- Audit #1: same-priority determinism ------------------------------------

describe("same-priority determinism", () => {
  it("breaks ties deterministically by id when priority (and created_at) are equal", async () => {
    H.state.destinations = [dest("D-a", "a@atlas.test"), dest("D-b", "b@atlas.test")];
    // Both priority 50, same created_at; the id tiebreak must decide — 'R-aaa' < 'R-bbb'.
    H.state.rules = [
      rule("R-bbb", { priority: 50, destination_id: "D-b", created_at: "2026-01-01T00:00:00.000Z" }),
      rule("R-aaa", { priority: 50, destination_id: "D-a", created_at: "2026-01-01T00:00:00.000Z" }),
    ];
    const plan = await resolveForwardingPlan(ORG, signals());
    expect(plan.matchedRuleId).toBe("R-aaa");
    expect(plan.destination).toBe("a@atlas.test");
  });

  it("at equal priority, the earlier created_at wins over id", async () => {
    H.state.destinations = [dest("D-a", "a@atlas.test"), dest("D-b", "b@atlas.test")];
    H.state.rules = [
      rule("R-aaa", { priority: 50, destination_id: "D-a", created_at: "2026-02-01T00:00:00.000Z" }),
      rule("R-bbb", { priority: 50, destination_id: "D-b", created_at: "2026-01-01T00:00:00.000Z" }),
    ];
    const plan = await resolveForwardingPlan(ORG, signals());
    expect(plan.matchedRuleId).toBe("R-bbb"); // earlier created_at, despite higher id
  });
});

// --- Audit #2: fallback when BOTH destinations are unusable ------------------

describe("fallback — primary AND fallback both unusable", () => {
  it("both inactive → legacy default, recording the matched rule", async () => {
    H.legacy = { financeDestination: "finance@atlas.test", minConfidence: 70, enabled: true };
    H.state.destinations = [
      dest("D-primary", "primary@atlas.test", { active: false }),
      dest("D-fallback", "fallback@atlas.test", { active: false }),
    ];
    H.state.rules = [rule("R1", { destination_id: "D-primary", fallback_destination_id: "D-fallback" })];
    const plan = await resolveForwardingPlan(ORG, signals());
    expect(plan.source).toBe("legacy");
    expect(plan.destination).toBe("finance@atlas.test");
    expect(plan.matchedRuleId).toBe("R1");
  });

  it("both unusable and NO legacy default → nothing forwarded (not silently dropped elsewhere)", async () => {
    H.legacy = { financeDestination: null, minConfidence: 70, enabled: true };
    H.state.destinations = [dest("D-primary", "primary@atlas.test", { active: false })];
    H.state.rules = [rule("R1", { destination_id: "D-primary" })];
    const plan = await resolveForwardingPlan(ORG, signals());
    expect(plan.source).toBe("none");
    expect(plan.destination).toBeNull();
    expect(plan.matchedRuleId).toBe("R1");
  });

  it("destination row missing entirely (deleted/unavailable) → same safe fallback", async () => {
    H.legacy = { financeDestination: "finance@atlas.test", minConfidence: 70, enabled: true };
    H.state.destinations = []; // the rule points at an id that no longer resolves
    H.state.rules = [rule("R1", { destination_id: "D-gone" })];
    const plan = await resolveForwardingPlan(ORG, signals());
    expect(plan.source).toBe("legacy");
    expect(plan.destination).toBe("finance@atlas.test");
  });
});

// --- Audit #3: auto-forward precedence / review-first ------------------------

describe("auto-forward precedence and review-first safeguards", () => {
  it("default (no rules) keeps review-first when the mailbox auto-forward is OFF", async () => {
    H.legacy = { financeDestination: "finance@atlas.test", minConfidence: 70, enabled: true };
    const r = await testForwardingRules(ORG, signals({ confidencePct: 99 }));
    expect(r.source).toBe("legacy");
    expect(r.wouldAction).toBe("queue_for_approval"); // NOT auto — account switch defaults off
  });

  it("a matched rule with auto_forward OFF never auto-sends, even if the mailbox switch is ON", async () => {
    H.state.destinations = [dest("D1", "d1@atlas.test")];
    H.state.rules = [rule("R1", { destination_id: "D1", auto_forward: 0, min_confidence: "70.00" })];
    // mailboxAutoForward=true must be IGNORED once a rule matches (rule governs).
    const r = await testForwardingRules(ORG, { ...signals({ confidencePct: 99 }), mailboxAutoForward: true });
    expect(r.source).toBe("rule");
    expect(r.wouldAction).toBe("queue_for_approval");
  });

  it("a rule only auto-forwards when auto_forward is explicitly ON and confidence ≥ threshold", async () => {
    H.state.destinations = [dest("D1", "d1@atlas.test")];
    H.state.rules = [rule("R1", { destination_id: "D1", auto_forward: 1, min_confidence: "70.00" })];
    expect((await testForwardingRules(ORG, signals({ confidencePct: 95 }))).wouldAction).toBe("auto_forward");
    expect((await testForwardingRules(ORG, signals({ confidencePct: 50 }))).wouldAction).toBe("hold_for_review");
  });
});

// --- Audit #4: dry-run parity with the live sync decision --------------------

/**
 * Replicate the sync's decision EXACTLY (resolver plan → effectiveAuto →
 * decideForwardStatus) and assert the dry-run's wouldAction corresponds, across
 * a matrix. This locks parity so the two can't silently diverge.
 */
describe("dry-run parity with the Gmail sync path", () => {
  const STATUS_TO_ACTION: Record<string, string> = {
    approved: "auto_forward",
    pending: "queue_for_approval",
    review: "hold_for_review",
  };

  it("matches decideForwardStatus for every (confidence × auto × source) combination", async () => {
    const { decideForwardStatus } = await import("@/lib/invoice/services/gmail");
    for (const useRule of [false, true]) {
      for (const auto of [false, true]) {
        for (const conf of [40, 70, 95]) {
          H.state.destinations = useRule ? [dest("D1", "d1@atlas.test")] : [];
          H.state.rules = useRule ? [rule("R1", { destination_id: "D1", auto_forward: auto ? 1 : 0, min_confidence: "70.00" })] : [];
          H.legacy = { financeDestination: useRule ? null : "finance@atlas.test", minConfidence: 70, enabled: true };

          const dry = await testForwardingRules(ORG, { ...signals({ confidencePct: conf }), mailboxAutoForward: auto });
          // Recompute the sync's decision from the same plan.
          const plan = await resolveForwardingPlan(ORG, signals({ confidencePct: conf }));
          const effectiveAuto = plan.source === "legacy" ? auto : plan.autoForward;
          const expected = plan.destination
            ? STATUS_TO_ACTION[decideForwardStatus(conf, plan.minConfidence, effectiveAuto)]
            : "no_forward";
          expect(dry.wouldAction, `useRule=${useRule} auto=${auto} conf=${conf}`).toBe(expected);
          expect(dry.destination).toBe(plan.destination); // same destination too
        }
      }
    }
  });
});
