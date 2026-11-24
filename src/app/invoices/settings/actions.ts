"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { iQueryOne, iTransaction } from "@/lib/invoice/db";
import { logInvoiceAudit } from "@/lib/invoice/audit";
import { createId } from "@/lib/id";
import { getCurrentUser } from "@/lib/auth/session";
import { isAuthError } from "@/lib/auth/guard";
import { requireCapability, requireCapabilityForOrg } from "@/lib/invoice/permissions";
import { getInvoiceContext, isMemberOf, setActiveOrgCookie, clearActiveOrgCookie, listUserOrganizations } from "@/lib/invoice/org";
import {
  findDuplicateOrganization,
  normalizeGstin,
  normalizeOptionalText,
  addressToJson,
  isFinanceAdminAnywhere,
  addMemberByEmail,
  updateMemberRole,
  removeMember,
  updateOrganizationProfile,
  setOrganizationActive,
  BASE_CURRENCIES,
} from "@/lib/invoice/services/org-admin";
import {
  parseForm,
  successState,
  errorState,
  type FormState,
} from "@/lib/form-state";

const createOrgSchema = z.object({
  name: z.string().trim().min(2, "Organization name is required.").max(191),
  legalName: z.string().trim().max(191).optional(),
  gstin: z
    .string()
    .trim()
    .transform((v) => (v ? v.toUpperCase() : v)) // canonical: compared & stored uppercase
    .optional()
    .refine((v) => !v || /^[0-9A-Z]{15}$/.test(v), "GSTIN must be 15 alphanumeric characters."),
  pan: z
    .string()
    .trim()
    .transform((v) => (v ? v.toUpperCase() : v))
    .optional()
    .refine((v) => !v || /^[0-9A-Z]{10}$/.test(v), "PAN must be 10 alphanumeric characters."),
  address: z.string().trim().max(1000).optional(),
  baseCurrency: z.enum(BASE_CURRENCIES).default("INR"),
});

/**
 * Create a finance/business organization and enroll the creator as its
 * FINANCE_ADMIN. MULTI-ORG: a Finance Admin may create additional organizations
 * (each isolated, with its own GST/company profile and configuration); the very
 * first organization still requires an app admin to bootstrap. The creator is
 * NOT required to be org-less — creating a second org does not move or merge the
 * first. Accidental duplicates (same GSTIN, or same name when GSTIN can't
 * disambiguate) are refused. The new org becomes the creator's active org.
 */
export async function createInvoiceOrganization(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return errorState("You must be signed in.");
  // App admin bootstraps the first org; an existing Finance Admin may create more.
  const canCreate = user.role === "admin" || (await isFinanceAdminAnywhere(user.id, user.email).catch(() => false));
  if (!canCreate) {
    return errorState("Only an app administrator or an existing Finance Admin can create an organization.");
  }

  const parsed = parseForm(createOrgSchema, formData);
  if (!parsed.success) return parsed.state;
  const d = parsed.data;

  try {
    // Normalize optional fields so empty/whitespace GSTIN persists as NULL (not
    // "") — otherwise two GST-less orgs would collide on the unique index.
    const gstin = normalizeGstin(d.gstin);
    const pan = normalizeGstin(d.pan);
    const legalName = normalizeOptionalText(d.legalName);
    const address = addressToJson(d.address);

    // Support multiple legitimate organizations while preventing ACCIDENTAL
    // duplicates: refuse only when the new org would match an existing one by
    // GSTIN (same legal entity) or by an identical name that can't be
    // disambiguated. A distinct GSTIN and name is a genuinely separate org.
    const dup = await findDuplicateOrganization(gstin, d.name);
    if (dup) {
      const how = dup.matchedOn === "gstin" ? `GSTIN ${dup.org.gstin}` : `the name "${dup.org.name}"`;
      return errorState(
        `An organization with ${how} already exists (“${dup.org.name}”). If that's your organization, ask its ` +
          `Finance Admin to add you under Settings → Team Members. To create a genuinely separate organization, ` +
          `use a different name and GSTIN.`,
      );
    }

    const orgId = createId();
    await iTransaction(async (conn) => {
      await conn.query(
        "INSERT INTO `organizations` (`id`,`name`,`legal_name`,`gstin`,`pan`,`base_currency`,`address`) VALUES (?,?,?,?,?,?,?)",
        [orgId, d.name, legalName, gstin, pan, d.baseCurrency, address],
      );
      await conn.query(
        "INSERT INTO `organization_members` (`id`,`organization_id`,`user_id`,`user_email`,`role`,`status`) " +
          "VALUES (?,?,?,?,?,'active')",
        [createId(), orgId, user.id, user.email.toLowerCase(), "FINANCE_ADMIN"],
      );
      await conn.query(
        "INSERT INTO `agent_settings` (`id`,`organization_id`) VALUES (?,?)",
        [createId(), orgId],
      );
      await conn.query(
        "INSERT INTO `notification_preferences` (`id`,`organization_id`,`user_id`) VALUES (?,?,?)",
        [createId(), orgId, user.id],
      );
      await logInvoiceAudit(
        {
          organizationId: orgId,
          actorType: "user",
          actorUserId: user.id,
          actorLabel: user.email,
          action: "organization.created",
          entityType: "organization",
          entityId: orgId,
          after: { name: d.name, baseCurrency: d.baseCurrency },
        },
        conn,
      );
    });

    // Switch the creator into their new org.
    await setActiveOrgCookie(orgId).catch(() => undefined);
    revalidatePath("/invoices");
    revalidatePath("/invoices/settings");
    return successState("Organization created. You are its Finance Admin and it's now your active organization.", orgId);
  } catch (e) {
    // Race safety: if two admins create the same GSTIN at once, the DB unique
    // index (migration 009) rejects the loser — report it cleanly rather than
    // leaking a raw SQL error or allowing a duplicate.
    const err = e as { code?: string } | null;
    if (err?.code === "ER_DUP_ENTRY") {
      return errorState(
        "An organization with this GSTIN already exists. Ask its Finance Admin to add you under Settings → Team Members.",
      );
    }
    return errorState(e instanceof Error ? e.message : "Could not create the organization.");
  }
}

