"use server";

import { revalidatePath } from "next/cache";
import { execute } from "@/lib/db";
import { createId } from "@/lib/id";
import { serverAssetSchema, opsLogSchema } from "@/lib/validation";
import type { DomainStatusRow } from "@/lib/domain-monitor";
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

/**
 * A submitted form represents the whole record, so a blank optional field
 * means "clear it", not "leave it unchanged". Zod turns blanks into
 * `undefined`, which buildInsert/buildUpdate skip — so without this an emptied
 * field (e.g. a cleared provider) would silently keep its old value on edit.
 * Converting `undefined` → `null` persists the blank (the columns are all
 * nullable, so writing NULL matches the database default on insert too).
 */
function clearBlanks<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = { ...data };
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) out[key] = null;
  }
  return out as T;
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
    const { sql, params } = buildInsert("ServerAsset", { id, ...clearBlanks(parsed.data) });
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
    const { sql, params } = buildUpdate("ServerAsset", clearBlanks(parsed.data), id);
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

// --- Live domain monitoring -------------------------------------------------

/**
 * Add a single domain/URL to live monitoring from the Server Inventory. Just
 * needs a domain or URL — it is health-checked automatically from then on.
 */
export async function addMonitoredDomain(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = String(formData.get("domain") ?? "");
  const { addMonitoredHost } = await import("@/lib/domain-monitor");
  const result = await addMonitoredHost(raw);
  if (!result.ok) {
    if (result.reason === "duplicate") return errorState(`${result.host} is already being monitored.`);
    return errorState("Enter a valid domain, e.g. uat-webinsight.atlasskilltech.app");
  }
  revalidateOps();
  return successState(`Now monitoring ${result.host}.`);
}

/**
 * Re-check monitored domains (skipping any checked in the last ~25s) and return
 * the current live list. Called by the Server Inventory panel every 10s.
 */
export async function checkMonitoredDomainsAction(): Promise<DomainStatusRow[]> {
  const { runDomainMonitor, getMonitoredDomains } = await import("@/lib/domain-monitor");
  // ~8s freshness so the 10s client poll re-checks each cycle without
  // redundantly re-probing a domain already checked moments ago.
  await runDomainMonitor({ discover: false, staleMs: 8_000 });
  return getMonitoredDomains();
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
    const { sql, params } = buildInsert("OperationsLog", { id, ...clearBlanks(parsed.data) });
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
    const { sql, params } = buildUpdate("OperationsLog", clearBlanks(parsed.data), id);
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
