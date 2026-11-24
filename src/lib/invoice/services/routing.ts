import "server-only";
import type { PoolConnection } from "mysql2/promise";
import { iQuery, iQueryOne, iExecute, iTransaction, isMissingTableError } from "../db";
import { createId } from "@/lib/id";
import { logInvoiceAudit } from "../audit";
import { normalizeEmail, listCcRecipients } from "./forwarding";
import { getForwardingSettings } from "./forwarding";
import { decideForwardStatus, type EmailClassification } from "./gmail";

/**
 * Phase 6 — configurable forwarding routing.
 *
 * Reusable document CATEGORIES, reusable forwarding DESTINATIONS, and priority
 * ordered RULES that route an email to a destination based on organization +
 * connected mailbox + sender + document category, with a fallback destination
 * and per-rule automation overrides.
 *
 * BACKWARD COMPATIBILITY: the resolver (`resolveForwardingPlan`) is PURE (no
 * writes) and, when an org has no matching enabled rule, falls back to the
 * existing single-destination `forwarding_settings` behaviour. So with zero
 * rules configured the agent behaves EXACTLY as before. Every read path is
 * missing-table-safe (returns legacy/empty results) so a deploy-before-migrate
 * state never crashes and never changes behaviour.
 *
 * ISOLATION: every query is scoped by `organization_id`. System document
 * categories (organization_id IS NULL) are shared read-only defaults and are the
 * only cross-org rows; they are never writable through this service.
 */

// --- Category mapping -------------------------------------------------------

/** The 4 built-in system category keys, in display order. */
export const SYSTEM_CATEGORY_KEYS = ["invoice", "purchase_order", "statement", "other"] as const;
export type SystemCategoryKey = (typeof SYSTEM_CATEGORY_KEYS)[number];

/**
 * Map the heuristic email classification to a document-category key. Only the
 * four system categories are produced here; custom categories are assigned by
 * rules/manual action, not by the classifier.
 */
export function categoryKeyForClassification(c: EmailClassification): SystemCategoryKey {
  switch (c) {
    case "supplier_invoice":
    case "credit_note":
      return "invoice";
    case "purchase_order":
      return "purchase_order";
    case "general_finance":
      return "statement";
    default:
      return "other";
  }
}

// --- Document categories ----------------------------------------------------

export interface DocumentCategory {
  id: string;
  organizationId: string | null;
  categoryKey: string;
  label: string;
  isSystem: boolean;
  isActive: boolean;
}

interface CategoryRow {
  id: string;
  organization_id: string | null;
  category_key: string;
  label: string;
  is_system: number | boolean;
  is_active: number | boolean;
}

const mapCategory = (r: CategoryRow): DocumentCategory => ({
  id: r.id,
  organizationId: r.organization_id,
  categoryKey: r.category_key,
  label: r.label,
  isSystem: Boolean(r.is_system),
  isActive: Boolean(r.is_active),
});

/** System defaults + this org's custom categories (system first, then by label). */
export async function listCategories(organizationId: string): Promise<DocumentCategory[]> {
  try {
    const rows = await iQuery<CategoryRow>(
      "SELECT * FROM `document_categories` WHERE `organization_id` IS NULL OR `organization_id`=? " +
        "ORDER BY `is_system` DESC, `label` ASC",
      [organizationId],
    );
    return rows.map(mapCategory);
  } catch (e) {
    if (isMissingTableError(e)) return [];
    throw e;
  }
}

const CATEGORY_KEY_RE = /^[a-z0-9][a-z0-9_]{1,62}[a-z0-9]$/;

