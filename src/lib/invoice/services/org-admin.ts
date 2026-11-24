import "server-only";
import { iQuery, iQueryOne, iExecute } from "../db";
import { queryOne as mainQueryOne } from "@/lib/db";
import { createId } from "@/lib/id";
import { logInvoiceAudit } from "../audit";
import { FINANCE_ROLES, type FinanceRole } from "../types";

/**
 * Organization administration for the Invoice Agent: team membership and the
 * shared organization (GST/company) profile.
 *
 * Design invariants (single shared GST profile per organization):
 *  - GST and company details live ONLY on `organizations` — never per user.
 *  - Employees reuse their existing Web Insight account (the main-app `User`
 *    table); this module NEVER creates a login.
 *  - A user belongs to at most one active organization. Adding someone who
 *    already belongs to a DIFFERENT org is refused (organizations stay isolated;
 *    no automatic merge/move).
 *  - All writes here require the `org.manage` capability (FINANCE_ADMIN), which
 *    the server action enforces before calling.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalize an optional GSTIN for storage/comparison: trim, uppercase, and
 * collapse empty/whitespace-only values to NULL. Storing "" instead of NULL
 * would make the GSTIN unique index treat two "no GSTIN" orgs as colliding, so
 * genuinely GST-less organizations must persist NULL (NULLs aren't unique-constrained).
 */
export function normalizeGstin(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toUpperCase();
  return v === "" ? null : v;
}

/** Trim an optional text field; empty/whitespace-only becomes NULL. */
export function normalizeOptionalText(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return v === "" ? null : v;
}

/** Whether any active organization exists (used only for UI messaging). */
export async function anyActiveOrganizationExists(): Promise<boolean> {
  const row = await iQueryOne<{ id: string }>("SELECT `id` FROM `organizations` WHERE `status`='active' LIMIT 1");
  return Boolean(row);
}

/**
 * Whether a specific organization is active. The processing services call this
 * so a DEACTIVATED org pauses ALL work — including jobs already queued before it
 * was deactivated — at the point of execution (not only at enqueue time). A
 * missing org returns false (treated as paused), never throwing the worker.
 */
export async function isOrganizationActive(organizationId: string): Promise<boolean> {
  const row = await iQueryOne<{ status: string }>(
    "SELECT `status` FROM `organizations` WHERE `id`=?",
    [organizationId],
  );
  return row?.status === "active";
}

/**
 * Whether the user is a Finance Admin of at least one active organization.
 * Finance Admins may create ADDITIONAL organizations (the very first org still
 * needs an app admin, since no Finance Admin exists yet).
 */
export async function isFinanceAdminAnywhere(userId: string, email: string): Promise<boolean> {
  const row = await iQueryOne<{ id: string }>(
    "SELECT m.`id` FROM `organization_members` m JOIN `organizations` o ON o.`id`=m.`organization_id` " +
      "WHERE (m.`user_id`=? OR m.`user_email`=?) AND m.`status`='active' AND m.`role`='FINANCE_ADMIN' AND o.`status`='active' LIMIT 1",
    [userId, email.toLowerCase()],
  );
  return Boolean(row);
}

export interface OrgBrief {
  id: string;
  name: string;
  gstin: string | null;
}

/** All active organizations (id/name/GSTIN) — to warn against accidental dupes. */
export async function listOrganizationsBrief(): Promise<OrgBrief[]> {
  return iQuery<OrgBrief>("SELECT `id`, `name`, `gstin` FROM `organizations` WHERE `status`='active' ORDER BY `created_at` ASC");
}

/**
 * Decide whether a NEW organization would duplicate an existing active one.
 *
 * GSTIN is the authoritative legal-entity identifier, so it is checked first and
 * is normalized (trim + uppercase) on both sides before comparison:
 *   - Same GSTIN  -> same legal entity -> duplicate ("gstin").
 *
 * The name is only a FALLBACK for when GSTIN cannot disambiguate. A same-name
 * match is treated as a duplicate ONLY when the new org has no GSTIN, or the
 * matched existing org has no GSTIN (so we cannot tell them apart). If BOTH have
 * GSTINs and they differ (GSTIN check already passed with no match), two orgs
 * that happen to share a trading name are genuinely SEPARATE legal entities and
 * are ALLOWED. Returns the conflicting org, or null when creation is allowed.
 */
