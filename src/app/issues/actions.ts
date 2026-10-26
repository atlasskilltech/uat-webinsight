"use server";

import { revalidatePath } from "next/cache";
import { execute, queryOne, json } from "@/lib/db";
import { createId } from "@/lib/id";
import type { TechnicalIssue } from "@/lib/models";
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

/** Build an INSERT for the given record, omitting undefined fields so the
 * database defaults apply (mirrors Prisma's create omission semantics). */
function buildInsert(table: string, record: Record<string, unknown>) {
  const cols: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    cols.push(`\`${key}\``);
    params.push(value);
  }
  const sql = `INSERT INTO \`${table}\` (${cols.join(", ")}) VALUES (${cols
    .map(() => "?")
    .join(", ")})`;
  return { sql, params };
}

/** Build an UPDATE ... WHERE id = ? for the provided fields only (undefined
 * fields are left unchanged, mirroring Prisma's update semantics). */
function buildUpdate(table: string, record: Record<string, unknown>, id: string) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    sets.push(`\`${key}\` = ?`);
    params.push(value);
  }
  params.push(id);
  const sql = `UPDATE \`${table}\` SET ${sets.join(", ")} WHERE \`id\` = ?`;
  return { sql, params };
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
    const id = createId();
    const record: Record<string, unknown> = {
      id,
      ...data,
      urls: json(splitUrls(urls)),
      dateResolved:
        RESOLVED_STATUSES.has(data.status) && !data.dateResolved
          ? new Date()
          : data.dateResolved,
    };
    const { sql, params } = buildInsert("TechnicalIssue", record);
    await execute(sql, params);
    revalidateIssues();
    return successState("Issue recorded.", id);
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
    const before = await queryOne<TechnicalIssue>(
      "SELECT * FROM `TechnicalIssue` WHERE `id` = ?",
      [id],
    );
    if (!before) return errorState("Issue not found.");

    const becomingResolved =
      RESOLVED_STATUSES.has(data.status) && !RESOLVED_STATUSES.has(before.status);
    const dateResolved = RESOLVED_STATUSES.has(data.status)
      ? data.dateResolved ?? before.dateResolved ?? (becomingResolved ? new Date() : null)
      : null;

    const record: Record<string, unknown> = {
      ...data,
      urls: json(splitUrls(urls)),
      dateResolved,
    };
    const { sql, params } = buildUpdate("TechnicalIssue", record, id);
    await execute(sql, params);
    revalidateIssues();
    return successState("Issue updated.", id);
  } catch {
    return errorState("Could not update the issue.");
  }
}

/** Quick status change from the register. */
export async function setIssueStatus(id: string, status: string): Promise<void> {
  const before = await queryOne<TechnicalIssue>(
    "SELECT * FROM `TechnicalIssue` WHERE `id` = ?",
    [id],
  );
  if (!before) return;
  const becomingResolved =
    RESOLVED_STATUSES.has(status) && !RESOLVED_STATUSES.has(before.status);
  await execute(
    "UPDATE `TechnicalIssue` SET `status` = ?, `dateResolved` = ? WHERE `id` = ?",
    [
      status,
      RESOLVED_STATUSES.has(status)
        ? before.dateResolved ?? (becomingResolved ? new Date() : null)
        : null,
      id,
    ],
  );
  revalidateIssues();
}

export async function deleteIssue(id: string): Promise<void> {
  await execute("DELETE FROM `TechnicalIssue` WHERE `id` = ?", [id]);
  revalidateIssues();
}
