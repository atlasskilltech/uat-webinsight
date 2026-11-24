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
  if (orgs.length > 0) {
    // Isolation: never move/merge automatically.
    return {
      ok: false,
      message:
        "That employee already belongs to a different organization. Organizations are kept isolated — moving them requires an explicit migration, not an automatic merge.",
    };
  }

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
}

/** Edit the shared organization (GST/company) profile. One profile per org. */
export async function updateOrganizationProfile(
  organizationId: string,
  actor: { id: string; email: string },
  input: OrgProfileInput,
): Promise<{ ok: boolean; message: string }> {
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, message: "Organization name is required." };
  const gstin = normalizeGstin(input.gstin); // empty/whitespace -> NULL
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) {
    return { ok: false, message: "GSTIN must be 15 alphanumeric characters." };
  }
  const pan = normalizeGstin(input.pan); // reuse: trim/upper, empty -> NULL
  if (pan && !/^[0-9A-Z]{10}$/.test(pan)) {
    return { ok: false, message: "PAN must be 10 alphanumeric characters." };
  }
  const currency = ["INR", "USD", "EUR", "GBP"].includes(input.baseCurrency) ? input.baseCurrency : "INR";

  const res = await iExecute(
    "UPDATE `organizations` SET `name`=?, `legal_name`=?, `gstin`=?, `pan`=?, `base_currency`=? WHERE `id`=?",
    [name, normalizeOptionalText(input.legalName), gstin, pan, currency, organizationId],
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
    after: { name, gstin, pan, baseCurrency: currency },
  }).catch(() => undefined);
  return { ok: true, message: "Organization profile updated." };
}
