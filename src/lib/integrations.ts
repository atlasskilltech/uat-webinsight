import "server-only";
import { prisma } from "./prisma";

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

export async function getIntegrations(): Promise<IntegrationView[]> {
  const providers: Provider[] = ["gsc", "ga4", "psi"];
  const rows = await prisma.integration.findMany({
    where: { provider: { in: providers } },
  });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return providers.map((p) => {
    const row = byProvider.get(p);
    // Read only the non-sensitive sync metadata — tokens never leave the server.
    const sync = (row?.config as { sync?: { inProgress?: boolean; nextRunAt?: string | null; lastResult?: string | null } } | null)?.sync ?? {};
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
  const row = await prisma.integration.findUnique({ where: { provider } });
  return row?.status === "connected";
}

/** Persist a successful sync timestamp. */
export async function recordSync(provider: Provider, propertyId?: string) {
  await prisma.integration.upsert({
    where: { provider },
    update: { status: "connected", lastSyncAt: new Date(), lastError: null, ...(propertyId ? { propertyId } : {}) },
    create: { provider, status: "connected", lastSyncAt: new Date(), propertyId: propertyId ?? null },
  });
}

export async function recordError(provider: Provider, message: string) {
  await prisma.integration.upsert({
    where: { provider },
    update: { status: "error", lastError: message },
    create: { provider, status: "error", lastError: message },
  });
}

export async function disconnect(provider: Provider) {
  await prisma.integration.upsert({
    where: { provider },
    update: { status: "not_connected", config: undefined, lastError: null },
    create: { provider, status: "not_connected" },
  });
}
