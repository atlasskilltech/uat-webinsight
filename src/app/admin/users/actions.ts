"use server";

import { revalidatePath } from "next/cache";
import type { PoolConnection } from "mysql2/promise";
import { transaction } from "@/lib/db";
import { createId } from "@/lib/id";
import type { User } from "@/lib/models";
import { parseForm, errorState, successState } from "@/lib/form-state";
import { createUserSchema, updateUserSchema } from "@/lib/auth/validation";
import { requireAdmin, isAuthError, AuthError } from "@/lib/auth/guard";
import { logAudit } from "@/lib/auth/audit";
import type { SafeUser } from "@/lib/auth/types";
import type { AdminActionState, ActionResult } from "./types";

function deniedState(e: unknown): AdminActionState {
  return errorState(isAuthError(e) ? e.message : "You are not authorized to do that.");
}
function deniedResult(e: unknown): ActionResult {
  return { ok: false, message: isAuthError(e) ? e.message : "You are not authorized to do that." };
}

/**
 * Throws AuthError(409) if applying the change would leave zero active admins.
 * Evaluated inside a transaction so concurrent writes can't both slip past.
 */
async function assertNotLastAdmin(
  conn: PoolConnection,
  targetUserId: string,
  after: { role?: string; status?: string },
): Promise<void> {
  const [targetRows] = await conn.query("SELECT * FROM `User` WHERE `id` = ?", [targetUserId]);
  const target = (targetRows as User[])[0] ?? null;
  if (!target) throw new AuthError("User not found.", 404);
  const [countRows] = await conn.query(
    "SELECT COUNT(*) AS c FROM `User` WHERE `id` <> ? AND `role` = 'admin' AND `status` = 'active'",
    [targetUserId],
  );
  const otherActiveAdmins = Number((countRows as { c: number }[])[0].c);
  const targetStaysActiveAdmin =
    (after.role ?? target.role) === "admin" && (after.status ?? target.status) === "active";
  if (otherActiveAdmins === 0 && !targetStaysActiveAdmin) {
    throw new AuthError("At least one active admin must remain. This change would remove the last admin.", 409);
  }
}

// --- Create (approve) a user ------------------------------------------------
// Creating a user record IS the approval: once added, that person can sign in
// with Google using the matching verified email. No password is involved.
export async function createUserAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let admin: SafeUser;
  try {
    admin = await requireAdmin();
  } catch (e) {
    return deniedState(e);
  }

  const parsed = parseForm(createUserSchema, formData);
  if (!parsed.success) return parsed.state;
  const { name, email, role } = parsed.data;

  try {
    await transaction(async (conn) => {
      const [existingRows] = await conn.query("SELECT * FROM `User` WHERE `email` = ?", [email]);
      const existing = (existingRows as User[])[0] ?? null;
      if (existing) throw new AuthError("A user with this email already exists.", 409);
      const id = createId();
      await conn.query(
        "INSERT INTO `User` (`id`, `name`, `email`, `role`, `status`) VALUES (?, ?, ?, ?, ?)",
        [id, name, email, role, "active"],
      );
      await logAudit(
        { actorId: admin.id, actorEmail: admin.email, action: "user.created", targetUserId: id, targetEmail: email, metadata: { role } },
        conn,
      );
    });
    revalidatePath("/admin/users");
    return successState(`${email} approved. They can now sign in with Google.`);
  } catch (e) {
    if ((e as { code?: string })?.code === "ER_DUP_ENTRY") {
      return errorState("A user with this email already exists.");
    }
    if (isAuthError(e)) return errorState(e.message);
    return errorState("Could not create the user.");
  }
}