export async function findDuplicateOrganization(
  gstin: string | null,
  name: string,
): Promise<{ matchedOn: "gstin" | "name"; org: OrgBrief } | null> {
  const gst = gstin?.trim().toUpperCase() || null;
  if (gst) {
    const byGst = await iQueryOne<OrgBrief>(
      "SELECT `id`, `name`, `gstin` FROM `organizations` WHERE `status`='active' AND UPPER(`gstin`)=? LIMIT 1",
      [gst],
    );
    if (byGst) return { matchedOn: "gstin", org: byGst };
  }
  const nm = name.trim();
  if (nm) {
    // Block a same-name org only when the pairing is ambiguous: the new org has
    // no GSTIN (gst IS NULL), or the existing same-name org has no GSTIN. Two
    // differently-GSTIN'd orgs may share a name (distinct legal entities).
    const byName = await iQueryOne<OrgBrief>(
      "SELECT `id`, `name`, `gstin` FROM `organizations` " +
        "WHERE `status`='active' AND LOWER(`name`)=LOWER(?) AND (`gstin` IS NULL OR ? IS NULL) LIMIT 1",
      [nm, gst],
    );
    if (byName) return { matchedOn: "name", org: byName };
  }
  return null;
}

export interface MemberView {
  id: string;
  user_id: string;
  user_email: string;
  role: FinanceRole;
  status: string;
  created_at: Date;
}

/** Active members of an organization (for the Team Members UI). */
export async function listMembers(organizationId: string): Promise<MemberView[]> {
  return iQuery<MemberView>(
    "SELECT `id`, `user_id`, `user_email`, `role`, `status`, `created_at` FROM `organization_members` " +
      "WHERE `organization_id`=? AND `status`='active' ORDER BY (`role`='FINANCE_ADMIN') DESC, `created_at` ASC",
    [organizationId],
  );
}

/** Look up an existing Web Insight account by email (never creates one). */
async function findWebInsightUser(
  email: string,
): Promise<{ id: string; email: string; name: string | null; status: string } | null> {
  return mainQueryOne<{ id: string; email: string; name: string | null; status: string }>(
    "SELECT `id`, `email`, `name`, `status` FROM `User` WHERE `email` = ? LIMIT 1",
    [email],
  );
}

/** The active organizations a user already belongs to (isolation guard). */
async function activeOrgsForUser(userId: string, email: string): Promise<string[]> {
  const rows = await iQuery<{ organization_id: string }>(
    "SELECT DISTINCT `organization_id` FROM `organization_members` WHERE (`user_id`=? OR `user_email`=?) AND `status`='active'",
    [userId, email],
  );
  return rows.map((r) => r.organization_id);
}

function isFinanceRole(role: string): role is FinanceRole {
  return (FINANCE_ROLES as readonly string[]).includes(role);
}

/**
 * Add an existing Web Insight user to THIS organization with a finance role.
 * Reuses the employee's existing account; refuses if they belong to another org.
 */
export async function addMemberByEmail(
  organizationId: string,
  actor: { id: string; email: string },
  rawEmail: string,
  role: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isFinanceRole(role)) return { ok: false, message: "Choose a valid finance role." };
  const email = (rawEmail ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 191) return { ok: false, message: "Enter a valid email address." };

  const user = await findWebInsightUser(email);
  if (!user) {
    return {
      ok: false,
      message:
        "No Web Insight account uses that email. Ask an app admin to create it under Admin → Users (or have the employee sign in once), then add them here.",
    };
  }
  if (user.status !== "active") {
    return { ok: false, message: "That Web Insight account is not active." };
  }

  const orgs = await activeOrgsForUser(user.id, email);
  if (orgs.includes(organizationId)) {
    return { ok: false, message: "That employee is already a member of this organization." };
  }
  // MULTI-ORG: a user may be a member of several organizations (each isolated,
  // with its own per-org role). We no longer refuse someone who already belongs
  // to a different org — we only add them to THIS org. Their membership and role
  // in any other org are untouched (no automatic merge/move across orgs).

  // Upsert on the (organization_id, user_id) unique key so re-adding a
  // previously-removed member reactivates their row instead of erroring.
  const id = createId();
  await iExecute(
    "INSERT INTO `organization_members` (`id`,`organization_id`,`user_id`,`user_email`,`role`,`status`) " +
      "VALUES (?,?,?,?,?,'active') " +
      "ON DUPLICATE KEY UPDATE `role`=VALUES(`role`), `user_email`=VALUES(`user_email`), `status`='active'",
    [id, organizationId, user.id, email, role],
  );
  await logInvoiceAudit({
    organizationId,
    actorType: "user",
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "organization.member_added",
    entityType: "organization_member",
    entityId: user.id,
    after: { email, role },
  }).catch(() => undefined);
  return { ok: true, message: `Added ${email} as ${role}.` };
}

