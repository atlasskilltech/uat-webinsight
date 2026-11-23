"use server";

import { revalidatePath } from "next/cache";
import { errorState, successState, type FormState } from "@/lib/form-state";
import { isAuthError } from "@/lib/auth/guard";
import { requireCapability } from "@/lib/invoice/permissions";
import { syncGmailAccount, rescanGmailAccount, disconnectGmail } from "@/lib/invoice/services/gmail";

function fail(e: unknown): FormState {
  return errorState(isAuthError(e) ? e.message : e instanceof Error ? e.message : "Something went wrong.");
}

export async function rescanGmailAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("gmail.manage");
    const integrationId = String(formData.get("integrationId") ?? "").trim();
    if (!integrationId) return errorState("Missing account.");
    const summary = await rescanGmailAccount(ctx.organizationId, integrationId, {
      id: ctx.user.id,
      email: ctx.user.email,
    });
    revalidatePath("/invoices/email-accounts");
    revalidatePath("/invoices");
    return successState(`Re-scanned recent mail. ${summary.message}`);
  } catch (e) {
    return fail(e);
  }
}

export async function syncGmailAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("gmail.manage");
    const integrationId = String(formData.get("integrationId") ?? "").trim();
    if (!integrationId) return errorState("Missing account.");
    const summary = await syncGmailAccount(ctx.organizationId, integrationId, {
      id: ctx.user.id,
      email: ctx.user.email,
    });
    revalidatePath("/invoices/email-accounts");
    revalidatePath("/invoices/processing");
    revalidatePath("/invoices/needs-review");
    return successState(summary.message);
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectGmailAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("gmail.manage");
    const integrationId = String(formData.get("integrationId") ?? "").trim();
    if (!integrationId) return errorState("Missing account.");
    await disconnectGmail(ctx.organizationId, integrationId, { id: ctx.user.id, email: ctx.user.email });
    revalidatePath("/invoices/email-accounts");
    return successState("Account disconnected.");
  } catch (e) {
    return fail(e);
  }
}
