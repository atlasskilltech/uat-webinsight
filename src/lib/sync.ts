import "server-only";
import { execute, queryOne, transaction } from "@/lib/db";
import { createId } from "@/lib/id";
import {
  validAccessToken,
  fetchSearchConsole,
  fetchGa4Report,
  GoogleApiError,
  type GoogleTokens,
} from "@/lib/google";
import { recordSync, recordError, type Provider } from "@/lib/integrations";
import type { Integration } from "@/lib/models";

/**
 * Shared Google sync engine, used by BOTH the manual "Sync 28d" buttons
 * (via the settings server action) and the scheduled /api/cron/sync endpoint.
 *
 * Key guarantees:
 *  - Overlap-safe: an atomic, DB-backed compare-and-set lock inside
 *    Integration.config (`$.sync.inProgress`) means only one run per provider
 *    proceeds at a time. A stale lock (crashed run) is reclaimed after a timeout.
 *  - Non-destructive refresh: data is fetched and validated FIRST; only then is
 *    the exact (provider, property, date-window) slice of REAL rows replaced,
 *    inside a transaction, so a failed insert cannot leave a gap. Demo rows and
 *    real rows outside the window are never touched. An empty API response is
 *    treated as "no new data" and leaves existing data intact.
 *  - Token-safe: refreshed tokens are persisted; auth/config errors are marked
 *    permanent and never retried.
 */

const STALE_LOCK_MS = 10 * 60 * 1000; // a lock older than this is treated as abandoned
const DEFAULT_WINDOW_DAYS = Number(process.env.SYNC_WINDOW_DAYS) || 30;

export interface SyncResult {
  provider: Provider;
  ok: boolean;
  skipped?: boolean;
  count: number;
  message: string;
}

interface SyncMeta {
  inProgress?: boolean;
  startedAt?: number | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastTrigger?: string | null;
  lastResult?: string | null;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Prefer a property id saved in the DB; fall back to the .env value. */
function resolveProperty(provider: Provider, dbProperty?: string | null): string {
  const db = dbProperty?.trim();
  if (db) return db;
  const env = provider === "gsc" ? process.env.GSC_PROPERTY : process.env.GA4_PROPERTY_ID;
  return env?.trim() ?? "";
}

async function readSyncMeta(provider: Provider): Promise<SyncMeta> {
  const row = await queryOne<Integration>(
    "SELECT `config` FROM `Integration` WHERE `provider` = ?",
    [provider],
  );
  const cfg = row?.config as { sync?: SyncMeta } | null;
  return cfg?.sync ?? {};
}

/**
 * Atomically acquire the per-provider sync lock. The WHERE clause is evaluated
 * against the committed row at write time, so even if two requests read the
 * same stale state, only one UPDATE matches and writes. Returns true if the
 * lock was acquired by this call.
 */
async function acquireLock(provider: Provider, meta: SyncMeta): Promise<boolean> {
  const next: SyncMeta = { ...meta, inProgress: true, startedAt: Date.now() };
  const staleBefore = Date.now() - STALE_LOCK_MS;
  const res = await execute(
    "UPDATE `Integration` " +
      "SET `config` = JSON_SET(COALESCE(`config`, '{}'), '$.sync', CAST(? AS JSON)) " +
      "WHERE `provider` = ? AND ( " +
      "  COALESCE(`config`->>'$.sync.inProgress', 'false') <> 'true' " +
      "  OR COALESCE(CAST(`config`->>'$.sync.startedAt' AS UNSIGNED), 0) < ? " +
      ")",
    [JSON.stringify(next), provider, staleBefore],
  );
  return res.affectedRows === 1;
}

/** Write the sync metadata sub-object, preserving tokens and other config. */
async function writeSyncMeta(provider: Provider, meta: SyncMeta): Promise<void> {
  await execute(
    "UPDATE `Integration` SET `config` = JSON_SET(COALESCE(`config`, '{}'), '$.sync', CAST(? AS JSON)) WHERE `provider` = ?",
    [JSON.stringify(meta), provider],
  );
}

/** Persist refreshed tokens without disturbing the sync lock metadata. */
async function persistTokens(provider: Provider, tokens: GoogleTokens): Promise<void> {
  await execute(
    "UPDATE `Integration` SET `config` = JSON_SET(COALESCE(`config`, '{}'), '$.tokens', CAST(? AS JSON)) WHERE `provider` = ?",
    [JSON.stringify(tokens), provider],
  );
}

/** Bounded retry: at most `retries` extra attempts, never for permanent errors. */
async function withRetry<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 500): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const permanent = e instanceof GoogleApiError && e.permanent;
      if (permanent || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      attempt++;
    }
  }
}

/**
 * Fetch recent metrics for one provider and refresh the stored real rows for
 * the synced window. Safe to call repeatedly. Never throws for expected
 * failures — returns a result the caller can report.
 */
