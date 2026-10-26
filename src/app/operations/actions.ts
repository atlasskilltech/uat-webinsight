"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
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

// --- Server assets ----------------------------------------------------------

export async function createServerAsset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(serverAssetSchema, formData);
  if (!parsed.success) return parsed.state;
  try {
    const asset = await prisma.serverAsset.create({ data: parsed.data });
    revalidateOps();
    return successState("Asset added.", asset.id);
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
    await prisma.serverAsset.update({ where: { id }, data: parsed.data });
    revalidateOps();
    return successState("Asset updated.", id);
  } catch {
    return errorState("Could not update the asset.");
  }
}

export async function deleteServerAsset(id: string): Promise<void> {
  await prisma.serverAsset.delete({ where: { id } });
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
    const log = await prisma.operationsLog.create({ data: parsed.data });
    revalidateOps();
    return successState("Log entry recorded.", log.id);
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
    await prisma.operationsLog.update({ where: { id }, data: parsed.data });
    revalidateOps();
    return successState("Log entry updated.", id);
  } catch {
    return errorState("Could not update the log entry.");
  }
}

export async function deleteOpsLog(id: string): Promise<void> {
  await prisma.operationsLog.delete({ where: { id } });
  revalidateOps();
}