/** Add a CUSTOM category for this org (never a system row). */
export async function addCategory(
  organizationId: string,
  actor: { id: string; email: string },
  input: { label: string; key?: string },
): Promise<{ ok: boolean; message: string }> {
  const label = input.label.trim();
  if (label.length < 2 || label.length > 120) return { ok: false, message: "Enter a category name (2–120 characters)." };
  const key = (input.key?.trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")).slice(0, 64);
  if (!CATEGORY_KEY_RE.test(key)) return { ok: false, message: "Category key must be lowercase letters, numbers and underscores." };
  // Guard against colliding with a system key or an existing org key.
  const clash = await iQueryOne<{ id: string }>(
    "SELECT `id` FROM `document_categories` WHERE `category_key`=? AND (`organization_id` IS NULL OR `organization_id`=?)",
    [key, organizationId],
  );
  if (clash) return { ok: false, message: `A category with key "${key}" already exists.` };
  const id = createId();
  await iExecute(
    "INSERT INTO `document_categories` (`id`,`organization_id`,`category_key`,`label`,`is_system`,`is_active`) VALUES (?,?,?,?,FALSE,TRUE)",
    [id, organizationId, key, label],
  );
  await audit(organizationId, actor, "forwarding.category_added", "document_category", id, null, { key, label });
  return { ok: true, message: `Added category "${label}".` };
}

/** Rename / toggle a CUSTOM category (system rows are immutable). */
export async function updateCategory(
  organizationId: string,
  actor: { id: string; email: string },
  id: string,
  input: { label?: string; isActive?: boolean },
): Promise<{ ok: boolean; message: string }> {
  // Transactional + row-locked: the category row is locked FOR UPDATE for the
  // whole check-then-write, serializing against concurrent rule creation/edit
  // (which locks the SAME row). This closes the race where a rule could be added
  // onto a category in the instant it is being deactivated.
  return iTransaction(async (conn) => {
    const [rows] = await conn.query(
      "SELECT * FROM `document_categories` WHERE `id`=? AND `organization_id`=? FOR UPDATE",
      [id, organizationId],
    );
    const row = (rows as CategoryRow[])[0];
    if (!row) return { ok: false, message: "Category not found." };
    if (row.is_system) return { ok: false, message: "System categories cannot be edited." };
    const label = input.label?.trim() ?? row.label;
    if (label.length < 2 || label.length > 120) return { ok: false, message: "Enter a category name (2–120 characters)." };
    const isActive = input.isActive ?? Boolean(row.is_active);

    // Safeguard: block DEACTIVATING a category that a forwarding rule still
    // references (the resolver matches rules by category key regardless of the
    // active flag, so a silent deactivation would leave those rules routing on an
    // "inactive" category). We only guard the active→inactive TRANSITION: renaming
    // an already-inactive category and REACTIVATING one are always allowed. No
    // rule is auto-disabled or modified — the admin must update the rules first.
    if (input.isActive === false && Boolean(row.is_active)) {
      const [cntRows] = await conn.query(
        "SELECT COUNT(*) c FROM `forwarding_rules` WHERE `organization_id`=? AND `match_category_key`=?",
        [organizationId, row.category_key],
      );
      const c = Number((cntRows as Array<{ c: number }>)[0]?.c ?? 0);
      if (c > 0) {
        return {
          ok: false,
          message:
            `This category is used by ${c} forwarding rule(s) and can't be deactivated. ` +
            "Update or remove those rules first, then deactivate it.",
        };
      }
    }

    await conn.query("UPDATE `document_categories` SET `label`=?, `is_active`=? WHERE `id`=? AND `organization_id`=?", [
      label, isActive, id, organizationId,
    ]);
    await logInvoiceAudit(
      { organizationId, actorType: "user", actorUserId: actor.id, actorLabel: actor.email, action: "forwarding.category_updated", entityType: "document_category", entityId: id, before: mapCategory(row), after: { label, isActive } },
      conn,
    );
    return { ok: true, message: "Category updated." };
  });
}

/** Delete a CUSTOM category (system rows cannot be deleted). */
export async function deleteCategory(
  organizationId: string,
  actor: { id: string; email: string },
  id: string,
): Promise<{ ok: boolean; message: string }> {
  // Transactional + row-locked, same as updateCategory: serialize the in-use
  // check and the delete against concurrent rule creation/edit so a rule can
  // never be attached to a category in the instant it is being removed.
  return iTransaction(async (conn) => {
    const [rows] = await conn.query(
      "SELECT * FROM `document_categories` WHERE `id`=? AND `organization_id`=? FOR UPDATE",
      [id, organizationId],
    );
    const row = (rows as CategoryRow[])[0];
    if (!row) return { ok: false, message: "Category not found." };
    if (row.is_system) return { ok: false, message: "System categories cannot be deleted." };
    const [cntRows] = await conn.query(
      "SELECT COUNT(*) c FROM `forwarding_rules` WHERE `organization_id`=? AND `match_category_key`=?",
      [organizationId, row.category_key],
    );
    if (Number((cntRows as Array<{ c: number }>)[0]?.c ?? 0) > 0) {
      return { ok: false, message: "This category is used by a forwarding rule. Remove the rule first." };
    }
    await conn.query("DELETE FROM `document_categories` WHERE `id`=? AND `organization_id`=?", [id, organizationId]);
    await logInvoiceAudit(
      { organizationId, actorType: "user", actorUserId: actor.id, actorLabel: actor.email, action: "forwarding.category_deleted", entityType: "document_category", entityId: id, before: mapCategory(row), after: null },
      conn,
    );
    return { ok: true, message: "Category deleted." };
  });
}

// --- Forwarding destinations ------------------------------------------------

export interface ForwardingDestination {
  id: string;
  name: string;
  email: string;
  cc: string[];
  isActive: boolean;
}

interface DestinationRow {
  id: string;
  name: string;
  email: string;
  cc_emails: string | null;
  is_active: number | boolean;
}

function parseCc(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const mapDestination = (r: DestinationRow): ForwardingDestination => ({
  id: r.id,
  name: r.name,
  email: r.email,
  cc: parseCc(r.cc_emails),
  isActive: Boolean(r.is_active),
});

export async function listDestinations(organizationId: string): Promise<ForwardingDestination[]> {
  try {
    const rows = await iQuery<DestinationRow>(
      "SELECT `id`,`name`,`email`,`cc_emails`,`is_active` FROM `forwarding_destinations` WHERE `organization_id`=? ORDER BY `name` ASC",
      [organizationId],
    );
    return rows.map(mapDestination);
  } catch (e) {
    if (isMissingTableError(e)) return [];
    throw e;
  }
}

/** Validate + de-duplicate a list of CC emails. */
function normalizeCcList(raw: string[] | undefined): { ok: boolean; cc: string[]; bad?: string } {
  const out: string[] = [];
  for (const r of raw ?? []) {
    const trimmed = r.trim();
    if (!trimmed) continue;
    const e = normalizeEmail(trimmed);
    if (!e) return { ok: false, cc: [], bad: trimmed };
    if (!out.includes(e)) out.push(e);
  }
  return { ok: true, cc: out };
}

export async function addDestination(
  organizationId: string,
  actor: { id: string; email: string },
  input: { name: string; email: string; cc?: string[] },
): Promise<{ ok: boolean; message: string; id?: string }> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) return { ok: false, message: "Enter a destination name (2–120 characters)." };
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, message: "Enter a valid destination email." };
  const cc = normalizeCcList(input.cc);
  if (!cc.ok) return { ok: false, message: `"${cc.bad}" is not a valid CC email.` };
  const dupe = await iQueryOne<{ id: string }>(
    "SELECT `id` FROM `forwarding_destinations` WHERE `organization_id`=? AND `email`=?",
    [organizationId, email],
  );
  if (dupe) return { ok: false, message: "A destination with that email already exists." };
  const id = createId();
  await iExecute(
    "INSERT INTO `forwarding_destinations` (`id`,`organization_id`,`name`,`email`,`cc_emails`,`is_active`) VALUES (?,?,?,?,?,TRUE)",
    [id, organizationId, name, email, cc.cc.length ? JSON.stringify(cc.cc) : null],
  );
  await audit(organizationId, actor, "forwarding.destination_added", "forwarding_destination", id, null, { name, email, cc: cc.cc });
  return { ok: true, message: `Added destination "${name}".`, id };
}

