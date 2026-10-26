"use server";

import { revalidatePath } from "next/cache";
import { execute } from "@/lib/db";
import { createId } from "@/lib/id";
import { researchSchema } from "@/lib/validation";
import {
  parseForm,
  successState,
  errorState,
  type FormState,
} from "@/lib/form-state";

function revalidateResearch() {
  revalidatePath("/competitors");
  revalidatePath("/");
}

export async function createResearch(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(researchSchema, formData);
  if (!parsed.success) return parsed.state;
  try {
    const d = parsed.data;
    const id = createId();
    await execute(
      "INSERT INTO `CompetitorResearch` (`id`,`organisation`,`website`,`researchDate`,`sourceUrl`,`observation`,`category`,`evidence`,`isAssumption`,`relevance`,`effort`,`expectedBenefit`,`measurement`,`recommendation`,`status`,`followUpDate`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        d.organisation,
        d.website ?? null,
        d.researchDate,
        d.sourceUrl ?? null,
        d.observation,
        d.category,
        d.evidence ?? null,
        d.isAssumption,
        d.relevance ?? null,
        d.effort,
        d.expectedBenefit ?? null,
        d.measurement ?? null,
        d.recommendation,
        d.status,
        d.followUpDate ?? null,
      ],
    );
    revalidateResearch();
    return successState("Research entry added.", id);
  } catch {
    return errorState("Could not save the research entry. Please try again.");
  }
}

export async function updateResearch(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return errorState("Missing research id.");
  const parsed = parseForm(researchSchema, formData);
  if (!parsed.success) return parsed.state;
  try {
    const d = parsed.data;
    await execute(
      "UPDATE `CompetitorResearch` SET `organisation`=?,`website`=?,`researchDate`=?,`sourceUrl`=?,`observation`=?,`category`=?,`evidence`=?,`isAssumption`=?,`relevance`=?,`effort`=?,`expectedBenefit`=?,`measurement`=?,`recommendation`=?,`status`=?,`followUpDate`=? WHERE `id`=?",
      [
        d.organisation,
        d.website ?? null,
        d.researchDate,
        d.sourceUrl ?? null,
        d.observation,
        d.category,
        d.evidence ?? null,
        d.isAssumption,
        d.relevance ?? null,
        d.effort,
        d.expectedBenefit ?? null,
        d.measurement ?? null,
        d.recommendation,
        d.status,
        d.followUpDate ?? null,
        id,
      ],
    );
    revalidateResearch();
    return successState("Research entry updated.", id);
  } catch {
    return errorState("Could not update the research entry.");
  }
}

export async function deleteResearch(id: string): Promise<void> {
  await execute("DELETE FROM `CompetitorResearch` WHERE `id`=?", [id]);
  revalidateResearch();
}

/** Quick status change from the card. */
export async function setResearchStatus(id: string, status: string): Promise<void> {
  await execute("UPDATE `CompetitorResearch` SET `status`=? WHERE `id`=?", [status, id]);
  revalidateResearch();
}
