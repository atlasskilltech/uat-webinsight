"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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
  tx: Prisma.TransactionClient,
  targetUserId: string,
  after: { role?: string; status?: string },
): Promise<void> {
  const target = await tx.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new AuthError("User not found.", 404);
  const otherActiveAdmins = await tx.user.count({
    where: { id: { not: targetUserId }, role: "admin", status: "active" },
  });
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
    await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new AuthError("A user with this email already exists.", 409);
      const created = await tx.user.create({ data: { name, email, role, status: "active" } });
      await logAudit(
        { actorId: admin.id, actorEmail: admin.email, action: "user.created", targetUserId: created.id, targetEmail: created.email, metadata: { role } },
        tx,
      );
    });
    revalidatePath("/admin/users");
    return successState(`${email} approved. They can now sign in with Google.`);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
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
    await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (!target) throw new AuthError("User not found.", 404);
      const clash = await tx.user.findUnique({ where: { email } });
      if (clash && clash.id !== userId) throw new AuthError("A user with this email already exists.", 409);

      const changed: Record<string, unknown> = {};
      if (target.name !== name) changed.name = { from: target.name, to: name };
      if (target.email !== email) changed.email = { from: target.email, to: email };

      await tx.user.update({ where: { id: userId }, data: { name, email } });
      await logAudit(
        { actorId: admin.id, actorEmail: admin.email, action: "user.updated", targetUserId: userId, targetEmail: email, metadata: changed },
        tx,
      );
    });
    revalidatePath("/admin/users");
    return successState("User updated.");
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
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
    await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (!target) throw new AuthError("User not found.", 404);
      if (target.role === role) return;
      if (target.role === "admin" && role === "user") {
        await assertNotLastAdmin(tx, userId, { role: "user" });
      }
      await tx.user.update({ where: { id: userId }, data: { role } });
      await logAudit(
        { actorId: admin.id, actorEmail: admin.email, action: "user.role_changed", targetUserId: userId, targetEmail: target.email, metadata: { from: target.role, to: role } },
        tx,
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
    await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (!target) throw new AuthError("User not found.", 404);
      if (target.status === status) return;
      if (status === "inactive") {
        await assertNotLastAdmin(tx, userId, { status: "inactive" });
      }
      await tx.user.update({ where: { id: userId }, data: { status } });
      await logAudit(
        {
          actorId: admin.id,
          actorEmail: admin.email,
          action: status === "active" ? "user.activated" : "user.deactivated",
          targetUserId: userId,
          targetEmail: target.email,
        },
        tx,
      );
    });
    revalidatePath("/admin/users");
    return { ok: true, message: status === "active" ? "Account activated." : "Account deactivated." };
  } catch (e) {
    if (isAuthError(e)) return { ok: false, message: e.message };
    return { ok: false, message: "Could not change the account status." };
  }
}
