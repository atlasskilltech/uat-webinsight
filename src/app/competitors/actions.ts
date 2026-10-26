"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
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
    const entry = await prisma.competitorResearch.create({ data: parsed.data });
    revalidateResearch();
    return successState("Research entry added.", entry.id);
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
    await prisma.competitorResearch.update({
      where: { id },
      data: parsed.data,
    });
    revalidateResearch();
    return successState("Research entry updated.", id);
  } catch {
    return errorState("Could not update the research entry.");
  }
}

export async function deleteResearch(id: string): Promise<void> {
  await prisma.competitorResearch.delete({ where: { id } });
  revalidateResearch();
}

/** Quick status change from the card. */
export async function setResearchStatus(id: string, status: string): Promise<void> {
  await prisma.competitorResearch.update({ where: { id }, data: { status } });
  revalidateResearch();
}
