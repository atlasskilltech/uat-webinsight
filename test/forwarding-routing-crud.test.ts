import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Phase 6 audit — CRUD-level organization isolation (#5), category lifecycle
 * (#6) and audit completeness (#8).
 *
 * A compact stateful DB mock answers exactly the queries the routing service
 * issues, enforcing organization scoping so cross-org references are rejected
 * the same way the real SQL (`WHERE organization_id = ?`) would.
 */

const S = vi.hoisted(() => ({
  destinations: [] as Record<string, unknown>[],
  mailboxes: [] as Record<string, unknown>[],
  categories: [] as Record<string, unknown>[],
  rules: [] as Record<string, unknown>[],
  locks: [] as string[], // records every `SELECT … FOR UPDATE` issued in a txn
}));

const auditSpy = vi.hoisted(() =>
  vi.fn(async (_entry: { action: string; entityType?: string; entityId?: string; before?: unknown; after?: unknown }) => undefined),
);
const execSpy = vi.hoisted(() => vi.fn(async (_sql: string, ..._p: unknown[]) => ({ affectedRows: 1 })));

vi.mock("@/lib/invoice/audit", () => ({ logInvoiceAudit: auditSpy }));

vi.mock("@/lib/invoice/services/forwarding", () => ({
  getForwardingSettings: vi.fn(async () => ({ financeDestination: null, minConfidence: 70, enabled: true })),
  listCcRecipients: vi.fn(async () => []),
  normalizeEmail: (raw: string) => {
    const e = raw.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
  },
}));

vi.mock("@/lib/invoice/db", () => {
  // Shared row resolver — used by both iQueryOne and the transaction's
  // conn.query, so the transactional category paths (SELECT … FOR UPDATE) behave
  // identically. Defined inside the factory so it is available when the mocked
  // module is first imported (no temporal-dead-zone on hoisted mocks).
  const resolveRow = (sql: string, params: unknown[]): Record<string, unknown> | null => {
    const p = params ?? [];
    if (sql.includes("`forwarding_destinations`") && sql.includes("`id`=?") && !sql.includes("`email`=?") && !sql.includes("COUNT")) {
      const idFirst = sql.indexOf("`id`=?") < sql.indexOf("`organization_id`=?");
      const id = idFirst ? p[0] : p[1];
      const org = idFirst ? p[1] : p[0];
      return S.destinations.find((d) => d.organization_id === org && d.id === id) ?? null;
    }
    if (sql.includes("`forwarding_destinations`") && sql.includes("`email`=?")) {
      const [org, email] = p;
      return S.destinations.find((d) => d.organization_id === org && d.email === email) ?? null;
    }
    if (sql.includes("`gmail_integrations`")) {
      const [org, id] = p;
      return S.mailboxes.find((m) => m.organization_id === org && m.id === id) ?? null;
    }
    // Category by key (system OR this org) — also the FOR UPDATE lock query.
    if (sql.includes("`document_categories`") && sql.includes("`category_key`=?")) {
      const [key, org] = p;
      return S.categories.find((c) => c.category_key === key && (c.organization_id === null || c.organization_id === org)) ?? null;
    }
    // Category by org + id (incl. FOR UPDATE in update/delete).
    if (sql.includes("`document_categories`") && sql.includes("`id`=?")) {
      const [id, org] = p;
      return S.categories.find((c) => c.id === id && c.organization_id === org) ?? null;
    }
    if (sql.includes("COUNT(*)") && sql.includes("`forwarding_rules`") && sql.includes("destination_id`=?")) {
      const [org, id] = p;
      return { c: S.rules.filter((r) => r.organization_id === org && (r.destination_id === id || r.fallback_destination_id === id)).length };
    }
    if (sql.includes("COUNT(*)") && sql.includes("`forwarding_rules`") && sql.includes("`match_category_key`=?")) {
      const [org, key] = p;
      return { c: S.rules.filter((r) => r.organization_id === org && r.match_category_key === key).length };
    }
    if (sql.includes("`forwarding_rules`") && sql.includes("`id`=?")) {
      const [id, org] = p;
      return S.rules.find((r) => r.id === id && r.organization_id === org) ?? null;
    }
    return null;
  };

  // A fake pooled connection for iTransaction: SELECTs resolve via resolveRow and
  // return mysql2-style [rows, fields]; writes go through execSpy.
  const fakeConn = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FOR UPDATE")) S.locks.push(sql);
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
        execSpy(sql, params);
        return [{ affectedRows: 1 }, []];
      }
      const row = resolveRow(sql, params);
      return [row == null ? [] : [row], []];
    },
  };

  return {
    iExecute: (sql: string, ...p: unknown[]) => execSpy(sql, ...p),
    isMissingTableError: () => false,
    ijson: (v: unknown) => (v === undefined ? null : JSON.stringify(v)),
    iQuery: vi.fn(async () => []),
    iQueryOne: vi.fn(async (sql: string, params: unknown[]) => resolveRow(sql, params)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    iTransaction: async (fn: (conn: any) => Promise<unknown>) => fn(fakeConn),
  };
});

