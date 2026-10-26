import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

export type AuditAction =
  | "user.created"
  | "user.updated"
  | "user.role_changed"
  | "user.activated"
  | "user.deactivated"
  | "invite.created"
  | "reset.created"
  | "password.set"
  | "login.success"
  | "login.failed"
  | "logout";

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  targetUserId?: string | null;
  targetEmail?: string | null;
  /** Safe metadata only — NEVER passwords, tokens, cookies or OAuth secrets. */
  metadata?: Record<string, unknown>;
}

/**
 * Append an audit entry. Pass a transaction client to record the event in the
 * same transaction as the change it describes.
 */
export async function logAudit(entry: AuditEntry, db: Db = prisma): Promise<void> {
  await db.adminAuditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      targetUserId: entry.targetUserId ?? null,
      targetEmail: entry.targetEmail ?? null,
      metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
