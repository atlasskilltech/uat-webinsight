"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, isAuthError } from "@/lib/auth/guard";
import { generateKey, hashKey, keyLast4 } from "@/lib/agent-api/keys";
import { normaliseScopes } from "@/lib/agent-api/scopes";
import { createKey, revokeKey, setKeyScopes } from "@/lib/agent-api/repo";

export interface KeyFormState {
  status: "idle" | "success" | "error";
  message?: string;
  /** The plaintext key, returned exactly once right after creation. */
  newKey?: string;
  newKeyName?: string;
}

export const idleKeyState: KeyFormState = { status: "idle" };

function parseExpiry(raw: string): { expiresAt: Date | null } | { error: string } {
  const s = raw.trim();
  if (!s) return { expiresAt: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + "T00:00:00Z"))) {
    return { error: "Expiry must be a date (YYYY-MM-DD)." };
  }
  // End of the chosen day (UTC) so the key is valid through that date.
  const expiresAt = new Date(s + "T23:59:59.999Z");
  if (expiresAt.getTime() <= Date.now()) return { error: "Expiry must be in the future." };
  return { expiresAt };
}

export async function createKeyAction(_prev: KeyFormState, formData: FormData): Promise<KeyFormState> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    return { status: "error", message: isAuthError(e) ? e.message : "Admin access is required." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { status: "error", message: "Give the key a name (at least 2 characters)." };
  if (name.length > 120) return { status: "error", message: "The name is too long." };

  const scopes = normaliseScopes(formData.getAll("scopes").map((s) => String(s)));
  if (!scopes.length) return { status: "error", message: "Choose at least one thing this key can read." };

  const requireUser = formData.get("requireUser") === "on";
  const allowedIps = String(formData.get("allowedIps") ?? "").trim() || null;

  const expiry = parseExpiry(String(formData.get("expiresAt") ?? ""));
  if ("error" in expiry) return { status: "error", message: expiry.error };

  const key = generateKey();
  try {
    await createKey({
      name,
      keyHash: hashKey(key),
      keyLast4: keyLast4(key),
      scopes,
      requireUser,
      allowedIps,
      expiresAt: expiry.expiresAt,
      createdBy: admin.email,
    });
  } catch {
    return { status: "error", message: "Could not create the key. Please try again." };
  }

  revalidatePath("/settings/agent-api");
  return {
    status: "success",
    message: "Key created. Copy it now — it is shown only once.",
    newKey: key,
    newKeyName: name,
  };
}

export async function revokeKeyAction(_prev: KeyFormState, formData: FormData): Promise<KeyFormState> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    return { status: "error", message: isAuthError(e) ? e.message : "Admin access is required." };
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", message: "No key specified." };
  const ok = await revokeKey(id, admin.email);
  revalidatePath("/settings/agent-api");
  return ok
    ? { status: "success", message: "Key revoked. IntelligenceOS can no longer use it." }
    : { status: "error", message: "That key was already revoked or does not exist." };
}

export async function updateScopesAction(_prev: KeyFormState, formData: FormData): Promise<KeyFormState> {
  try {
    await requireAdmin();
  } catch (e) {
    return { status: "error", message: isAuthError(e) ? e.message : "Admin access is required." };
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", message: "No key specified." };
  const scopes = normaliseScopes(formData.getAll("scopes").map((s) => String(s)));
  if (!scopes.length) return { status: "error", message: "A key must allow at least one area." };
  const ok = await setKeyScopes(id, scopes);
  revalidatePath("/settings/agent-api");
  return ok
    ? { status: "success", message: "Access updated. Re-check access in IntelligenceOS to refresh it." }
    : { status: "error", message: "Could not update that key (it may be revoked)." };
}
