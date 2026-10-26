import type { Metadata } from "next";
import { Server, AlertTriangle, ShieldAlert } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { fmtDate } from "@/lib/dates";
import {
  OperationsClient,
  type AssetRow,
  type OpsRow,
} from "./operations-client";

export const metadata: Metadata = { title: "Backend & Server" };
export const dynamic = "force-dynamic";

function StatChip({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Server;
  label: string;
  value: string | number;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tone}`}>
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div>
        <p className="text-lg font-semibold leading-none tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted">{label}</p>
      </div>
    </div>
  );
}

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; new?: string }>;
}) {
  const sp = await searchParams;
  const [assetsRaw, logsRaw] = await Promise.all([
    prisma.serverAsset.findMany({ orderBy: { type: "asc" } }),
    prisma.operationsLog.findMany({ orderBy: { occurredAt: "desc" } }),
  ]);

  const assets: AssetRow[] = assetsRaw.map((a) => ({
    id: a.id,
    type: a.type,
    name: a.name,
    provider: a.provider,
    plan: a.plan,
    environment: a.environment,
    version: a.version,
    status: a.status,
    sslExpiry: a.sslExpiry,
    notes: a.notes,
    isDemo: a.isDemo,
  }));

  const logs: OpsRow[] = logsRaw.map((l) => ({
    id: l.id,
    occurredAt: l.occurredAt,
    system: l.system,
    title: l.title,
    kind: l.kind,
    status: l.status,
    verificationStatus: l.verificationStatus,
    httpStatus: l.httpStatus,
    symptoms: l.symptoms,
    investigation: l.investigation,
    resolution: l.resolution,
    approvedBy: l.approvedBy,
    responsiblePerson: l.responsiblePerson,
    isDemo: l.isDemo,
  }));

  const activeAssets = assetsRaw.filter((a) => a.status === "active").length;
  const openIncidents = logsRaw.filter(
    (l) => l.kind === "incident" && l.status !== "resolved",
  ).length;
  const nextSsl = assetsRaw
    .filter((a) => a.sslExpiry)
    .map((a) => a.sslExpiry as Date)
    .sort((x, y) => x.getTime() - y.getTime())[0];

  const initialTab = sp.tab === "log" ? "log" : "inventory";

  return (
    <div>
      <PageHeader
        title="Backend & Server Operations"
        description="Document and track your hosting, infrastructure and operational work. This is a documentation and task-tracking system only — it does not connect to, or make changes on, any server."
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatChip icon={Server} label="Active assets" value={activeAssets} tone="bg-success-soft text-success" />
        <StatChip icon={AlertTriangle} label="Open incidents" value={openIncidents} tone="bg-danger-soft text-danger" />
        <StatChip
          icon={ShieldAlert}
          label="Next SSL expiry"
          value={nextSsl ? fmtDate(nextSsl) : "—"}
          tone="bg-warning-soft text-warning"
        />
      </div>

      <OperationsClient
        assets={assets}
        logs={logs}
        initialTab={initialTab}
        initialNew={sp.new === "1"}
      />
    </div>
  );
}
