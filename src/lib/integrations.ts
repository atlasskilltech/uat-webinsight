import "server-only";
import { execute, query, queryOne } from "./db";
import { createId } from "./id";
import type { Integration } from "./models";

export type Provider = "gsc" | "ga4" | "psi";

export interface IntegrationView {
  provider: Provider;
  status: "not_connected" | "connected" | "error";
  propertyId: string | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  /** Whether the server has the credentials/config needed to connect. */
  configured: boolean;
  /** True while a sync is currently running (from config.sync). */
  syncInProgress: boolean;
  /** Expected next scheduled run — only set after a scheduled run has occurred. */
  nextSyncAt: string | null;
  /** Human-readable result of the last run (e.g. "No new data available yet"). */
  lastSyncMessage: string | null;
}

/** Does the environment have Google OAuth credentials configured? */
export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function psiConfigured(): boolean {
  // PSI works without a key (rate-limited); a key is optional.
  return true;
}

function configuredFor(provider: Provider): boolean {
  if (provider === "psi") return psiConfigured();
  return googleConfigured();
}

type SyncConfig = {
  sync?: { inProgress?: boolean; nextRunAt?: string | null; lastResult?: string | null };
} | null;

export async function getIntegrations(): Promise<IntegrationView[]> {
  const providers: Provider[] = ["gsc", "ga4", "psi"];
  const rows = await query<Integration>(
    "SELECT * FROM `Integration` WHERE `provider` IN (?, ?, ?)",
    providers,
  );
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return providers.map((p) => {
    const row = byProvider.get(p);
    // Read only the non-sensitive sync metadata — tokens never leave the server.
    const sync = (row?.config as SyncConfig)?.sync ?? {};
    return {
      provider: p,
      status: (row?.status as IntegrationView["status"]) ?? "not_connected",
      propertyId: row?.propertyId ?? null,
      lastSyncAt: row?.lastSyncAt ?? null,
      lastError: row?.lastError ?? null,
      configured: configuredFor(p),
      syncInProgress: Boolean(sync.inProgress),
      nextSyncAt: sync.nextRunAt ?? null,
      lastSyncMessage: sync.lastResult ?? null,
    };
  });
}

export async function getIntegration(provider: Provider): Promise<IntegrationView> {
  const all = await getIntegrations();
  return all.find((i) => i.provider === provider)!;
}

export async function isConnected(provider: Provider): Promise<boolean> {
  const row = await queryOne<Integration>(
    "SELECT `status` FROM `Integration` WHERE `provider` = ?",
    [provider],
  );
  return row?.status === "connected";
}

/** Persist a successful sync timestamp. */
export async function recordSync(provider: Provider, propertyId?: string) {
  if (propertyId) {
    await execute(
      "INSERT INTO `Integration` (`id`,`provider`,`status`,`lastSyncAt`,`lastError`,`propertyId`) " +
        "VALUES (?,?,'connected',?,NULL,?) " +
        "ON DUPLICATE KEY UPDATE `status`='connected', `lastSyncAt`=VALUES(`lastSyncAt`), `lastError`=NULL, `propertyId`=VALUES(`propertyId`)",
      [createId(), provider, new Date(), propertyId],
    );
  } else {
    await execute(
      "INSERT INTO `Integration` (`id`,`provider`,`status`,`lastSyncAt`,`lastError`) " +
        "VALUES (?,?,'connected',?,NULL) " +
        "ON DUPLICATE KEY UPDATE `status`='connected', `lastSyncAt`=VALUES(`lastSyncAt`), `lastError`=NULL",
      [createId(), provider, new Date()],
    );
  }
}

export async function recordError(provider: Provider, message: string) {
  await execute(
    "INSERT INTO `Integration` (`id`,`provider`,`status`,`lastError`) VALUES (?,?,'error',?) " +
      "ON DUPLICATE KEY UPDATE `status`='error', `lastError`=VALUES(`lastError`)",
    [createId(), provider, message],
  );
}

export async function disconnect(provider: Provider) {
  // Clear config so stored OAuth tokens are removed on disconnect.
  await execute(
    "INSERT INTO `Integration` (`id`,`provider`,`status`,`config`,`lastError`) VALUES (?,?,'not_connected',NULL,NULL) " +
      "ON DUPLICATE KEY UPDATE `status`='not_connected', `config`=NULL, `lastError`=NULL",
    [createId(), provider],
  );
}