import {
  addRule, updateRule, deleteRule, addDestination, deleteDestination,
  addCategory, updateCategory, deleteCategory,
} from "@/lib/invoice/services/routing";

const ORG = "org-atlas";
const OTHER = "org-isdi";
const actor = { id: "u1", email: "admin@atlas.test" };

const baseRuleInput = {
  name: "Route invoices", priority: 100, matchIntegrationId: null, matchSender: null,
  matchCategoryKey: null, destinationId: "D1", fallbackDestinationId: null,
  autoForward: false, minConfidence: null, enabled: true,
};

beforeEach(() => {
  S.destinations = [
    { id: "D1", organization_id: ORG, name: "Finance", email: "fin@atlas.test", cc_emails: null, is_active: 1 },
    { id: "DX", organization_id: OTHER, name: "Other", email: "fin@isdi.test", cc_emails: null, is_active: 1 },
  ];
  S.mailboxes = [
    { id: "M1", organization_id: ORG },
    { id: "MX", organization_id: OTHER },
  ];
  S.categories = [
    { id: "sys_cat_invoice", organization_id: null, category_key: "invoice", label: "Invoice", is_system: 1, is_active: 1 },
    { id: "cat-mine", organization_id: ORG, category_key: "my_cat", label: "Mine", is_system: 0, is_active: 1 },
    { id: "cat-retired", organization_id: ORG, category_key: "retired_cat", label: "Retired", is_system: 0, is_active: 0 },
    { id: "cat-theirs", organization_id: OTHER, category_key: "their_cat", label: "Theirs", is_system: 0, is_active: 1 },
  ];
  S.rules = [];
  S.locks = [];
  auditSpy.mockClear();
  execSpy.mockClear();
});

const lockedCategory = () => S.locks.some((s) => s.includes("`document_categories`") && s.includes("FOR UPDATE"));

