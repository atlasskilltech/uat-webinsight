"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseForm, errorState, successState, type FormState } from "@/lib/form-state";
import { isAuthError } from "@/lib/auth/guard";
import { requireCapability } from "@/lib/invoice/permissions";
import {
  saveForwardingSettings,
  approveAndForward,
  rejectForward,
  addCcRecipient,
  removeCcRecipient,
  updateCcRecipient,
} from "@/lib/invoice/services/forwarding";
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

export async function addCcRecipientAction(input: { email: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await requireCapability("settings.manage");
    const res = await addCcRecipient(ctx.organizationId, input.email);
    if (res.ok) revalidatePath("/invoices/settings");
    return res;
  } catch (e) {
    return { ok: false, message: isAuthError(e) ? e.message : e instanceof Error ? e.message : "Failed." };
  }
}

export async function updateCcRecipientAction(input: { id: string; email: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await requireCapability("settings.manage");
    const res = await updateCcRecipient(ctx.organizationId, input.id, input.email);
    if (res.ok) revalidatePath("/invoices/settings");
    return res;
  } catch (e) {
    return { ok: false, message: isAuthError(e) ? e.message : e instanceof Error ? e.message : "Failed." };
  }
}

export async function removeCcRecipientAction(input: { id: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await requireCapability("settings.manage");
    const res = await removeCcRecipient(ctx.organizationId, input.id);
    if (res.ok) revalidatePath("/invoices/settings");
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
