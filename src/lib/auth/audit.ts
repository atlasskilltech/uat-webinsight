import "server-only";
import type { PoolConnection } from "mysql2/promise";
import { execute, json } from "@/lib/db";
import { createId } from "@/lib/id";

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
 * Append an audit entry. Pass a transaction connection to record the event in
 * the same transaction as the change it describes; otherwise it uses the pool.
 */
export async function logAudit(entry: AuditEntry, conn?: PoolConnection): Promise<void> {
  const sql =
    "INSERT INTO `AdminAuditLog` " +
    "(`id`,`actorId`,`actorEmail`,`action`,`targetUserId`,`targetEmail`,`metadata`) " +
    "VALUES (?,?,?,?,?,?,?)";
  const params = [
    createId(),
    entry.actorId ?? null,
    entry.actorEmail ?? null,
    entry.action,
    entry.targetUserId ?? null,
    entry.targetEmail ?? null,
    json(entry.metadata),
  ];
  if (conn) await conn.query(sql, params);
  else await execute(sql, params);
}