export async function updateDestination(
  organizationId: string,
  actor: { id: string; email: string },
  id: string,
  input: { name?: string; email?: string; cc?: string[]; isActive?: boolean },
): Promise<{ ok: boolean; message: string }> {
  const row = await iQueryOne<DestinationRow>(
    "SELECT `id`,`name`,`email`,`cc_emails`,`is_active` FROM `forwarding_destinations` WHERE `id`=? AND `organization_id`=?",
    [id, organizationId],
  );
  if (!row) return { ok: false, message: "Destination not found." };
  const name = input.name?.trim() ?? row.name;
  if (name.length < 2 || name.length > 120) return { ok: false, message: "Enter a destination name (2–120 characters)." };
  const email = input.email !== undefined ? normalizeEmail(input.email) : row.email;
  if (!email) return { ok: false, message: "Enter a valid destination email." };
  const cc = input.cc !== undefined ? normalizeCcList(input.cc) : { ok: true as const, cc: parseCc(row.cc_emails) };
  if (!cc.ok) return { ok: false, message: `"${cc.bad}" is not a valid CC email.` };
  const isActive = input.isActive ?? Boolean(row.is_active);
  if (email !== row.email) {
    const dupe = await iQueryOne<{ id: string }>(
      "SELECT `id` FROM `forwarding_destinations` WHERE `organization_id`=? AND `email`=? AND `id`<>?",
      [organizationId, email, id],
    );
    if (dupe) return { ok: false, message: "Another destination already uses that email." };
  }
  await iExecute(
    "UPDATE `forwarding_destinations` SET `name`=?, `email`=?, `cc_emails`=?, `is_active`=? WHERE `id`=? AND `organization_id`=?",
    [name, email, cc.cc.length ? JSON.stringify(cc.cc) : null, isActive, id, organizationId],
  );
  await audit(organizationId, actor, "forwarding.destination_updated", "forwarding_destination", id, mapDestination(row), {
    name, email, cc: cc.cc, isActive,
  });
  return { ok: true, message: "Destination updated." };
}