/** Count active Finance Admins (so the org can never be left without one). */
async function adminCount(organizationId: string): Promise<number> {
  const row = await iQueryOne<{ c: number }>(
    "SELECT COUNT(*) c FROM `organization_members` WHERE `organization_id`=? AND `role`='FINANCE_ADMIN' AND `status`='active'",
    [organizationId],
  );
  return Number(row?.c ?? 0);
}

/** Change a member's finance role (keeps at least one Finance Admin). */
export async function updateMemberRole(
  organizationId: string,
  actor: { id: string; email: string },
  memberId: string,
  role: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isFinanceRole(role)) return { ok: false, message: "Choose a valid finance role." };
  const target = await iQueryOne<{ id: string; role: FinanceRole }>(
    "SELECT `id`,`role` FROM `organization_members` WHERE `organization_id`=? AND `id`=? AND `status`='active'",
    [organizationId, memberId],
  );
  if (!target) return { ok: false, message: "Member not found." };
  if (target.role === "FINANCE_ADMIN" && role !== "FINANCE_ADMIN" && (await adminCount(organizationId)) <= 1) {
    return { ok: false, message: "This is the only Finance Admin — assign another admin first." };
  }
  await iExecute("UPDATE `organization_members` SET `role`=? WHERE `organization_id`=? AND `id`=?", [
    role,
    organizationId,
    memberId,
  ]);
  await logInvoiceAudit({
    organizationId,
    actorType: "user",
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "organization.member_role_changed",
    entityType: "organization_member",
    entityId: memberId,
    after: { role },
  }).catch(() => undefined);
  return { ok: true, message: "Role updated." };
}

/** Revoke a member's access (soft — keeps the row; never the last admin). */
export async function removeMember(
  organizationId: string,
  actor: { id: string; email: string },
  memberId: string,
): Promise<{ ok: boolean; message: string }> {
  const target = await iQueryOne<{ id: string; role: FinanceRole; user_email: string }>(
    "SELECT `id`,`role`,`user_email` FROM `organization_members` WHERE `organization_id`=? AND `id`=? AND `status`='active'",
    [organizationId, memberId],
  );
  if (!target) return { ok: false, message: "Member not found." };
  if (target.role === "FINANCE_ADMIN" && (await adminCount(organizationId)) <= 1) {
    return { ok: false, message: "Can't remove the only Finance Admin — assign another admin first." };
  }
  await iExecute("UPDATE `organization_members` SET `status`='revoked' WHERE `organization_id`=? AND `id`=?", [
    organizationId,
    memberId,
  ]);
  await logInvoiceAudit({
    organizationId,
    actorType: "user",
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "organization.member_removed",
    entityType: "organization_member",
    entityId: memberId,
    after: { email: target.user_email },
  }).catch(() => undefined);
  return { ok: true, message: `Removed ${target.user_email}.` };
}

export interface OrgProfileInput {
  name: string;
  legalName: string | null;
  gstin: string | null;
  pan: string | null;
  baseCurrency: string;
  address?: string | null;
}

export const BASE_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;

/** Serialize a free-text address to the organizations.address JSON column. */
export function addressToJson(raw: string | null | undefined): string | null {
  const text = normalizeOptionalText(raw);
  return text ? JSON.stringify({ text }) : null;
}

/** Read the free-text address back from the JSON column (object or string). */
export function addressText(value: unknown): string {
  if (!value) return "";
  try {
    const obj = typeof value === "string" ? JSON.parse(value) : value;
    return obj && typeof obj === "object" && typeof (obj as { text?: unknown }).text === "string"
      ? (obj as { text: string }).text
      : "";
  } catch {
    return typeof value === "string" ? value : "";
  }
}

/**
 * Validate an organization profile for create/edit (shared rules). GSTIN and PAN
 * are OPTIONAL (future orgs may be non-Indian entities); when present they must
 * be well-formed. Returns normalized fields or an error message.
 */
