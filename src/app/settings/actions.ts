"use server";

import { revalidatePath } from "next/cache";
import { execute, transaction } from "@/lib/db";
import { createId } from "@/lib/id";
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
    // Upsert the AppSettings singleton (id = 'app'). Only the fields that were
    // actually supplied are written, mirroring Prisma's skip-undefined behavior:
    // a blank optional form field (undefined) leaves the existing value intact.
    const entries = Object.entries(d).filter(([, v]) => v !== undefined);
    const cols = entries.map(([k]) => k);
    const vals = entries.map(([, v]) => v);
    const insertCols = ["id", ...cols].map((c) => `\`${c}\``).join(", ");
    const placeholders = ["id", ...cols].map(() => "?").join(", ");
    const updateClause = cols.map((k) => `\`${k}\` = VALUES(\`${k}\`)`).join(", ");
    await execute(
      `INSERT INTO \`AppSettings\` (${insertCols}) VALUES (${placeholders}) ` +
        `ON DUPLICATE KEY UPDATE ${updateClause}`,
      ["app", ...vals],
    );
    // Keep integration property ids in sync with settings.
    if (d.gscProperty) {
      await execute(
        "INSERT INTO `Integration` (`id`,`provider`,`propertyId`,`status`) VALUES (?,?,?,'not_connected') " +
          "ON DUPLICATE KEY UPDATE `propertyId` = VALUES(`propertyId`)",
        [createId(), "gsc", d.gscProperty],
      );
    }
    if (d.ga4Property) {
      await execute(
        "INSERT INTO `Integration` (`id`,`provider`,`propertyId`,`status`) VALUES (?,?,?,'not_connected') " +
          "ON DUPLICATE KEY UPDATE `propertyId` = VALUES(`propertyId`)",
        [createId(), "ga4", d.ga4Property],
      );
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
  await transaction(async (conn) => {
    const tables = [
      "SeoSnapshot",
      "AnalyticsSnapshot",
      "ImportBatch",
      "WorkLog",
      "Task",
      "TechnicalIssue",
      "OperationsLog",
      "ServerAsset",
      "CompetitorResearch",
      "Report",
    ];
    for (const table of tables) {
      await conn.query(`DELETE FROM \`${table}\` WHERE \`isDemo\` = ?`, [true]);
    }
  });
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

/**
 * One-time full backfill: pull ~16 months of history (the GSC maximum; GA4
 * returns up to its retention). Heavier than the daily sync, so it is a
 * separate, explicit action rather than the default.
 */
export async function backfillProvider(provider: Provider): Promise<FormState> {
  const denied = await assertAdmin();
  if (denied) return denied;
  if (provider === "psi") return errorState("PageSpeed is used per-URL in the Page Inspector, not synced here.");
  const result = await runGoogleSync(provider, { trigger: "manual", windowDays: 16 * 30 });
  revalidatePath("/settings");
  revalidatePath("/seo");
  revalidatePath("/");
  return result.ok ? successState(result.message) : errorState(result.message);
}