export async function deleteDestination(
  organizationId: string,
  actor: { id: string; email: string },
  id: string,
): Promise<{ ok: boolean; message: string }> {
  const row = await iQueryOne<DestinationRow>(
    "SELECT `id`,`name`,`email`,`cc_emails`,`is_active` FROM `forwarding_destinations` WHERE `id`=? AND `organization_id`=?",
    [id, organizationId],
  );
  if (!row) return { ok: false, message: "Destination not found." };
  const inUse = await iQueryOne<{ c: number }>(
    "SELECT COUNT(*) c FROM `forwarding_rules` WHERE `organization_id`=? AND (`destination_id`=? OR `fallback_destination_id`=?)",
    [organizationId, id, id],
  );
  if (Number(inUse?.c ?? 0) > 0) {
    return { ok: false, message: "This destination is used by a forwarding rule. Remove or repoint the rule first." };
  }
  await iExecute("DELETE FROM `forwarding_destinations` WHERE `id`=? AND `organization_id`=?", [id, organizationId]);
  await audit(organizationId, actor, "forwarding.destination_deleted", "forwarding_destination", id, mapDestination(row), null);
  return { ok: true, message: "Destination deleted." };
}

// --- Forwarding rules -------------------------------------------------------

export interface ForwardingRule {
  id: string;
  name: string;
  priority: number;
  matchIntegrationId: string | null;
  matchSender: string | null;
  matchCategoryKey: string | null;
  destinationId: string;
  fallbackDestinationId: string | null;
  autoForward: boolean;
  minConfidence: number | null;
  enabled: boolean;
}

interface RuleRow {
  id: string;
  name: string;
  priority: number;
  match_integration_id: string | null;
  match_sender: string | null;
  match_category_key: string | null;
  destination_id: string;
  fallback_destination_id: string | null;
  auto_forward: number | boolean;
  min_confidence: string | null;
  enabled: number | boolean;
}

const mapRule = (r: RuleRow): ForwardingRule => ({
  id: r.id,
  name: r.name,
  priority: Number(r.priority),
  matchIntegrationId: r.match_integration_id,
  matchSender: r.match_sender,
  matchCategoryKey: r.match_category_key,
  destinationId: r.destination_id,
  fallbackDestinationId: r.fallback_destination_id,
  autoForward: Boolean(r.auto_forward),
  minConfidence: r.min_confidence === null ? null : Number(r.min_confidence),
  enabled: Boolean(r.enabled),
});

export async function listRules(organizationId: string): Promise<ForwardingRule[]> {
  try {
    const rows = await iQuery<RuleRow>(
      // Deterministic order even when two rules share a priority AND a created_at
      // millisecond: `id` is the final, stable tiebreak so evaluation never
      // depends on physical row order.
      "SELECT * FROM `forwarding_rules` WHERE `organization_id`=? ORDER BY `priority` ASC, `created_at` ASC, `id` ASC",
      [organizationId],
    );
    return rows.map(mapRule);
  } catch (e) {
    if (isMissingTableError(e)) return [];
    throw e;
  }
}

