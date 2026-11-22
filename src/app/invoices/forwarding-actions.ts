"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseForm, errorState, successState, type FormState } from "@/lib/form-state";
import { isAuthError } from "@/lib/auth/guard";
import { requireCapability } from "@/lib/invoice/permissions";
import { saveForwardingSettings, approveAndForward, rejectForward } from "@/lib/invoice/services/forwarding";
import { setAccountAutoForward } from "@/lib/invoice/services/gmail";

function fail(e: unknown): FormState {
  return errorState(isAuthError(e) ? e.message : e instanceof Error ? e.message : "Something went wrong.");
}

const settingsSchema = z.object({
  financeDestination: z
    .string()
    .trim()
    .email("Enter a valid email.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  minConfidence: z.coerce.number().min(0).max(100),
  enabled: z.enum(["true", "false"]).default("true"),
});

export async function saveForwardingSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("settings.manage");
    const parsed = parseForm(settingsSchema, formData);
    if (!parsed.success) return parsed.state;
    await saveForwardingSettings(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, {
      financeDestination: parsed.data.financeDestination ?? null,
      minConfidence: parsed.data.minConfidence,
      enabled: parsed.data.enabled === "true",
    });
    revalidatePath("/invoices/settings");
    revalidatePath("/invoices");
    return successState("Forwarding settings saved.");
  } catch (e) {
    return fail(e);
  }
}

export async function setAutoForwardAction(input: { integrationId: string; enabled: boolean }): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await requireCapability("gmail.manage");
    await setAccountAutoForward(ctx.organizationId, input.integrationId, input.enabled);
    revalidatePath("/invoices/email-accounts");
    return { ok: true, message: input.enabled ? "Auto-forward enabled." : "Auto-forward disabled." };
  } catch (e) {
    return { ok: false, message: isAuthError(e) ? e.message : e instanceof Error ? e.message : "Failed." };
  }
}

export async function approveForwardAction(input: { forwardId: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await requireCapability("email.send");
    const res = await approveAndForward(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, input.forwardId);
    revalidatePath("/invoices");
    return res;
  } catch (e) {
    return { ok: false, message: isAuthError(e) ? e.message : e instanceof Error ? e.message : "Failed." };
  }
}

export async function rejectForwardAction(input: { forwardId: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await requireCapability("gmail.manage");
    await rejectForward(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, input.forwardId);
    revalidatePath("/invoices");
    return { ok: true, message: "Dismissed." };
  } catch (e) {
    return { ok: false, message: isAuthError(e) ? e.message : e instanceof Error ? e.message : "Failed." };
  }
}