export function validateOrgProfile(
  input: OrgProfileInput,
): { ok: true; name: string; legalName: string | null; gstin: string | null; pan: string | null; currency: string; address: string | null }
  | { ok: false; message: string } {
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, message: "Organization name is required." };
  const gstin = normalizeGstin(input.gstin); // empty/whitespace -> NULL (optional)
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) {
    return { ok: false, message: "GSTIN must be 15 alphanumeric characters (or leave it blank)." };
  }
  const pan = normalizeGstin(input.pan); // reuse: trim/upper, empty -> NULL (optional)
  if (pan && !/^[0-9A-Z]{10}$/.test(pan)) {
    return { ok: false, message: "PAN must be 10 alphanumeric characters (or leave it blank)." };
  }
  const currency = (BASE_CURRENCIES as readonly string[]).includes(input.baseCurrency) ? input.baseCurrency : "INR";
  return { ok: true, name, legalName: normalizeOptionalText(input.legalName), gstin, pan, currency, address: addressToJson(input.address) };
}

/** Edit the shared organization (GST/company) profile. One profile per org. */
export async function updateOrganizationProfile(
  organizationId: string,
  actor: { id: string; email: string },
  input: OrgProfileInput,
): Promise<{ ok: boolean; message: string }> {
  const v = validateOrgProfile(input);
  if (!v.ok) return v;

  const res = await iExecute(
    "UPDATE `organizations` SET `name`=?, `legal_name`=?, `gstin`=?, `pan`=?, `base_currency`=?, `address`=? WHERE `id`=?",
    [v.name, v.legalName, v.gstin, v.pan, v.currency, v.address, organizationId],
  );
  if (res.affectedRows === 0) return { ok: false, message: "Organization not found." };
  await logInvoiceAudit({
    organizationId,
    actorType: "user",
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "organization.profile_updated",
    entityType: "organization",
    entityId: organizationId,
    after: { name: v.name, gstin: v.gstin, pan: v.pan, baseCurrency: v.currency },
  }).catch(() => undefined);
  return { ok: true, message: "Organization profile updated." };
}

/** Count the ACTIVE organizations this user is an active member of. */
async function activeOrgCountForUser(userId: string, email: string): Promise<number> {
  const row = await iQueryOne<{ c: number }>(
    "SELECT COUNT(*) c FROM `organization_members` m JOIN `organizations` o ON o.`id`=m.`organization_id` " +
      "WHERE (m.`user_id`=? OR m.`user_email`=?) AND m.`status`='active' AND o.`status`='active'",
    [userId, email.toLowerCase()],
  );
  return Number(row?.c ?? 0);
}

/**
 * Activate or deactivate an organization. Deactivating hides it from all
 * processing and from the active-org context (getInvoiceContext resolves only
 * active orgs); its data is preserved and reactivation restores it. Safeguard:
 * a Finance Admin cannot deactivate their ONLY remaining active organization
 * (which would lock them out of the module). Caller must already hold org.manage
 * for THIS organization (enforced by the server action).
 */
export async function setOrganizationActive(
  organizationId: string,
  actor: { id: string; email: string },
  active: boolean,
): Promise<{ ok: boolean; message: string }> {
  const org = await iQueryOne<{ id: string; status: string; name: string }>(
    "SELECT `id`,`status`,`name` FROM `organizations` WHERE `id`=?",
    [organizationId],
  );
  if (!org) return { ok: false, message: "Organization not found." };

  if (!active) {
    if (org.status !== "active") return { ok: true, message: "Organization is already inactive." };
    if ((await activeOrgCountForUser(actor.id, actor.email)) <= 1) {
      return {
        ok: false,
        message: "This is your only active organization — create or switch to another before deactivating this one.",
      };
    }
    await iExecute("UPDATE `organizations` SET `status`='inactive' WHERE `id`=?", [organizationId]);
    await logInvoiceAudit({
      organizationId, actorType: "user", actorUserId: actor.id, actorLabel: actor.email,
      action: "organization.deactivated", entityType: "organization", entityId: organizationId, after: { status: "inactive" },
    }).catch(() => undefined);
    return { ok: true, message: `Deactivated "${org.name}". Its data is preserved; reactivate it anytime.` };
  }

  if (org.status === "active") return { ok: true, message: "Organization is already active." };
  await iExecute("UPDATE `organizations` SET `status`='active' WHERE `id`=?", [organizationId]);
  await logInvoiceAudit({
    organizationId, actorType: "user", actorUserId: actor.id, actorLabel: actor.email,
    action: "organization.activated", entityType: "organization", entityId: organizationId, after: { status: "active" },
  }).catch(() => undefined);
  return { ok: true, message: `Activated "${org.name}".` };
}