export interface RuleInput {
  name: string;
  priority: number;
  matchIntegrationId: string | null;
  matchSender: string | null;
  matchCategoryKey: string | null;
  destinationId: string;
  fallbackDestinationId: string | null;
  autoForward: boolean;
  minConfidence: number | null;
  enabled: boolean;
}

/** Validate a rule's references against THIS org (isolation) + value bounds. */
async function validateRuleInput(
  organizationId: string,
  input: RuleInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 160) return { ok: false, message: "Enter a rule name (2–160 characters)." };
  if (!Number.isFinite(input.priority) || input.priority < 0 || input.priority > 100000) {
    return { ok: false, message: "Priority must be between 0 and 100000." };
  }
  if (input.minConfidence !== null && (input.minConfidence < 0 || input.minConfidence > 100)) {
    return { ok: false, message: "Minimum confidence must be between 0 and 100." };
  }
  // destination + fallback must be THIS org's destinations.
  const dest = await iQueryOne<{ id: string }>(
    "SELECT `id` FROM `forwarding_destinations` WHERE `organization_id`=? AND `id`=?",
    [organizationId, input.destinationId],
  );
  if (!dest) return { ok: false, message: "Choose a valid destination." };
  if (input.fallbackDestinationId) {
    if (input.fallbackDestinationId === input.destinationId) {
      return { ok: false, message: "The fallback must differ from the primary destination." };
    }
    const fb = await iQueryOne<{ id: string }>(
      "SELECT `id` FROM `forwarding_destinations` WHERE `organization_id`=? AND `id`=?",
      [organizationId, input.fallbackDestinationId],
    );
    if (!fb) return { ok: false, message: "Choose a valid fallback destination." };
  }
  // match mailbox (if set) must be THIS org's connected account.
  if (input.matchIntegrationId) {
    const acct = await iQueryOne<{ id: string }>(
      "SELECT `id` FROM `gmail_integrations` WHERE `organization_id`=? AND `id`=?",
      [organizationId, input.matchIntegrationId],
    );
    if (!acct) return { ok: false, message: "Choose a valid connected mailbox." };
  }
  // match category (if set) must be a system default or this org's category, AND
  // must be ACTIVE — a rule can never be created/edited onto an inactive
  // category (the resolver matches by key regardless of the active flag, so
  // allowing it would resurrect a deliberately-retired category). This is a fast
  // pre-check for a clear message; the authoritative, race-safe check runs under
  // a row lock inside the transaction (assertActiveCategoryLocked).
  if (input.matchCategoryKey) {
    const cat = await iQueryOne<{ id: string; is_active: number | boolean }>(
      "SELECT `id`, `is_active` FROM `document_categories` WHERE `category_key`=? AND (`organization_id` IS NULL OR `organization_id`=?)",
      [input.matchCategoryKey, organizationId],
    );
    if (!cat) return { ok: false, message: "Choose a valid document category." };
    if (!cat.is_active) {
      return { ok: false, message: "That document category is inactive — reactivate it or choose another, then save the rule." };
    }
  }
  return { ok: true };
}

/** Thrown inside a routing transaction to roll back with a user-facing message. */
class RoutingTxnError extends Error {}

/**
 * Lock the referenced category row FOR UPDATE and assert it is usable (a system
 * default, or an ACTIVE category of this org). Serializes rule writes against
 * concurrent category deactivation/deletion: whichever transaction commits
 * first, the other observes the committed state (a new rule → deactivation
 * blocked; a deactivation → rule rejected), so a rule can never end up
 * referencing an inactive or removed category (TOCTOU-safe). Must run inside
 * iTransaction, and the category CRUD paths lock the SAME row FOR UPDATE.
 */
