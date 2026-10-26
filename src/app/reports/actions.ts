"use server";

import { revalidatePath } from "next/cache";
import { queryOne, execute, json } from "@/lib/db";
import { createId } from "@/lib/id";
import type { Report } from "@/lib/models";
import { reportSchema } from "@/lib/validation";
import { parseForm, successState, errorState, type FormState } from "@/lib/form-state";
import { buildReportData } from "@/lib/report-data";
import { previousPeriod } from "@/lib/dates";

export async function createReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(reportSchema, formData);
  if (!parsed.success) return parsed.state;
  const d = parsed.data;
  if (d.periodEnd < d.periodStart) return errorState("End date must be after the start date.");

  try {
    const range = { start: d.periodStart, end: d.periodEnd };
    const snapshot = await buildReportData(range);
    const prev = previousPeriod(range);
    const id = createId();
    await execute(
      "INSERT INTO `Report` (`id`,`title`,`type`,`periodStart`,`periodEnd`,`comparePeriodStart`,`comparePeriodEnd`,`executiveSummary`,`status`,`snapshot`) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        d.title,
        d.type,
        d.periodStart,
        d.periodEnd,
        prev.start,
        prev.end,
        d.executiveSummary ?? "",
        d.status,
        json(snapshot),
      ],
    );
    revalidatePath("/reports");
    return successState("Report generated.", id);
  } catch {
    return errorState("Could not generate the report.");
  }
}

export async function updateReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return errorState("Missing report id.");
  const title = String(formData.get("title") ?? "").trim();
  const executiveSummary = String(formData.get("executiveSummary") ?? "");
  const status = String(formData.get("status") ?? "draft");
  try {
    if (title) {
      await execute(
        "UPDATE `Report` SET `title`=?,`executiveSummary`=?,`status`=? WHERE `id`=?",
        [title, executiveSummary, status, id],
      );
    } else {
      await execute(
        "UPDATE `Report` SET `executiveSummary`=?,`status`=? WHERE `id`=?",
        [executiveSummary, status, id],
      );
    }
    revalidatePath(`/reports/${id}`);
    revalidatePath("/reports");
    return successState("Report saved.");
  } catch {
    return errorState("Could not save the report.");
  }
}

/** Rebuild the frozen snapshot from the stored period (refresh figures). */
export async function regenerateReport(id: string): Promise<FormState> {
  const report = await queryOne<Report>("SELECT * FROM `Report` WHERE `id`=?", [id]);
  if (!report) return errorState("Report not found.");
  try {
    const snapshot = await buildReportData({ start: report.periodStart, end: report.periodEnd });
    await execute("UPDATE `Report` SET `snapshot`=? WHERE `id`=?", [json(snapshot), id]);
    revalidatePath(`/reports/${id}`);
    return successState("Figures refreshed from current data.");
  } catch {
    return errorState("Could not refresh the report.");
  }
}

export async function deleteReport(id: string): Promise<void> {
  await execute("DELETE FROM `Report` WHERE `id`=?", [id]);
  revalidatePath("/reports");
}
