"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
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
    const report = await prisma.report.create({
      data: {
        title: d.title,
        type: d.type,
        periodStart: d.periodStart,
        periodEnd: d.periodEnd,
        comparePeriodStart: prev.start,
        comparePeriodEnd: prev.end,
        executiveSummary: d.executiveSummary ?? "",
        status: d.status,
        snapshot: snapshot as object,
      },
    });
    revalidatePath("/reports");
    return successState("Report generated.", report.id);
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
    await prisma.report.update({
      where: { id },
      data: { title: title || undefined, executiveSummary, status },
    });
    revalidatePath(`/reports/${id}`);
    revalidatePath("/reports");
    return successState("Report saved.");
  } catch {
    return errorState("Could not save the report.");
  }
}

/** Rebuild the frozen snapshot from the stored period (refresh figures). */
export async function regenerateReport(id: string): Promise<FormState> {
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) return errorState("Report not found.");
  try {
    const snapshot = await buildReportData({ start: report.periodStart, end: report.periodEnd });
    await prisma.report.update({ where: { id }, data: { snapshot: snapshot as object } });
    revalidatePath(`/reports/${id}`);
    return successState("Figures refreshed from current data.");
  } catch {
    return errorState("Could not refresh the report.");
  }
}

export async function deleteReport(id: string): Promise<void> {
  await prisma.report.delete({ where: { id } });
  revalidatePath("/reports");
}