async function assertActiveCategoryLocked(
  conn: PoolConnection,
  organizationId: string,
  categoryKey: string,
): Promise<void> {
  const [rows] = await conn.query(
    "SELECT `is_active` FROM `document_categories` WHERE `category_key`=? AND (`organization_id` IS NULL OR `organization_id`=?) FOR UPDATE",
    [categoryKey, organizationId],
  );
  const row = (rows as Array<{ is_active: number | boolean }>)[0];
  if (!row) throw new RoutingTxnError("Choose a valid document category.");
  if (!row.is_active) {
    throw new RoutingTxnError("That document category is inactive — reactivate it or choose another, then save the rule.");
  }
}

export async function addRule(
  organizationId: string,
  actor: { id: string; email: string },
  input: RuleInput,
): Promise<{ ok: boolean; message: string; id?: string }> {
  const v = await validateRuleInput(organizationId, input);
  if (!v.ok) return v;
  const id = createId();
  // Transactional: lock the referenced category FOR UPDATE and re-check it is
  // active before inserting, so a concurrent deactivation/deletion can't slip
  // between the check and the write. The audit is written on the same connection
  // so it commits atomically with the rule.
  try {
    await iTransaction(async (conn) => {
      if (input.matchCategoryKey) await assertActiveCategoryLocked(conn, organizationId, input.matchCategoryKey);
      await conn.query(
        "INSERT INTO `forwarding_rules` (`id`,`organization_id`,`name`,`priority`,`match_integration_id`,`match_sender`," +
          "`match_category_key`,`destination_id`,`fallback_destination_id`,`auto_forward`,`min_confidence`,`enabled`) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id, organizationId, input.name.trim(), input.priority, input.matchIntegrationId,
          input.matchSender?.trim() || null, input.matchCategoryKey || null, input.destinationId,
          input.fallbackDestinationId, input.autoForward, input.minConfidence === null ? null : input.minConfidence.toFixed(2),
          input.enabled,
        ],
      );
      await logInvoiceAudit(
        { organizationId, actorType: "user", actorUserId: actor.id, actorLabel: actor.email, action: "forwarding.rule_added", entityType: "forwarding_rule", entityId: id, before: null, after: { ...input } },
        conn,
      );
    });
  } catch (e) {
    if (e instanceof RoutingTxnError) return { ok: false, message: e.message };
    throw e;
  }
  return { ok: true, message: `Added rule "${input.name.trim()}".`, id };
}

export async function updateRule(
  organizationId: string,
  actor: { id: string; email: string },
  id: string,
  input: RuleInput,
): Promise<{ ok: boolean; message: string }> {
  const existing = await iQueryOne<RuleRow>(
    "SELECT * FROM `forwarding_rules` WHERE `id`=? AND `organization_id`=?",
    [id, organizationId],
  );
  if (!existing) return { ok: false, message: "Rule not found." };
  const v = await validateRuleInput(organizationId, input);
  if (!v.ok) return v;
  try {
    await iTransaction(async (conn) => {
      if (input.matchCategoryKey) await assertActiveCategoryLocked(conn, organizationId, input.matchCategoryKey);
      await conn.query(
        "UPDATE `forwarding_rules` SET `name`=?, `priority`=?, `match_integration_id`=?, `match_sender`=?, " +
          "`match_category_key`=?, `destination_id`=?, `fallback_destination_id`=?, `auto_forward`=?, `min_confidence`=?, `enabled`=? " +
          "WHERE `id`=? AND `organization_id`=?",
        [
          input.name.trim(), input.priority, input.matchIntegrationId, input.matchSender?.trim() || null,
          input.matchCategoryKey || null, input.destinationId, input.fallbackDestinationId, input.autoForward,
          input.minConfidence === null ? null : input.minConfidence.toFixed(2), input.enabled, id, organizationId,
        ],
      );
      await logInvoiceAudit(
        { organizationId, actorType: "user", actorUserId: actor.id, actorLabel: actor.email, action: "forwarding.rule_updated", entityType: "forwarding_rule", entityId: id, before: mapRule(existing), after: { ...input } },
        conn,
      );
    });
  } catch (e) {
    if (e instanceof RoutingTxnError) return { ok: false, message: e.message };
    throw e;
  }
  return { ok: true, message: "Rule updated." };
}

