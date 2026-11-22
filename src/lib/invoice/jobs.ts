import "server-only";
import { iQuery, iExecute, iTransaction, ijson } from "./db";
import { createId } from "@/lib/id";
import { JOB_RETRY_LIMIT } from "./config";

/**
 * DB-backed job queue (Phase 0 recommendation — no Redis/BullMQ). Workers claim
 * jobs atomically with SELECT ... FOR UPDATE SKIP LOCKED. Jobs carry an optional
 * idempotency key so the same unit of work is never enqueued twice. Terminal
 * failures move to the `dead` state (dead-letter equivalent).
 *
 * This module is transport only — the worker process (added in the automation
 * milestone) wires job types to handlers.
 */

export type JobType =
  | "gmail_sync"
  | "download_attachment"
  | "ocr"
  | "ai_extract"
  | "validate"
  | "dedupe"
  | "forward"
  | "reminder"
  | "recurring"
  | "report"
  | "agent_task";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

export interface JobRow {
  id: string;
  organization_id: string | null;
  type: JobType;
  status: JobStatus;
  priority: number;
  payload: unknown;
  result: unknown;
  idempotency_key: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_after: Date;
  locked_at: Date | null;
  locked_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EnqueueInput {
  type: JobType;
  organizationId?: string | null;
  payload?: Record<string, unknown>;
  priority?: number;
  idempotencyKey?: string | null;
  runAfter?: Date;
  maxAttempts?: number;
}

/** Enqueue a job. If an idempotency key is supplied and already present, the
 *  existing job id is returned and no duplicate is created. */
export async function enqueueJob(input: EnqueueInput): Promise<string> {
  const id = createId();
  const res = await iExecute(
    "INSERT INTO `processing_jobs` " +
      "(`id`,`organization_id`,`type`,`status`,`priority`,`payload`,`idempotency_key`," +
      "`max_attempts`,`run_after`) " +
      "VALUES (?,?,?,'queued',?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `id` = `id`", // no-op on idempotency collision
    [
      id,
      input.organizationId ?? null,
      input.type,
      input.priority ?? 100,
      ijson(input.payload ?? {}),
      input.idempotencyKey ?? null,
      input.maxAttempts ?? JOB_RETRY_LIMIT,
      input.runAfter ?? new Date(),
    ],
  );
  if (res.affectedRows === 0 && input.idempotencyKey) {
    const existing = await iQuery<{ id: string }>(
      "SELECT `id` FROM `processing_jobs` WHERE `idempotency_key` = ?",
      [input.idempotencyKey],
    );
    return existing[0]?.id ?? id;
  }
  return id;
}

/**
 * Atomically claim up to `limit` due jobs for this worker. Uses FOR UPDATE SKIP
 * LOCKED so concurrent workers never grab the same row (MySQL 8.0+).
 */
export async function claimJobs(workerId: string, limit = 1): Promise<JobRow[]> {
  return iTransaction(async (conn) => {
    const [rows] = await conn.query(
      "SELECT * FROM `processing_jobs` " +
        "WHERE `status` = 'queued' AND `run_after` <= NOW(3) " +
        "ORDER BY `priority` ASC, `run_after` ASC " +
        "LIMIT ? FOR UPDATE SKIP LOCKED",
      [limit],
    );
    const jobs = rows as JobRow[];
    if (jobs.length === 0) return [];
    const ids = jobs.map((j) => j.id);
    const placeholders = ids.map(() => "?").join(",");
    await conn.query(
      `UPDATE \`processing_jobs\` SET \`status\`='running', \`attempts\`=\`attempts\`+1, ` +
        `\`locked_at\`=NOW(3), \`locked_by\`=? WHERE \`id\` IN (${placeholders})`,
      [workerId, ...ids],
    );
    return jobs.map((j) => ({ ...j, status: "running" as JobStatus, attempts: j.attempts + 1 }));
  });
}

export async function completeJob(id: string, result?: unknown): Promise<void> {
  await iExecute(
    "UPDATE `processing_jobs` SET `status`='succeeded', `result`=?, `last_error`=NULL, " +
      "`locked_at`=NULL, `locked_by`=NULL WHERE `id`=?",
    [ijson(result ?? {}), id],
  );
}

/**
 * Mark a job failed. If attempts remain, requeue with exponential backoff;
 * otherwise move it to the terminal `dead` state.
 */
export async function failJob(id: string, error: string): Promise<"retry" | "dead"> {
  const rows = await iQuery<{ attempts: number; max_attempts: number }>(
    "SELECT `attempts`,`max_attempts` FROM `processing_jobs` WHERE `id`=?",
    [id],
  );
  const job = rows[0];
  const attempts = job?.attempts ?? 0;
  const max = job?.max_attempts ?? JOB_RETRY_LIMIT;
  const truncated = error.slice(0, 2000);

  if (attempts >= max) {
    await iExecute(
      "UPDATE `processing_jobs` SET `status`='dead', `last_error`=?, `locked_at`=NULL, " +
        "`locked_by`=NULL WHERE `id`=?",
      [truncated, id],
    );
    return "dead";
  }
  const backoffSeconds = Math.min(3600, 2 ** attempts * 30); // 30s, 60s, 120s, … capped 1h
  await iExecute(
    "UPDATE `processing_jobs` SET `status`='queued', `last_error`=?, `locked_at`=NULL, " +
      "`locked_by`=NULL, `run_after`=DATE_ADD(NOW(3), INTERVAL ? SECOND) WHERE `id`=?",
    [truncated, backoffSeconds, id],
  );
  return "retry";
}

/** Recent jobs for the processing-queue view. */
export async function listRecentJobs(organizationId: string, limit = 50): Promise<JobRow[]> {
  return iQuery<JobRow>(
    "SELECT * FROM `processing_jobs` WHERE organization_id=? ORDER BY `updated_at` DESC LIMIT ?",
    [organizationId, limit],
  );
}

/** Counts by status for a given org (dashboard / processing queue). */
export async function jobCounts(organizationId: string): Promise<Record<JobStatus, number>> {
  const rows = await iQuery<{ status: JobStatus; c: number }>(
    "SELECT `status`, COUNT(*) AS c FROM `processing_jobs` WHERE `organization_id`=? GROUP BY `status`",
    [organizationId],
  );
  const out: Record<JobStatus, number> = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
  };
  for (const r of rows) out[r.status] = Number(r.c);
  return out;
}
