"use server";

import { revalidatePath } from "next/cache";
import { isAuthError } from "@/lib/auth/guard";
import { requireCapability } from "@/lib/invoice/permissions";
import {
  addCategory,
  updateCategory,
  deleteCategory,
  addDestination,
  updateDestination,
  deleteDestination,
  addRule,
  updateRule,
  deleteRule,
  testForwardingRules,
  type RuleInput,
  type DryRunResult,
} from "@/lib/invoice/services/routing";

type Result = { ok: boolean; message: string };

function fail(e: unknown): Result {
  return { ok: false, message: isAuthError(e) ? e.message : e instanceof Error ? e.message : "Something went wrong." };
}

function revalidate() {
  revalidatePath("/invoices/settings");
  revalidatePath("/invoices");
}

// --- Document categories ----------------------------------------------------

export async function addCategoryAction(input: { label: string; key?: string }): Promise<Result> {
  try {
    const ctx = await requireCapability("settings.manage");
    const res = await addCategory(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, input);
    if (res.ok) revalidate();
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function updateCategoryAction(input: { id: string; label?: string; isActive?: boolean }): Promise<Result> {
  try {
    const ctx = await requireCapability("settings.manage");
    const res = await updateCategory(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, input.id, {
      label: input.label,
      isActive: input.isActive,
    });
    if (res.ok) revalidate();
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCategoryAction(input: { id: string }): Promise<Result> {
  try {
    const ctx = await requireCapability("settings.manage");
    const res = await deleteCategory(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, input.id);
    if (res.ok) revalidate();
    return res;
  } catch (e) {
    return fail(e);
  }
}

// --- Forwarding destinations ------------------------------------------------

export async function addDestinationAction(input: { name: string; email: string; cc?: string[] }): Promise<Result> {
  try {
    const ctx = await requireCapability("settings.manage");
    const res = await addDestination(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, input);
    if (res.ok) revalidate();
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function updateDestinationAction(input: {
  id: string;
  name?: string;
  email?: string;
  cc?: string[];
  isActive?: boolean;
}): Promise<Result> {
  try {
    const ctx = await requireCapability("settings.manage");
    const { id, ...rest } = input;
    const res = await updateDestination(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, id, rest);
    if (res.ok) revalidate();
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDestinationAction(input: { id: string }): Promise<Result> {
  try {
    const ctx = await requireCapability("settings.manage");
    const res = await deleteDestination(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, input.id);
    if (res.ok) revalidate();
    return res;
  } catch (e) {
    return fail(e);
  }
}

// --- Forwarding rules -------------------------------------------------------

export async function addRuleAction(input: RuleInput): Promise<Result> {
  try {
    const ctx = await requireCapability("settings.manage");
    const res = await addRule(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, input);
    if (res.ok) revalidate();
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function updateRuleAction(input: { id: string } & RuleInput): Promise<Result> {
  try {
    const ctx = await requireCapability("settings.manage");
    const { id, ...rest } = input;
    const res = await updateRule(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, id, rest);
    if (res.ok) revalidate();
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function deleteRuleAction(input: { id: string }): Promise<Result> {
  try {
    const ctx = await requireCapability("settings.manage");
    const res = await deleteRule(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, input.id);
    if (res.ok) revalidate();
    return res;
  } catch (e) {
    return fail(e);
  }
}

// --- Dry-run / test (no writes) ---------------------------------------------

export async function testRulesAction(input: {
  integrationId: string;
  sender: string;
  categoryKey: string;
  confidencePct: number;
  mailboxAutoForward?: boolean;
}): Promise<{ ok: boolean; message: string; result?: DryRunResult }> {
  try {
    const ctx = await requireCapability("settings.manage");
    const result = await testForwardingRules(ctx.organizationId, input);
    return { ok: true, message: "Evaluated.", result };
  } catch (e) {
    return fail(e);
  }
}