describe("#5 organization isolation — rules cannot reference another org's entities", () => {
  it("rejects a destination owned by another organization", async () => {
    const res = await addRule(ORG, actor, { ...baseRuleInput, destinationId: "DX" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/valid destination/i);
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("rejects a fallback destination owned by another organization", async () => {
    const res = await addRule(ORG, actor, { ...baseRuleInput, destinationId: "D1", fallbackDestinationId: "DX" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/valid fallback/i);
  });

  it("rejects a connected mailbox owned by another organization", async () => {
    const res = await addRule(ORG, actor, { ...baseRuleInput, matchIntegrationId: "MX" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/valid connected mailbox/i);
  });

  it("rejects a document category owned by another organization", async () => {
    const res = await addRule(ORG, actor, { ...baseRuleInput, matchCategoryKey: "their_cat" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/valid document category/i);
  });

  it("accepts references that all belong to this organization (incl. a system category)", async () => {
    const res = await addRule(ORG, actor, {
      ...baseRuleInput, destinationId: "D1", matchIntegrationId: "M1", matchCategoryKey: "invoice",
    });
    expect(res.ok).toBe(true);
  });
});

describe("#6 category lifecycle", () => {
  it("system categories cannot be edited or deleted", async () => {
    expect((await updateCategory(ORG, actor, "sys_cat_invoice", { label: "x" })).ok).toBe(false);
    expect((await deleteCategory(ORG, actor, "sys_cat_invoice")).ok).toBe(false);
  });

  it("refuses to add a category whose key collides with a system key", async () => {
    const res = await addCategory(ORG, actor, { label: "Invoice", key: "invoice" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/already exists/i);
  });

  it("refuses to delete a custom category still referenced by a rule", async () => {
    S.rules = [{ id: "R1", organization_id: ORG, match_category_key: "my_cat", destination_id: "D1", fallback_destination_id: null }];
    const res = await deleteCategory(ORG, actor, "cat-mine");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/used by a forwarding rule/i);
  });

  it("deletes an unused custom category and audits it", async () => {
    const res = await deleteCategory(ORG, actor, "cat-mine");
    expect(res.ok).toBe(true);
    expect(auditSpy.mock.calls.some((c) => c[0]?.action === "forwarding.category_deleted")).toBe(true);
  });

  it("cannot reach another org's custom category by id", async () => {
    const res = await deleteCategory(ORG, actor, "cat-theirs");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/i);
  });
});

describe("#6b inactive-category safeguard — deactivation blocked while referenced by a rule", () => {
  it("blocks deactivating a custom category that a forwarding rule references", async () => {
    S.rules = [{ id: "R1", organization_id: ORG, match_category_key: "my_cat", destination_id: "D1", fallback_destination_id: null }];
    const res = await updateCategory(ORG, actor, "cat-mine", { isActive: false });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/used by .* forwarding rule|can't be deactivated/i);
  });

  it("does NOT write or audit, and leaves the referencing rule unchanged, on a blocked deactivation", async () => {
    S.rules = [{ id: "R1", organization_id: ORG, match_category_key: "my_cat", destination_id: "D1", fallback_destination_id: null }];
    const before = JSON.parse(JSON.stringify(S.rules));
    const res = await updateCategory(ORG, actor, "cat-mine", { isActive: false });
    expect(res.ok).toBe(false);
    // No UPDATE ran (execSpy untouched) and no category_updated audit emitted.
    expect(execSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalledWith(expect.objectContaining({ action: "forwarding.category_updated" }));
    // The forwarding rule itself is untouched — forwarding behaviour preserved.
    expect(S.rules).toEqual(before);
  });

  it("allows deactivating a custom category that NO rule references", async () => {
    S.rules = []; // nothing references my_cat
    const res = await updateCategory(ORG, actor, "cat-mine", { isActive: false });
    expect(res.ok).toBe(true);
    expect(execSpy).toHaveBeenCalled(); // the UPDATE ran
    expect(auditSpy.mock.calls.some((c) => c[0]?.action === "forwarding.category_updated")).toBe(true);
  });

  it("always allows REACTIVATING a category, even if a rule references it", async () => {
    S.categories = S.categories.map((c) => (c.id === "cat-mine" ? { ...c, is_active: 0 } : c)); // currently inactive
    S.rules = [{ id: "R1", organization_id: ORG, match_category_key: "my_cat", destination_id: "D1", fallback_destination_id: null }];
    const res = await updateCategory(ORG, actor, "cat-mine", { isActive: true });
    expect(res.ok).toBe(true);
  });

  it("allows renaming an active, referenced category without deactivating it", async () => {
    S.rules = [{ id: "R1", organization_id: ORG, match_category_key: "my_cat", destination_id: "D1", fallback_destination_id: null }];
    const res = await updateCategory(ORG, actor, "cat-mine", { label: "Mine (renamed)" });
    expect(res.ok).toBe(true);
  });

  it("maintains organization isolation — cannot deactivate another org's category", async () => {
    S.rules = [{ id: "RX", organization_id: OTHER, match_category_key: "their_cat", destination_id: "DX", fallback_destination_id: null }];
    const res = await updateCategory(ORG, actor, "cat-theirs", { isActive: false });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/i); // scoped out before any rule check
  });

  it("keeps system categories immutable regardless of the new guard", async () => {
    // System rows have organization_id = NULL, so an org-scoped update never
    // loads them (enforced before the guard even runs) → immutable either way.
    const res = await updateCategory(ORG, actor, "sys_cat_invoice", { isActive: false });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found|cannot be edited/i);
  });
});

describe("#1 addRule/validateRuleInput rejects INACTIVE custom categories", () => {
  it("refuses to create a rule matching an inactive custom category", async () => {
    const res = await addRule(ORG, actor, { ...baseRuleInput, matchCategoryKey: "retired_cat" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/inactive/i);
    expect(execSpy).not.toHaveBeenCalled(); // no rule written
  });

  it("refuses to UPDATE a rule onto an inactive custom category", async () => {
    S.rules = [{
      id: "R1", organization_id: ORG, name: "r", priority: 100, match_integration_id: null, match_sender: null,
      match_category_key: null, destination_id: "D1", fallback_destination_id: null, auto_forward: 0, min_confidence: null, enabled: 1,
    }];
    const res = await updateRule(ORG, actor, "R1", { ...baseRuleInput, matchCategoryKey: "retired_cat" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/inactive/i);
  });

  it("still allows a rule matching an ACTIVE custom category", async () => {
    const res = await addRule(ORG, actor, { ...baseRuleInput, matchCategoryKey: "my_cat" });
    expect(res.ok).toBe(true);
  });
});

describe("#2/#3 transactional row-locking serializes rule writes vs category changes", () => {
  it("addRule locks the referenced category FOR UPDATE inside the transaction", async () => {
    const res = await addRule(ORG, actor, { ...baseRuleInput, matchCategoryKey: "my_cat" });
    expect(res.ok).toBe(true);
    expect(lockedCategory()).toBe(true); // the category row is locked before the insert commits
    expect(execSpy).toHaveBeenCalled(); // and the rule is written in the same transaction
  });

  it("a rule with no category match still commits transactionally (no category lock needed)", async () => {
    const res = await addRule(ORG, actor, { ...baseRuleInput, matchCategoryKey: null });
    expect(res.ok).toBe(true);
    expect(lockedCategory()).toBe(false);
    expect(execSpy).toHaveBeenCalled();
  });

  it("updateCategory deactivation runs under a category row lock", async () => {
    await updateCategory(ORG, actor, "cat-mine", { isActive: false }); // no rules → allowed
    expect(lockedCategory()).toBe(true);
  });

  it("deleteCategory runs under a category row lock", async () => {
    await deleteCategory(ORG, actor, "cat-mine");
    expect(lockedCategory()).toBe(true);
  });

  it("a blocked deactivation writes nothing and leaves rules intact (atomic rollback-safe)", async () => {
    S.rules = [{ id: "R1", organization_id: ORG, match_category_key: "my_cat", destination_id: "D1", fallback_destination_id: null }];
    const before = JSON.parse(JSON.stringify(S.rules));
    const res = await updateCategory(ORG, actor, "cat-mine", { isActive: false });
    expect(res.ok).toBe(false);
    expect(lockedCategory()).toBe(true); // it DID take the lock and check under it
    expect(execSpy).not.toHaveBeenCalled(); // but committed no write
    expect(S.rules).toEqual(before);
  });
});

describe("#8 audit completeness — destinations, categories, rules, priority, fallback, auto-forward", () => {
  it("records rule creation with priority, fallback and auto_forward in the after-snapshot", async () => {
    const res = await addRule(ORG, actor, {
      ...baseRuleInput, name: "Auto PO", priority: 5, destinationId: "D1",
      fallbackDestinationId: null, autoForward: true, minConfidence: 80,
    });
    expect(res.ok).toBe(true);
    const call = auditSpy.mock.calls.find((c) => c[0].action === "forwarding.rule_added");
    expect(call).toBeTruthy();
    expect(call![0]).toMatchObject({
      action: "forwarding.rule_added", entityType: "forwarding_rule",
      after: expect.objectContaining({ priority: 5, autoForward: true, minConfidence: 80 }),
    });
  });

  it("records rule updates with a before AND after snapshot", async () => {
    S.rules = [{
      id: "R1", organization_id: ORG, name: "old", priority: 100, match_integration_id: null,
      match_sender: null, match_category_key: null, destination_id: "D1", fallback_destination_id: null,
      auto_forward: 0, min_confidence: null, enabled: 1,
    }];
    const res = await updateRule(ORG, actor, "R1", { ...baseRuleInput, name: "new", priority: 10, autoForward: true });
    expect(res.ok).toBe(true);
    const call = auditSpy.mock.calls.find((c) => c[0].action === "forwarding.rule_updated");
    expect(call![0].before).toMatchObject({ name: "old", priority: 100, autoForward: false });
    expect(call![0].after).toMatchObject({ name: "new", priority: 10, autoForward: true });
  });

  it("records destination creation and rule deletion", async () => {
    await addDestination(ORG, actor, { name: "AP", email: "ap@atlas.test", cc: ["x@atlas.test"] });
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({ action: "forwarding.destination_added" }));

    S.rules = [{ id: "R9", organization_id: ORG, name: "r", priority: 1, match_integration_id: null, match_sender: null, match_category_key: null, destination_id: "D1", fallback_destination_id: null, auto_forward: 0, min_confidence: null, enabled: 1 }];
    await deleteRule(ORG, actor, "R9");
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({ action: "forwarding.rule_deleted", entityId: "R9" }));
  });

  it("blocks deleting a destination that a rule still points at (and does not audit a no-op)", async () => {
    S.rules = [{ id: "R1", organization_id: ORG, match_category_key: null, destination_id: "D1", fallback_destination_id: null }];
    const res = await deleteDestination(ORG, actor, "D1");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/used by a forwarding rule/i);
    expect(auditSpy).not.toHaveBeenCalledWith(expect.objectContaining({ action: "forwarding.destination_deleted" }));
  });
});