export async function runGoogleSync(
  provider: Provider,
  opts: { trigger: "manual" | "cron"; windowDays?: number } = { trigger: "manual" },
): Promise<SyncResult> {
  if (provider === "psi") {
    return { provider, ok: false, skipped: true, count: 0, message: "PageSpeed is used per-URL in the Page Inspector, not synced here." };
  }

  const row = await queryOne<Integration>(
    "SELECT * FROM `Integration` WHERE `provider` = ?",
    [provider],
  );
  const config = row?.config as { tokens?: GoogleTokens } | null;
  const property = resolveProperty(provider, row?.propertyId);

  // Gate: tokens present == Google account connected (disconnect clears them).
  // We intentionally allow a provider in "error" state to retry so a transient
  // failure can self-recover on the next scheduled/manual run.
  if (!config?.tokens) {
    return { provider, ok: false, skipped: true, count: 0, message: "Not connected. Connect your Google account first." };
  }
  if (!property) {
    return { provider, ok: false, skipped: true, count: 0, message: "Set the property id in Settings (or in .env) before syncing." };
  }

  // Overlap guard — atomic lock.
  const meta = await readSyncMeta(provider);
  const locked = await acquireLock(provider, meta);
  if (!locked) {
    return { provider, ok: false, skipped: true, count: 0, message: "A sync is already in progress for this provider." };
  }

  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - windowDays);

  const finish = (patch: Partial<SyncMeta>) =>
    writeSyncMeta(provider, { ...meta, inProgress: false, startedAt: null, lastTrigger: opts.trigger, ...patch });

  try {
    // 1. Ensure a valid access token, persisting any refresh.
    const tokens = await withRetry(() => validAccessToken(config.tokens!));
    if (tokens !== config.tokens) await persistTokens(provider, tokens);

    // 2. Fetch FIRST. Only replace stored rows once a successful response is in hand.
    let count = 0;
    if (provider === "gsc") {
      const rows = await withRetry(() =>
        fetchSearchConsole(tokens.access_token, property, { startDate: fmt(start), endDate: fmt(end), dimensions: ["date"] }),
      );
      count = rows.length;
      if (count > 0) {
        await transaction(async (conn) => {
          const batchId = createId();
          await conn.query(
            "INSERT INTO `ImportBatch` (`id`,`source`,`propertyId`,`periodStart`,`periodEnd`,`isDemo`,`status`,`message`,`rowCount`) VALUES (?,?,?,?,?,?,?,?,?)",
            [batchId, "gsc", property, start, end, false, "completed", `Auto sync (${opts.trigger})`, count],
          );
          await conn.query(
            "DELETE FROM `SeoSnapshot` WHERE `source`=? AND `propertyId`=? AND `isDemo`=? AND `startDate` >= ? AND `startDate` <= ?",
            ["gsc", property, false, start, end],
          );
          const values = rows.map((r) => {
            const d = new Date(r.keys[0]);
            return [createId(), property, "gsc", d, d, r.clicks, r.impressions, r.ctr, r.position, false, batchId];
          });
          await conn.query(
            "INSERT INTO `SeoSnapshot` (`id`,`propertyId`,`source`,`startDate`,`endDate`,`clicks`,`impressions`,`ctr`,`position`,`isDemo`,`importBatchId`) VALUES ?",
            [values],
          );
        });
      }
    } else {
      const { rows } = await withRetry(() =>
        fetchGa4Report(tokens.access_token, property, {
          startDate: fmt(start),
          endDate: fmt(end),
          dimensions: ["date"],
          metrics: ["screenPageViews", "activeUsers", "sessions", "engagedSessions", "engagementRate", "averageSessionDuration"],
        }),
      );
      count = rows.length;
      if (count > 0) {
        await transaction(async (conn) => {
          const batchId = createId();
          await conn.query(
            "INSERT INTO `ImportBatch` (`id`,`source`,`propertyId`,`periodStart`,`periodEnd`,`isDemo`,`status`,`message`,`rowCount`) VALUES (?,?,?,?,?,?,?,?,?)",
            [batchId, "ga4", property, start, end, false, "completed", `Auto sync (${opts.trigger})`, count],
          );
          await conn.query(
            "DELETE FROM `AnalyticsSnapshot` WHERE `source`=? AND `propertyId`=? AND `isDemo`=? AND `startDate` >= ? AND `startDate` <= ?",
            ["ga4", property, false, start, end],
          );
          const values = rows.map((r) => {
            const raw = r.dimensionValues[0].value; // YYYYMMDD
            const d = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
            const m = r.metricValues.map((v) => Number(v.value));
            return [createId(), property, "ga4", d, d, m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 0, m[4] ?? 0, m[5] ?? 0, false, batchId];
          });
          await conn.query(
            "INSERT INTO `AnalyticsSnapshot` (`id`,`propertyId`,`source`,`startDate`,`endDate`,`views`,`activeUsers`,`sessions`,`engagedSessions`,`engagementRate`,`avgEngagementSecs`,`isDemo`,`importBatchId`) VALUES ?",
            [values],
          );
        });
      }
    }

    // 3. Record a verified successful contact (recordSync leaves config.sync intact).
    await recordSync(provider, property);
    const nextRunAt = opts.trigger === "cron" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : (meta.nextRunAt ?? null);
    const message = count > 0
      ? `Synced ${count} days from ${provider.toUpperCase()}.`
      : `No new ${provider.toUpperCase()} data available yet — existing data kept.`;
    await finish({ lastRunAt: new Date().toISOString(), nextRunAt, lastResult: message });
    return { provider, ok: true, count, message };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed.";
    await recordError(provider, message);
    await finish({ lastResult: message });
    return { provider, ok: false, count: 0, message };
  }
}