// --- Update name / email ----------------------------------------------------
export async function updateUserAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let admin: SafeUser;
  try {
    admin = await requireAdmin();
  } catch (e) {
    return deniedState(e);
  }

  const parsed = parseForm(updateUserSchema, formData);
  if (!parsed.success) return parsed.state;
  const { userId, name, email } = parsed.data;

  try {
    await transaction(async (conn) => {
      const [targetRows] = await conn.query("SELECT * FROM `User` WHERE `id` = ?", [userId]);
      const target = (targetRows as User[])[0] ?? null;
      if (!target) throw new AuthError("User not found.", 404);
      const [clashRows] = await conn.query("SELECT * FROM `User` WHERE `email` = ?", [email]);
      const clash = (clashRows as User[])[0] ?? null;
      if (clash && clash.id !== userId) throw new AuthError("A user with this email already exists.", 409);

      const changed: Record<string, unknown> = {};
      if (target.name !== name) changed.name = { from: target.name, to: name };
      if (target.email !== email) changed.email = { from: target.email, to: email };

      await conn.query("UPDATE `User` SET `name` = ?, `email` = ? WHERE `id` = ?", [name, email, userId]);
      await logAudit(
        { actorId: admin.id, actorEmail: admin.email, action: "user.updated", targetUserId: userId, targetEmail: email, metadata: changed },
        conn,
      );
    });
    revalidatePath("/admin/users");
    return successState("User updated.");
  } catch (e) {
    if ((e as { code?: string })?.code === "ER_DUP_ENTRY") {
      return errorState("A user with this email already exists.");
    }
    if (isAuthError(e)) return errorState(e.message);
    return errorState("Could not update the user.");
  }
}

// --- Change role ------------------------------------------------------------
export async function changeRoleAction(userId: string, role: "admin" | "user"): Promise<ActionResult> {
  let admin: SafeUser;
  try {
    admin = await requireAdmin();
  } catch (e) {
    return deniedResult(e);
  }
  if (role !== "admin" && role !== "user") return { ok: false, message: "Invalid role." };

  try {
    await transaction(async (conn) => {
      const [rows] = await conn.query("SELECT * FROM `User` WHERE `id` = ?", [userId]);
      const target = (rows as User[])[0] ?? null;
      if (!target) throw new AuthError("User not found.", 404);
      if (target.role === role) return;
      if (target.role === "admin" && role === "user") {
        await assertNotLastAdmin(conn, userId, { role: "user" });
      }
      await conn.query("UPDATE `User` SET `role` = ? WHERE `id` = ?", [role, userId]);
      await logAudit(
        { actorId: admin.id, actorEmail: admin.email, action: "user.role_changed", targetUserId: userId, targetEmail: target.email, metadata: { from: target.role, to: role } },
        conn,
      );
    });
    revalidatePath("/admin/users");
    return { ok: true, message: "Role updated." };
  } catch (e) {
    if (isAuthError(e)) return { ok: false, message: e.message };
    return { ok: false, message: "Could not change the role." };
  }
}

// --- Activate / deactivate --------------------------------------------------
// Deactivation takes effect on the user's next request: the Auth.js jwt callback
// re-reads status from the DB each request and getCurrentUser rejects non-active
// users (no session row to delete under the JWT strategy).
export async function setStatusAction(userId: string, status: "active" | "inactive"): Promise<ActionResult> {
  let admin: SafeUser;
  try {
    admin = await requireAdmin();
  } catch (e) {
    return deniedResult(e);
  }
  if (status !== "active" && status !== "inactive") return { ok: false, message: "Invalid status." };

  try {
    await transaction(async (conn) => {
      const [rows] = await conn.query("SELECT * FROM `User` WHERE `id` = ?", [userId]);
      const target = (rows as User[])[0] ?? null;
      if (!target) throw new AuthError("User not found.", 404);
      if (target.status === status) return;
      if (status === "inactive") {
        await assertNotLastAdmin(conn, userId, { status: "inactive" });
      }
      await conn.query("UPDATE `User` SET `status` = ? WHERE `id` = ?", [status, userId]);
      await logAudit(
        {
          actorId: admin.id,
          actorEmail: admin.email,
          action: status === "active" ? "user.activated" : "user.deactivated",
          targetUserId: userId,
          targetEmail: target.email,
        },
        conn,
      );
    });
    revalidatePath("/admin/users");
    return { ok: true, message: status === "active" ? "Account activated." : "Account deactivated." };
  } catch (e) {
    if (isAuthError(e)) return { ok: false, message: e.message };
    return { ok: false, message: "Could not change the account status." };
  }
}
