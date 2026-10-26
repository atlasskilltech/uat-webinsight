"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { issueSchema, splitUrls } from "@/lib/validation";
import {
  parseForm,
  successState,
  errorState,
  type FormState,
} from "@/lib/form-state";

function revalidateIssues() {
  revalidatePath("/issues");
  revalidatePath("/");
}

const RESOLVED_STATUSES = new Set(["verified", "fixed"]);

export async function createIssue(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(issueSchema, formData);
  if (!parsed.success) return parsed.state;
  const { urls, ...data } = parsed.data;

  try {
    const issue = await prisma.technicalIssue.create({
      data: {
        ...data,
        urls: splitUrls(urls),
        dateResolved:
          RESOLVED_STATUSES.has(data.status) && !data.dateResolved
            ? new Date()
            : data.dateResolved,
      },
    });
    revalidateIssues();
    return successState("Issue recorded.", issue.id);
  } catch {
    return errorState("Could not record the issue. Please try again.");
  }
}

export async function updateIssue(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return errorState("Missing issue id.");
  const parsed = parseForm(issueSchema, formData);
  if (!parsed.success) return parsed.state;
  const { urls, ...data } = parsed.data;

  try {
    const before = await prisma.technicalIssue.findUnique({ where: { id } });
    if (!before) return errorState("Issue not found.");

    const becomingResolved =
      RESOLVED_STATUSES.has(data.status) && !RESOLVED_STATUSES.has(before.status);
    const dateResolved = RESOLVED_STATUSES.has(data.status)
      ? data.dateResolved ?? before.dateResolved ?? (becomingResolved ? new Date() : null)
      : null;

    await prisma.technicalIssue.update({
      where: { id },
      data: {
        ...data,
        urls: splitUrls(urls),
        dateResolved,
      },
    });
    revalidateIssues();
    return successState("Issue updated.", id);
  } catch {
    return errorState("Could not update the issue.");
  }
}

/** Quick status change from the register. */
export async function setIssueStatus(id: string, status: string): Promise<void> {
  const before = await prisma.technicalIssue.findUnique({ where: { id } });
  if (!before) return;
  const becomingResolved =
    RESOLVED_STATUSES.has(status) && !RESOLVED_STATUSES.has(before.status);
  await prisma.technicalIssue.update({
    where: { id },
    data: {
      status,
      dateResolved: RESOLVED_STATUSES.has(status)
        ? before.dateResolved ?? (becomingResolved ? new Date() : null)
        : null,
    },
  });
  revalidateIssues();
}

export async function deleteIssue(id: string): Promise<void> {
  await prisma.technicalIssue.delete({ where: { id } });
  revalidateIssues();
}
