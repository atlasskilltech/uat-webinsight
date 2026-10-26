"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Server,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Options } from "@/components/ui/form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  SERVER_ASSET_TYPES,
  ASSET_STATUSES,
  OPS_KINDS,
  OPS_STATUSES,
  VERIFICATION_STATUSES,
} from "@/lib/enums";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { AssetForm, type AssetFormValues } from "./asset-form";
import { OpsLogForm, type OpsLogFormValues } from "./ops-form";
import { deleteServerAsset, deleteOpsLog } from "./actions";

export interface AssetRow extends AssetFormValues {
  id: string;
  name: string;
  type: string;
  status: string;
  isDemo?: boolean;
}

export interface OpsRow extends OpsLogFormValues {
  id: string;
  system: string;
  title: string;
  kind: string;
  status: string;
  verificationStatus: string;
  isDemo?: boolean;
}

type Tab = "inventory" | "log";

/** Days until an SSL/cert expiry; negative = past. */
function daysUntil(d?: Date | string | null): number | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

export function OperationsClient({
  assets,
  logs,
  initialTab = "inventory",
  initialNew,
}: {
  assets: AssetRow[];
  logs: OpsRow[];
  initialTab?: Tab;
  initialNew?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [, startTransition] = useTransition();

  // Inventory dialogs
  const [assetOpen, setAssetOpen] = useState(initialTab === "inventory" && Boolean(initialNew));
  const [editingAsset, setEditingAsset] = useState<AssetRow | null>(null);

  // Ops dialogs
  const [logOpen, setLogOpen] = useState(initialTab === "log" && Boolean(initialNew));
  const [editingLog, setEditingLog] = useState<OpsRow | null>(null);

  const [logSearch, setLogSearch] = useState("");
  const [logStatus, setLogStatus] = useState("");

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (logSearch && !`${l.title} ${l.system} ${l.symptoms ?? ""}`.toLowerCase().includes(logSearch.toLowerCase())) return false;
      if (logStatus && l.status !== logStatus) return false;
      return true;
    });
  }, [logs, logSearch, logStatus]);

  const assetsByType = useMemo(() => {
    const map = new Map<string, AssetRow[]>();
    for (const a of assets) {
      const arr = map.get(a.type) ?? [];
      arr.push(a);
      map.set(a.type, arr);
    }
    return map;
  }, [assets]);

  const openNewAsset = () => {
    setEditingAsset(null);
    setAssetOpen(true);
  };
  const openEditAsset = (a: AssetRow) => {
    setEditingAsset(a);
    setAssetOpen(true);
  };
  const openNewLog = () => {
    setEditingLog(null);
    setLogOpen(true);
  };
  const openEditLog = (l: OpsRow) => {
    setEditingLog(l);
    setLogOpen(true);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          options={[
            { value: "inventory", label: "Server Inventory", icon: <Server className="h-4 w-4" /> },
            { value: "log", label: "Operations Log", icon: <ScrollText className="h-4 w-4" /> },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
        {tab === "inventory" ? (
          <Button size="sm" onClick={openNewAsset}>
            <Plus className="h-4 w-4" /> Add asset
          </Button>
        ) : (
          <Button size="sm" onClick={openNewLog}>
            <Plus className="h-4 w-4" /> Add log entry
          </Button>
        )}
      </div>

      {tab === "inventory" ? (
        assets.length === 0 ? (
          <EmptyState
            icon={Server}
            title="No assets documented yet"
            description="Record your hosting, domains, SSL certificates, databases and applications to keep an inventory of what you're responsible for."
            action={<Button size="sm" onClick={openNewAsset}><Plus className="h-4 w-4" /> Add asset</Button>}
          />
        ) : (
          <div className="space-y-6">
            {SERVER_ASSET_TYPES.filter((t) => assetsByType.has(t.value)).map((t) => (
              <div key={t.value}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">{t.label}</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {assetsByType.get(t.value)!.map((a) => (
                    <AssetCard key={a.id} asset={a} onEdit={openEditAsset} onDelete={(id) => startTransition(() => deleteServerAsset(id))} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <Card className="mb-4 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
                <Input value={logSearch} onChange={(e) => setLogSearch(e.target.value)} placeholder="Search log entries…" className="pl-8" />
              </div>
              <Select value={logStatus} onChange={(e) => setLogStatus(e.target.value)} className="w-auto">
                <Options options={OPS_STATUSES} placeholder="All statuses" />
              </Select>
            </div>
          </Card>

          {filteredLogs.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No operations log entries"
              description="Document tasks, incidents, maintenance, deployments and backups with symptoms, investigation and resolution."
            />
          ) : (
            <Card>
              <Table>
                <THead>
                  <tr>
                    <TH>When</TH>
                    <TH>System</TH>
                    <TH>Entry</TH>
                    <TH>Type</TH>
                    <TH>Status</TH>
                    <TH>Verification</TH>
                    <TH className="text-right">Actions</TH>
                  </tr>
                </THead>
                <TBody>
                  {filteredLogs.map((l) => (
                    <TR key={l.id}>
                      <TD className="whitespace-nowrap text-muted">{fmtDateTime(l.occurredAt)}</TD>
                      <TD className="text-muted">{l.system}</TD>
                      <TD className="max-w-sm">
                        <span className="font-medium">{l.title}</span>
                        {l.httpStatus ? <Badge tone="warning" className="ml-2">HTTP {l.httpStatus}</Badge> : null}
                        {l.isDemo && <span className="ml-2 inline-block align-middle"><DemoBadge /></span>}
                        {(l.responsiblePerson || l.approvedBy) && (
                          <span className="mt-0.5 block text-xs text-muted-2">
                            {l.responsiblePerson ? `Owner: ${l.responsiblePerson}` : ""}
                            {l.responsiblePerson && l.approvedBy ? " · " : ""}
                            {l.approvedBy ? `Approved: ${l.approvedBy}` : ""}
                          </span>
                        )}
                      </TD>
                      <TD><StatusBadge options={OPS_KINDS} value={l.kind} /></TD>
                      <TD><StatusBadge options={OPS_STATUSES} value={l.status} dot /></TD>
                      <TD><StatusBadge options={VERIFICATION_STATUSES} value={l.verificationStatus} /></TD>
                      <TD>
                        <div className="flex justify-end gap-1">
                          <Tooltip content="Edit">
                            <button onClick={() => openEditLog(l)} className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                          <Tooltip content="Delete">
                            <button onClick={() => { if (confirm("Delete this log entry?")) startTransition(() => deleteOpsLog(l.id)); }} className="rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </>
      )}

      {/* Dialogs */}
      <Dialog
        open={assetOpen}
        onClose={() => setAssetOpen(false)}
        title={editingAsset ? "Edit asset" : "Add asset"}
        description="Document a piece of infrastructure you're responsible for."
        size="lg"
      >
        <AssetForm asset={editingAsset ?? undefined} onDone={() => setAssetOpen(false)} />
      </Dialog>

      <Dialog
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title={editingLog ? "Edit log entry" : "Record operations entry"}
        description="A documentation record — this tool does not access or change any server."
        size="lg"
      >
        <OpsLogForm log={editingLog ?? undefined} onDone={() => setLogOpen(false)} />
      </Dialog>
    </div>
  );
}

function AssetCard({
  asset,
  onEdit,
  onDelete,
}: {
  asset: AssetRow;
  onEdit: (a: AssetRow) => void;
  onDelete: (id: string) => void;
}) {
  const days = daysUntil(asset.sslExpiry);
  const sslTone =
    days == null ? null : days < 0 ? "danger" : days <= 30 ? "warning" : "success";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-foreground">{asset.name}</h4>
          <p className="mt-0.5 text-xs text-muted">
            {[asset.provider, asset.plan, asset.version].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        <StatusBadge options={ASSET_STATUSES} value={asset.status} dot />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {asset.environment && <Badge tone="neutral">{asset.environment}</Badge>}
        {asset.isDemo && <DemoBadge />}
      </div>

      {asset.sslExpiry && (
        <div className={cn(
          "mt-3 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
          sslTone === "danger" && "bg-danger-soft text-danger",
          sslTone === "warning" && "bg-warning-soft text-warning",
          sslTone === "success" && "bg-success-soft text-success",
        )}>
          {sslTone === "success" ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
          <span>
            Expires {fmtDate(asset.sslExpiry)}
            {days != null && (days < 0 ? " · expired" : days <= 30 ? ` · in ${days}d` : "")}
          </span>
        </div>
      )}

      {asset.notes && <p className="mt-3 line-clamp-2 text-xs text-muted">{asset.notes}</p>}

      <div className="mt-3 flex items-center justify-end gap-1 border-t border-border pt-2">
        <Tooltip content="Edit">
          <button onClick={() => onEdit(asset)} className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="Delete">
          <button onClick={() => { if (confirm("Delete this asset?")) onDelete(asset.id); }} className="rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
    </Card>
  );
}
