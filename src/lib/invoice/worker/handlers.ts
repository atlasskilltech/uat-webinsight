import "server-only";
import { iQuery } from "../db";
import { syncGmailAccount, renewDueWatches } from "../services/gmail";
import { runForwarding } from "../services/forwarding";
import { listOrganizationIds } from "../services/orgs";
import { claimJobs, completeJob, failJob, type JobRow } from "../jobs";

const SYSTEM_ACTOR = { id: "system", email: "worker@invoice-agent" };

export interface TaskSummary {
  task: string;
  ran: number;
  detail: Record<string, unknown>;
}

/** Forward approved invoice emails across all organizations. */
export async function runForwardingAll(): Promise<TaskSummary> {
  const orgs = await listOrganizationIds();
  let forwarded = 0;
  let failed = 0;
  for (const org of orgs) {
    const r = await runForwarding(org);
    forwarded += r.forwarded;
    failed += r.failed;
  }
  return { task: "forward", ran: orgs.length, detail: { forwarded, failed } };
}

/** Sync Gmail accounts that are due (connected, not in backoff, stale). */
export async function runDueGmailSyncs(): Promise<TaskSummary> {
  // Keep Gmail push subscriptions alive (no-op when push is not configured).
  const watch = await renewDueWatches().catch(() => ({ renewed: 0, skipped: true }));
  // How stale a connected account may be before the worker re-syncs it. Default
  // 5 minutes so counts/invoices refresh on their own without a manual sync.
  const intervalMin = Number(process.env.GMAIL_SYNC_INTERVAL_MIN) || 5;
  const due = await iQuery<{ id: string; organization_id: string }>(
    "SELECT g.id, g.organization_id FROM `gmail_integrations` g " +
      "LEFT JOIN `gmail_sync_states` s ON s.gmail_integration_id=g.id " +
      "WHERE g.status='connected' AND (s.backoff_until IS NULL OR s.backoff_until < NOW(3)) " +
      "AND (s.last_incremental_sync_at IS NULL OR s.last_incremental_sync_at < DATE_SUB(NOW(3), INTERVAL ? MINUTE)) LIMIT 20",
    [intervalMin],
  );
  let ok = 0;
  let failed = 0;
  for (const g of due) {
    try {
      await syncGmailAccount(g.organization_id, g.id, SYSTEM_ACTOR);
      ok += 1;
    } catch {
      failed += 1; // the sync service already recorded the error + backoff
    }
  }
  return { task: "gmail_sync", ran: due.length, detail: { ok, failed, watchesRenewed: watch.renewed } };
}

/** Dispatch one claimed job to its handler. */
async function dispatchJob(job: JobRow): Promise<unknown> {
  const p = (job.payload ?? {}) as Record<string, unknown>;
  switch (job.type) {
    case "gmail_sync":
      if (p.organizationId && p.integrationId) {
        await syncGmailAccount(String(p.organizationId), String(p.integrationId), SYSTEM_ACTOR);
      }
      return { handled: "gmail_sync" };
    case "forward":
      if (p.organizationId) return await runForwarding(String(p.organizationId));
      return await runForwardingAll();
    // Types handled inline by the request path (or not worker-owned): no-op.
    default:
      return { skipped: job.type };
  }
}

/** Claim and process a bounded batch of queued jobs. */
export async function drainJobs(workerId: string, limit = 10): Promise<TaskSummary> {
  const jobs = await claimJobs(workerId, limit);
  let succeeded = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const result = await dispatchJob(job);
      await completeJob(job.id, result);
      succeeded += 1;
    } catch (e) {
      await failJob(job.id, e instanceof Error ? e.message : "Job failed.");
      failed += 1;
    }
  }
  return { task: "drain", ran: jobs.length, detail: { succeeded, failed } };
}