export async function deleteRule(
  organizationId: string,
  actor: { id: string; email: string },
  id: string,
): Promise<{ ok: boolean; message: string }> {
  const existing = await iQueryOne<RuleRow>(
    "SELECT * FROM `forwarding_rules` WHERE `id`=? AND `organization_id`=?",
    [id, organizationId],
  );
  if (!existing) return { ok: false, message: "Rule not found." };
  await iExecute("DELETE FROM `forwarding_rules` WHERE `id`=? AND `organization_id`=?", [id, organizationId]);
  await audit(organizationId, actor, "forwarding.rule_deleted", "forwarding_rule", id, mapRule(existing), null);
  return { ok: true, message: "Rule deleted." };
}

// --- Resolver (PURE: no writes) ---------------------------------------------

export interface RoutingSignals {
  integrationId: string;
  sender: string;
  categoryKey: string;
  /** Classification confidence as a percentage (0–100). */
  confidencePct: number;
}

export interface ForwardingPlan {
  /** The chosen destination email, or null when nothing should be forwarded. */
  destination: string | null;
  /** Merged, de-duplicated CC list (destination CC ∪ org-wide CC). */
  cc: string[];
  /** Effective minimum confidence to auto/queue (percentage). */
  minConfidence: number;
  /** Whether this destination is eligible for auto-forward. */
  autoForward: boolean;
  /** How the destination was chosen. */
  source: "rule" | "rule_fallback" | "legacy" | "none";
  /** The matched rule id (when source is rule/rule_fallback). */
  matchedRuleId: string | null;
  /** Human-readable explanation (for the dry-run UI / audit). */
  explanation: string;
}

/** Does a single rule match the signals? NULL conditions mean "any". */
function ruleMatches(rule: ForwardingRule, s: RoutingSignals): boolean {
  if (rule.matchIntegrationId && rule.matchIntegrationId !== s.integrationId) return false;
  if (rule.matchCategoryKey && rule.matchCategoryKey !== s.categoryKey) return false;
  if (rule.matchSender) {
    const needle = rule.matchSender.trim().toLowerCase();
    if (needle && !s.sender.toLowerCase().includes(needle)) return false;
  }
  return true;
}

/**
 * Resolve where (and whether) an ingested email should be forwarded. PURE — it
 * performs no writes, so the live sync and the dry-run test use the SAME logic.
 *
 * Precedence:
 *   1. The first ENABLED rule (priority ASC, oldest first) whose conditions all
 *      match. Its destination is used if active, else its fallback destination.
 *   2. If no rule matches (or none exist), the LEGACY org default from
 *      forwarding_settings (preserving the pre-Phase-6 behaviour exactly).
 */
export async function resolveForwardingPlan(
  organizationId: string,
  signals: RoutingSignals,
  // Optional pre-loaded data so a tight sync loop can avoid re-querying per message.
  preloaded?: { rules?: ForwardingRule[]; destinations?: ForwardingDestination[]; orgCc?: string[] },
): Promise<ForwardingPlan> {
  const legacy = await getForwardingSettings(organizationId);
  const legacyDest = legacy.enabled && legacy.financeDestination ? legacy.financeDestination : null;
  const orgCc = preloaded?.orgCc ?? (await listCcRecipients(organizationId)).map((r) => r.email);

  let rules = preloaded?.rules;
  let destinations = preloaded?.destinations;
  try {
    if (!rules) rules = await listRules(organizationId);
    if (!destinations) destinations = await listDestinations(organizationId);
  } catch (e) {
    if (!isMissingTableError(e)) throw e;
    rules = [];
    destinations = [];
  }
  const destById = new Map(destinations.map((d) => [d.id, d]));

  const mergeCc = (destCc: string[]): string[] => {
    const out: string[] = [];
    for (const e of [...destCc, ...orgCc]) {
      const n = e.toLowerCase();
      if (!out.includes(n)) out.push(n);
    }
    return out;
  };

  for (const rule of rules.filter((r) => r.enabled)) {
    if (!ruleMatches(rule, signals)) continue;
    const primary = destById.get(rule.destinationId);
    const fallback = rule.fallbackDestinationId ? destById.get(rule.fallbackDestinationId) : undefined;
    const chosen = primary?.isActive ? primary : fallback?.isActive ? fallback : null;
    if (!chosen) {
      // The matched rule has no usable destination. Do NOT fall through to other
      // rules (the admin's highest-priority match wins); fall back to legacy so
      // an invoice is never silently dropped, and explain why.
      if (legacyDest) {
        return {
          destination: legacyDest, cc: mergeCc([]), minConfidence: legacy.minConfidence, autoForward: false,
          source: "legacy", matchedRuleId: rule.id,
          explanation: `Rule "${rule.name}" matched but its destination is inactive/removed; used the default destination.`,
        };
      }
      return {
        destination: null, cc: [], minConfidence: legacy.minConfidence, autoForward: false,
        source: "none", matchedRuleId: rule.id,
        explanation: `Rule "${rule.name}" matched but its destination is inactive and no default destination is set.`,
      };
    }
    const usedFallback = chosen !== primary;
    return {
      destination: chosen.email,
      cc: mergeCc(chosen.cc),
      minConfidence: rule.minConfidence ?? legacy.minConfidence,
      autoForward: rule.autoForward,
      source: usedFallback ? "rule_fallback" : "rule",
      matchedRuleId: rule.id,
      explanation: usedFallback
        ? `Rule "${rule.name}" matched; primary destination inactive, used fallback ${chosen.email}.`
        : `Rule "${rule.name}" matched → ${chosen.email}.`,
    };
  }

  // No rule matched → legacy single-destination behaviour (unchanged).
  if (legacyDest) {
    return {
      destination: legacyDest, cc: mergeCc([]), minConfidence: legacy.minConfidence, autoForward: false,
      source: "legacy", matchedRuleId: null,
      explanation: rules.length
        ? "No forwarding rule matched; used the default destination."
        : "Used the default destination (no rules configured).",
    };
  }
  return {
    destination: null, cc: [], minConfidence: legacy.minConfidence, autoForward: false,
    source: "none", matchedRuleId: null,
    explanation: "No matching rule and no default destination — nothing will be forwarded.",
  };
}