/**
 * Switch the caller's ACTIVE organization. Server-validated: the cookie is set
 * only when the user is an active member of the target org, so it can never be
 * used to reach another organization's data.
 */
export async function switchOrganizationAction(input: { organizationId: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, message: "You must be signed in." };
    const orgId = String(input.organizationId ?? "");
    if (!orgId || !(await isMemberOf(user, orgId))) {
      return { ok: false, message: "You are not a member of that organization." };
    }
    await setActiveOrgCookie(orgId);
    revalidatePath("/invoices");
    revalidatePath("/invoices/settings");
    revalidatePath("/invoices/email-accounts");
    return { ok: true, message: "Active organization switched." };
  } catch (e) {
    return { ok: false, message: isAuthError(e) ? e.message : e instanceof Error ? e.message : "Could not switch." };
  }
}

/**
 * Activate or deactivate an organization. Finance Admin of THAT org only
 * (requireCapability validates membership + role for the passed org id — the
 * frontend org id is never trusted on its own).
 */
export async function setOrgActiveAction(input: { organizationId: string; active: boolean }): Promise<{ ok: boolean; message: string }> {
  try {
    const orgId = String(input.organizationId ?? "");
    // STRICT: must be a Finance Admin member of THIS org (works for an inactive
    // org too, so it can be reactivated); never falls back to another org.
    const ctx = await requireCapabilityForOrg("org.manage", orgId);
    const res = await setOrganizationActive(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, Boolean(input.active));
    if (res.ok && !input.active) {
      // If we just deactivated the active org, drop the cookie so context falls
      // back to another active membership.
      const current = await getInvoiceContext();
      if (!current?.organizationId || current.organizationId === orgId) await clearActiveOrgCookie();
    }
    if (res.ok) {
      revalidatePath("/invoices");
      revalidatePath("/invoices/settings");
    }
    return res;
  } catch (e) {
    return { ok: false, message: isAuthError(e) ? e.message : e instanceof Error ? e.message : "Could not update the organization." };
  }
}

// --- Team members (Finance Admin: org.manage) -------------------------------

/** Add an existing Web Insight user to the organization with a finance role. */
export async function addMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("org.manage");
    const email = String(formData.get("email") ?? "");
    const role = String(formData.get("role") ?? "");
    const res = await addMemberByEmail(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, email, role);
    if (!res.ok) return errorState(res.message);
    revalidatePath("/invoices/settings");
    return successState(res.message);
  } catch (e) {
    return errorState(e instanceof Error ? e.message : "Could not add the member.");
  }
}

/** Change an existing member's finance role. */
export async function updateMemberRoleAction(input: { memberId: string; role: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await requireCapability("org.manage");
    const res = await updateMemberRole(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, input.memberId, input.role);
    if (res.ok) revalidatePath("/invoices/settings");
    return res;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not update the role." };
  }
}

/** Revoke a member's access to the organization. */
export async function removeMemberAction(input: { memberId: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await requireCapability("org.manage");
    const res = await removeMember(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, input.memberId);
    if (res.ok) revalidatePath("/invoices/settings");
    return res;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not remove the member." };
  }
}

// --- Edit organization (GST/company) profile (Finance Admin: org.manage) -----

export async function updateOrganizationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    // Edit a SPECIFIC org (from the management list) or the active org. When an
    // org id is supplied it is validated STRICTLY against the caller's Finance
    // Admin membership of THAT org — a frontend id for an org the user doesn't
    // administer is rejected (403), never silently applied to a different org.
    const requestedOrgId = String(formData.get("organizationId") ?? "") || "";
    const ctx = requestedOrgId
      ? await requireCapabilityForOrg("org.manage", requestedOrgId)
      : await requireCapability("org.manage");
    const res = await updateOrganizationProfile(
      ctx.organizationId,
      { id: ctx.user.id, email: ctx.user.email },
      {
        name: String(formData.get("name") ?? ""),
        legalName: String(formData.get("legalName") ?? "") || null,
        gstin: String(formData.get("gstin") ?? "") || null,
        pan: String(formData.get("pan") ?? "") || null,
        address: String(formData.get("address") ?? "") || null,
        baseCurrency: String(formData.get("baseCurrency") ?? "INR"),
      },
    );
    if (!res.ok) return errorState(res.message);
    revalidatePath("/invoices/settings");
    revalidatePath("/invoices");
    return successState(res.message);
  } catch (e) {
    return errorState(isAuthError(e) ? e.message : e instanceof Error ? e.message : "Could not update the organization.");
  }
}
