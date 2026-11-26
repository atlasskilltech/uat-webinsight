import "server-only";
import { query, queryOne, execute } from "@/lib/db";
import { createId } from "@/lib/id";
import type { AgentApiKey } from "@/lib/models";
import { normaliseScopes } from "./scopes";

/**
 * Persistence for IntelligenceOS Agent API keys and the request log.
 * Tables: `AgentApiKey`, `AgentApiLog` (db/schema.sql).
 */

/** A key as shown in the admin UI (never includes the hash). */
export type SafeKey = Omit<AgentApiKey, "keyHash">;

function mapKey(row: AgentApiKey | null): AgentApiKey | null {
  if (!row) return null;
  return {
    ...row,
    scopes: normaliseScopes(row.scopes),
    requireUser: !!row.requireUser,
    revoked: !!row.revoked,
  };
}

function toSafe(key: AgentApiKey): SafeKey {
  const rest: Record<string, unknown> = { ...key };
  delete rest.keyHash;
  return rest as unknown as SafeKey;
}

/** The matching key for a bearer hash, or null. Does not check revoke/expiry. */
export async function findKeyByHash(hash: string): Promise<AgentApiKey | null> {
  const row = await queryOne<AgentApiKey>("SELECT * FROM `AgentApiKey` WHERE `keyHash` = ? LIMIT 1", [hash]);
  return mapKey(row);
}

/** All keys for the admin page (newest first, active before revoked). */
export async function listKeys(): Promise<SafeKey[]> {
  const rows = await query<AgentApiKey>(
    "SELECT * FROM `AgentApiKey` ORDER BY `revoked` ASC, `createdAt` DESC",
  );
  return rows.map((r) => toSafe(mapKey(r)!));
}

export async function getKey(id: string): Promise<SafeKey | null> {
  const row = await queryOne<AgentApiKey>("SELECT * FROM `AgentApiKey` WHERE `id` = ? LIMIT 1", [id]);
  const mapped = mapKey(row);
  return mapped ? toSafe(mapped) : null;
}

export interface CreateKeyInput {
  name: string;
  keyHash: string;
  keyLast4: string;
  scopes: string[];
  requireUser: boolean;
  allowedIps?: string | null;
  expiresAt?: Date | null;
  createdBy?: string | null;
}

export async function createKey(input: CreateKeyInput): Promise<string> {
  const id = createId();
  await execute(
    "INSERT INTO `AgentApiKey` (`id`, `name`, `keyHash`, `keyLast4`, `scopes`, `requireUser`, `allowedIps`, `expiresAt`, `createdBy`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      input.name,
      input.keyHash,
      input.keyLast4,
      JSON.stringify(normaliseScopes(input.scopes)),
      input.requireUser ? 1 : 0,
      input.allowedIps || null,
      input.expiresAt ?? null,
      input.createdBy || null,
    ],
  );
  return id;
}

export async function revokeKey(id: string, revokedBy: string | null): Promise<boolean> {
  const res = await execute(
    "UPDATE `AgentApiKey` SET `revoked` = 1, `revokedAt` = NOW(3), `revokedBy` = ? WHERE `id` = ? AND `revoked` = 0",
    [revokedBy || null, id],
  );
  return res.affectedRows > 0;
}

/** Change what an active key may read. */
export async function setKeyScopes(id: string, scopes: string[]): Promise<boolean> {
  const res = await execute(
    "UPDATE `AgentApiKey` SET `scopes` = ? WHERE `id` = ? AND `revoked` = 0",
    [JSON.stringify(normaliseScopes(scopes)), id],
  );
  return res.affectedRows > 0;
}

/** Best-effort "last used" stamp (never blocks a request on failure). */
export async function touchKey(id: string): Promise<void> {
  try {
    await execute("UPDATE `AgentApiKey` SET `lastUsedAt` = NOW(3) WHERE `id` = ?", [id]);
  } catch {
    /* ignore */
  }
}

// ─── Request log ──────────────────────────────────────────────────

export interface LogEntry {
  keyId?: string | null;
  userEmail?: string | null;
  action?: string | null;
  path?: string | null;
  method?: string | null;
  agent?: string | null;
  runId?: string | null;
  status: number;
  ms?: number | null;
  ip?: string | null;
  error?: string | null;
}

const clip = (v: unknown, n: number): string | null => (v == null ? null : String(v).slice(0, n));

/** Append one line to the request log. Best-effort: never throws to the caller. */
export async function insertLog(entry: LogEntry): Promise<void> {
  try {
    await execute(
      "INSERT INTO `AgentApiLog` (`keyId`, `userEmail`, `action`, `path`, `method`, `agent`, `runId`, `status`, `ms`, `ip`, `error`) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        entry.keyId || null,
        clip(entry.userEmail, 191),
        clip(entry.action, 80),
        clip(entry.path, 255),
        clip(entry.method, 8),
        clip(entry.agent, 191),
        clip(entry.runId, 120),
        entry.status,
        entry.ms == null ? null : Math.round(entry.ms),
        clip(entry.ip, 64),
        clip(entry.error, 255),
      ],
    );
  } catch {
    /* logging must never break the API */
  }
}

export interface LogRow {
  id: number;
  at: Date;
  keyId: string | null;
  keyName: string | null;
  userEmail: string | null;
  action: string | null;
  path: string | null;
  method: string | null;
  agent: string | null;
  runId: string | null;
  status: number;
  ms: number | null;
  ip: string | null;
  error: string | null;
}

/** Recent request-log rows for the admin page. */
export async function listLog({ limit = 50, keyId = null }: { limit?: number; keyId?: string | null } = {}): Promise<LogRow[]> {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const where = keyId ? "WHERE l.`keyId` = ?" : "";
  const params = keyId ? [keyId, n] : [n];
  return query<LogRow>(
    "SELECT l.`id`, l.`at`, l.`keyId`, k.`name` AS `keyName`, l.`userEmail`, l.`action`, l.`path`, l.`method`, " +
      "l.`agent`, l.`runId`, l.`status`, l.`ms`, l.`ip`, l.`error` " +
      "FROM `AgentApiLog` l LEFT JOIN `AgentApiKey` k ON k.`id` = l.`keyId` " +
      `${where} ORDER BY l.\`id\` DESC LIMIT ?`,
    params,
  );
}

/** Delete request-log rows older than `days` (default 90). Returns rows removed. */
export async function purgeLog(days = 90): Promise<number> {
  const n = Math.max(Number(days) || 90, 7);
  const res = await execute("DELETE FROM `AgentApiLog` WHERE `at` < NOW(3) - INTERVAL ? DAY", [n]);
  return res.affectedRows || 0;
}
