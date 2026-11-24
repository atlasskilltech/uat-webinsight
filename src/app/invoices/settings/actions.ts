"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { iQueryOne, iTransaction } from "@/lib/invoice/db";
import { logInvoiceAudit } from "@/lib/invoice/audit";
import { createId } from "@/lib/id";
import { getCurrentUser } from "@/lib/auth/session";
import { requireCapability } from "@/lib/invoice/permissions";
import {
  findDuplicateOrganization,
  normalizeGstin,
  normalizeOptionalText,
  addMemberByEmail,
  updateMemberRole,
  removeMember,
  updateOrganizationProfile,
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
  baseCurrency: z.enum(["INR", "USD", "EUR", "GBP"]).default("INR"),
});

/**
 * Create the first finance organization and enroll the creating admin as
 * FINANCE_ADMIN. Only an application admin may bootstrap an organization.
 * Idempotent-ish: refuses if the user already belongs to an organization.
 */
export async function createInvoiceOrganization(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return errorState("You must be signed in.");
  if (user.role !== "admin") return errorState("Only an administrator can create the organization.");

  const parsed = parseForm(createOrgSchema, formData);
  if (!parsed.success) return parsed.state;
  const d = parsed.data;

  try {
    const existing = await iQueryOne<{ id: string }>(
      "SELECT `id` FROM `organization_members` WHERE (`user_id` = ? OR `user_email` = ?) AND `status`='active' LIMIT 1",
      [user.id, user.email.toLowerCase()],
    );
    if (existing) return errorState("You already belong to an organization.");

    // Normalize optional fields so empty/whitespace GSTIN persists as NULL (not
    // "") — otherwise two GST-less orgs would collide on the unique index.
    const gstin = normalizeGstin(d.gstin);
    const legalName = normalizeOptionalText(d.legalName);

    // Support multiple legitimate organizations (e.g. Atlas and ISDI) while
    // preventing ACCIDENTAL duplicates: refuse only when the new org would match
    // an existing one by GSTIN (same legal entity) or by an identical name. A
    // different GSTIN and name is a genuinely separate org and is allowed.
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
        "INSERT INTO `organizations` (`id`,`name`,`legal_name`,`gstin`,`base_currency`) VALUES (?,?,?,?,?)",
        [orgId, d.name, legalName, gstin, d.baseCurrency],
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

    revalidatePath("/invoices");
    revalidatePath("/invoices/settings");
    return successState("Organization created. You are the Finance Admin.", orgId);
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
    const ctx = await requireCapability("org.manage");
    const res = await updateOrganizationProfile(
      ctx.organizationId,
      { id: ctx.user.id, email: ctx.user.email },
      {
        name: String(formData.get("name") ?? ""),
        legalName: String(formData.get("legalName") ?? "") || null,
        gstin: String(formData.get("gstin") ?? "") || null,
        pan: String(formData.get("pan") ?? "") || null,
        baseCurrency: String(formData.get("baseCurrency") ?? "INR"),
      },
    );
    if (!res.ok) return errorState(res.message);
    revalidatePath("/invoices/settings");
    revalidatePath("/invoices");
    return successState(res.message);
  } catch (e) {
    return errorState(e instanceof Error ? e.message : "Could not update the organization.");
  }
}
