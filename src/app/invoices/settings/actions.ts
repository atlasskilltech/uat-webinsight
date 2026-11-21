"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { iQueryOne, iTransaction } from "@/lib/invoice/db";
import { logInvoiceAudit } from "@/lib/invoice/audit";
import { createId } from "@/lib/id";
import { getCurrentUser } from "@/lib/auth/session";
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
    .max(20)
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

    const orgId = createId();
    await iTransaction(async (conn) => {
      await conn.query(
        "INSERT INTO `organizations` (`id`,`name`,`legal_name`,`gstin`,`base_currency`) VALUES (?,?,?,?,?)",
        [orgId, d.name, d.legalName ?? null, d.gstin ?? null, d.baseCurrency],
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
    return errorState(e instanceof Error ? e.message : "Could not create the organization.");
  }
}