// --- Dry-run / test mode ----------------------------------------------------

export interface DryRunInput {
  integrationId: string;
  sender: string;
  categoryKey: string;
  confidencePct: number;
  /** The connected mailbox's auto-forward switch (for the legacy path preview). */
  mailboxAutoForward?: boolean;
}

export interface DryRunResult extends ForwardingPlan {
  /** The forward-task status this email WOULD get (no task is created). */
  wouldAction: "auto_forward" | "queue_for_approval" | "hold_for_review" | "no_forward";
  categoryKey: string;
}

/**
 * Evaluate the rules for a hypothetical email WITHOUT creating any forward task,
 * approving, or sending. Used by the Settings "Test rules" panel so an admin can
 * verify routing before enabling a rule.
 */
export async function testForwardingRules(organizationId: string, input: DryRunInput): Promise<DryRunResult> {
  const plan = await resolveForwardingPlan(organizationId, {
    integrationId: input.integrationId,
    sender: input.sender,
    categoryKey: input.categoryKey,
    confidencePct: input.confidencePct,
  });

  // PARITY: use the EXACT same decision function (`decideForwardStatus`) and the
  // EXACT same `effectiveAuto` rule the live Gmail sync uses, so the dry-run can
  // never silently diverge from what the sync would actually do. The only
  // difference is that nothing is written, enqueued or sent here.
  //   sync:     effectiveAuto = source === "legacy" ? integration.auto_forward : plan.autoForward
  //   dry-run:  effectiveAuto = source === "legacy" ? input.mailboxAutoForward : plan.autoForward
  let wouldAction: DryRunResult["wouldAction"] = "no_forward";
  if (plan.destination) {
    const effectiveAuto = plan.source === "legacy" ? Boolean(input.mailboxAutoForward) : plan.autoForward;
    const status = decideForwardStatus(input.confidencePct, plan.minConfidence, effectiveAuto);
    wouldAction = status === "approved" ? "auto_forward" : status === "pending" ? "queue_for_approval" : "hold_for_review";
  }
  return { ...plan, wouldAction, categoryKey: input.categoryKey };
}

// --- audit helper -----------------------------------------------------------

async function audit(
  organizationId: string,
  actor: { id: string; email: string },
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await logInvoiceAudit({
    organizationId,
    actorType: "user",
    actorUserId: actor.id,
    actorLabel: actor.email,
    action,
    entityType,
    entityId,
    before,
    after,
  }).catch(() => undefined);
}
