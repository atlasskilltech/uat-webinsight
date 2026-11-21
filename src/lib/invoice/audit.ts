import "server-only";
import type { PoolConnection } from "mysql2/promise";
import { iExecute, ijson } from "./db";
import { createId } from "@/lib/id";

/**
 * Immutable finance audit trail (invoice_audit_logs). Records who changed what,
 * with before/after snapshots. Pass a transaction connection to record the
 * event atomically with the change it describes.
 *
 * NEVER include secrets (tokens, bank numbers, passwords) in before/after/metadata.
 */
export interface InvoiceAuditEntry {
  organizationId: string | null;
  actorType?: "user" | "agent" | "system";
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string; // e.g. "invoice.approved", "payment.recorded"
  entityType: string; // e.g. "invoice", "payment"
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export async function logInvoiceAudit(
  entry: InvoiceAuditEntry,
  conn?: PoolConnection,
): Promise<void> {
  const sql =
    "INSERT INTO `invoice_audit_logs` " +
    "(`id`,`organization_id`,`actor_type`,`actor_user_id`,`actor_label`,`action`," +
    "`entity_type`,`entity_id`,`before`,`after`,`metadata`) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?)";
  const params = [
    createId(),
    entry.organizationId,
    entry.actorType ?? "user",
    entry.actorUserId ?? null,
    entry.actorLabel ?? null,
    entry.action,
    entry.entityType,
    entry.entityId ?? null,
    ijson(entry.before),
    ijson(entry.after),
    ijson(entry.metadata),
  ];
  if (conn) await conn.query(sql, params);
  else await iExecute(sql, params);
}
