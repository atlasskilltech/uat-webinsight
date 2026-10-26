"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { settingsSchema } from "@/lib/validation";
import {
  parseForm,
  successState,
  errorState,
  type FormState,
} from "@/lib/form-state";
import { importSeoCsv, importAnalyticsCsv } from "@/lib/csv-import";
import { disconnect, type Provider } from "@/lib/integrations";
import { runGoogleSync } from "@/lib/sync";
import { requireAdmin, isAuthError } from "@/lib/auth/guard";

/** Returns an error FormState if the caller is not an admin, else null. */
async function assertAdmin(): Promise<FormState | null> {
  try {
    await requireAdmin();
    return null;
  } catch (e) {
    return errorState(isAuthError(e) ? e.message : "Admin access is required.");
  }
}

export async function saveSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const denied = await assertAdmin();
  if (denied) return denied;
  const parsed = parseForm(settingsSchema, formData);
  if (!parsed.success) return parsed.state;
  const d = parsed.data;
  try {
    await prisma.appSettings.upsert({
      where: { id: "app" },
      update: d,
      create: { id: "app", ...d },
    });
    // Keep integration property ids in sync with settings.
    if (d.gscProperty) {
      await prisma.integration.upsert({
        where: { provider: "gsc" },
        update: { propertyId: d.gscProperty },
        create: { provider: "gsc", propertyId: d.gscProperty, status: "not_connected" },
      });
    }
    if (d.ga4Property) {
      await prisma.integration.upsert({
        where: { provider: "ga4" },
        update: { propertyId: d.ga4Property },
        create: { provider: "ga4", propertyId: d.ga4Property, status: "not_connected" },
      });
    }
    revalidatePath("/settings");
    revalidatePath("/");
    return successState("Settings saved.");
  } catch {
    return errorState("Could not save settings.");
  }
}

export async function importCsvAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const denied = await assertAdmin();
  if (denied) return denied;
  const file = formData.get("file");
  const source = String(formData.get("source") ?? "");
  const propertyId = String(formData.get("propertyId") ?? "manual-import");
  const startRaw = String(formData.get("periodStart") ?? "");
  const endRaw = String(formData.get("periodEnd") ?? "");

  if (!(file instanceof File) || file.size === 0) {
    return errorState("Please choose a CSV file to import.");
  }
  if (source !== "gsc" && source !== "ga4") {
    return errorState("Choose whether this is a Search Console or Analytics export.");
  }
  if (file.size > 10 * 1024 * 1024) {
    return errorState("File is too large (max 10MB).");
  }

  const periodStart = startRaw ? new Date(startRaw) : undefined;
  const periodEnd = endRaw ? new Date(endRaw) : undefined;

  try {
    const text = await file.text();
    const opts = { propertyId, fileName: file.name, periodStart, periodEnd };
    const result =
      source === "gsc"
        ? await importSeoCsv(text, opts)
        : await importAnalyticsCsv(text, opts);
    revalidatePath("/settings");
    revalidatePath("/seo");
    revalidatePath("/");
    if (!result.ok) return errorState(result.message);
    return successState(result.message);
  } catch {
    return errorState("Could not read the file. Make sure it is a valid CSV.");
  }
}

export async function disconnectProvider(provider: Provider): Promise<void> {
  await requireAdmin();
  await disconnect(provider);
  revalidatePath("/settings");
}

/** Remove all seeded demo data so only real imported/entered data remains. */
export async function clearDemoData(): Promise<void> {
  await requireAdmin();
  await prisma.$transaction([
    prisma.seoSnapshot.deleteMany({ where: { isDemo: true } }),
    prisma.analyticsSnapshot.deleteMany({ where: { isDemo: true } }),
    prisma.importBatch.deleteMany({ where: { isDemo: true } }),
    prisma.workLog.deleteMany({ where: { isDemo: true } }),
    prisma.task.deleteMany({ where: { isDemo: true } }),
    prisma.technicalIssue.deleteMany({ where: { isDemo: true } }),
    prisma.operationsLog.deleteMany({ where: { isDemo: true } }),
    prisma.serverAsset.deleteMany({ where: { isDemo: true } }),
    prisma.competitorResearch.deleteMany({ where: { isDemo: true } }),
    prisma.report.deleteMany({ where: { isDemo: true } }),
  ]);
  revalidatePath("/");
  revalidatePath("/settings");
}

/**
 * Manual "Sync 28d" button. Reuses the shared sync engine (same code path as
 * the scheduled sync) and surfaces the result as form feedback.
 */
export async function syncProvider(provider: Provider): Promise<FormState> {
  const denied = await assertAdmin();
  if (denied) return denied;
  if (provider === "psi") return errorState("PageSpeed is used per-URL in the Page Inspector, not synced here.");
  const result = await runGoogleSync(provider, { trigger: "manual", windowDays: 28 });
  revalidatePath("/settings");
  revalidatePath("/seo");
  revalidatePath("/");
  return result.ok ? successState(result.message) : errorState(result.message);
}
