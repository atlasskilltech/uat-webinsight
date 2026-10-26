"use server";

import { revalidatePath } from "next/cache";
import { execute } from "@/lib/db";
import { createId } from "@/lib/id";
import { serverAssetSchema, opsLogSchema } from "@/lib/validation";
import {
  parseForm,
  successState,
  errorState,
  type FormState,
} from "@/lib/form-state";

function revalidateOps() {
  revalidatePath("/operations");
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

// --- Server assets ----------------------------------------------------------

export async function createServerAsset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(serverAssetSchema, formData);
  if (!parsed.success) return parsed.state;
  try {
    const id = createId();
    const { sql, params } = buildInsert("ServerAsset", { id, ...parsed.data });
    await execute(sql, params);
    revalidateOps();
    return successState("Asset added.", id);
  } catch {
    return errorState("Could not add the asset. Please try again.");
  }
}

export async function updateServerAsset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return errorState("Missing asset id.");
  const parsed = parseForm(serverAssetSchema, formData);
  if (!parsed.success) return parsed.state;
  try {
    const { sql, params } = buildUpdate("ServerAsset", { ...parsed.data }, id);
    await execute(sql, params);
    revalidateOps();
    return successState("Asset updated.", id);
  } catch {
    return errorState("Could not update the asset.");
  }
}

export async function deleteServerAsset(id: string): Promise<void> {
  await execute("DELETE FROM `ServerAsset` WHERE `id` = ?", [id]);
  revalidateOps();
}

// --- Operations log ---------------------------------------------------------

export async function createOpsLog(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(opsLogSchema, formData);
  if (!parsed.success) return parsed.state;
  try {
    const id = createId();
    const { sql, params } = buildInsert("OperationsLog", { id, ...parsed.data });
    await execute(sql, params);
    revalidateOps();
    return successState("Log entry recorded.", id);
  } catch {
    return errorState("Could not record the log entry. Please try again.");
  }
}

export async function updateOpsLog(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return errorState("Missing log id.");
  const parsed = parseForm(opsLogSchema, formData);
  if (!parsed.success) return parsed.state;
  try {
    const { sql, params } = buildUpdate("OperationsLog", { ...parsed.data }, id);
    await execute(sql, params);
    revalidateOps();
    return successState("Log entry updated.", id);
  } catch {
    return errorState("Could not update the log entry.");
  }
}

export async function deleteOpsLog(id: string): Promise<void> {
  await execute("DELETE FROM `OperationsLog` WHERE `id` = ?", [id]);
  revalidateOps();
}
