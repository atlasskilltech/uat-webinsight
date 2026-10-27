"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Globe,
  Plug,
  Database,
  CheckCircle2,
  Upload,
  Link2,
  RefreshCw,
  Unplug,
  FlaskConical,
  Download,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, Input, Select, Options } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { DemoBadge } from "@/components/ui/demo-badge";
import { idleState } from "@/lib/form-state";
import { INTEGRATION_STATUSES } from "@/lib/enums";
import { fmtDateTime, fmtDate } from "@/lib/dates";
import { saveSettings, importCsvAction, disconnectProvider, syncProvider, backfillProvider, clearDemoData } from "./actions";

interface IntegrationView {
  provider: "gsc" | "ga4" | "psi";
  status: string;
  propertyId: string | null;
  lastSyncAt: Date | string | null;
  lastError: string | null;
  configured: boolean;
  syncInProgress?: boolean;
  nextSyncAt?: string | null;
  lastSyncMessage?: string | null;
}
interface BatchRow {
  id: string;
  source: string;
  fileName: string | null;
  rowCount: number;
  skippedRows: number;
  status: string;
  isDemo: boolean;
  createdAt: Date | string;
}

const PROVIDER_LABEL: Record<string, string> = {
  gsc: "Google Search Console",
  ga4: "Google Analytics 4",
  psi: "PageSpeed Insights",
};

export function SettingsClient({
  settings,
  integrations,
  batches,
  demoCount,
  realCount,
}: {
  settings: {
    siteUrl: string; siteName: string; ownerName: string; ownerEmail: string;
    timezone: string; gscProperty: string; ga4Property: string;
  };
  integrations: IntegrationView[];
  batches: BatchRow[];
  demoCount: number;
  realCount: number;
}) {
  const [tab, setTab] = useState<"property" | "integrations" | "data">("property");
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();

  // Surface OAuth callback feedback.
  useEffect(() => {
    if (params.get("connected") === "google") {
      toast("Google account connected. Set your property ids below, then Sync.");
      router.replace("/settings");
      setTab("integrations");
    }
    const err = params.get("error");
    if (err) {
      toast(err, "error");
      router.replace("/settings");
      setTab("integrations");
    }
  }, [params, toast, router]);

  return (
    <div>
      <div className="mb-5">
        <Segmented
          options={[
            { value: "property", label: "Website Property", icon: <Globe className="h-4 w-4" /> },
            { value: "integrations", label: "Integrations", icon: <Plug className="h-4 w-4" /> },
            { value: "data", label: "Data & Imports", icon: <Database className="h-4 w-4" /> },
          ]}
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
        />
      </div>

      {tab === "property" && <PropertyForm settings={settings} />}
      {tab === "integrations" && <Integrations integrations={integrations} />}
      {tab === "data" && (
        <DataTab batches={batches} demoCount={demoCount} realCount={realCount} gscProperty={settings.gscProperty} ga4Property={settings.ga4Property} />
      )}
    </div>
  );
}

function PropertyForm({ settings }: { settings: SettingsClientProps["settings"] }) {
  const [state, action] = useActionState(saveSettings, idleState);
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") { toast(state.message ?? "Saved."); router.refresh(); }
    else if (state.status === "error" && state.message && !state.fieldErrors) toast(state.message, "error");
  }, [state, toast, router]);
  const err = (f: string) => state.fieldErrors?.[f];

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <div>
          <CardTitle>Website property & profile</CardTitle>
          <CardDescription>The site this workspace tracks, and how your name appears on reports.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Website name" required error={err("siteName")}>
              <Input name="siteName" defaultValue={settings.siteName} required />
            </Field>
            <Field label="Website URL" required error={err("siteUrl")}>
              <Input name="siteUrl" defaultValue={settings.siteUrl} required />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Your name" error={err("ownerName")}>
              <Input name="ownerName" defaultValue={settings.ownerName} placeholder="e.g. Atlas Web Team" />
            </Field>
            <Field label="Your email" error={err("ownerEmail")}>
              <Input name="ownerEmail" type="email" defaultValue={settings.ownerEmail} />
            </Field>
          </div>
          <Field label="Timezone" error={err("timezone")}>
            <Input name="timezone" defaultValue={settings.timezone} />
          </Field>
          <div className="border-t border-border pt-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-2">Integration properties</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Search Console property" hint="e.g. sc-domain:atlasuniversity.edu.in" error={err("gscProperty")}>
                <Input name="gscProperty" defaultValue={settings.gscProperty} placeholder="sc-domain:atlasuniversity.edu.in" />
              </Field>
              <Field label="GA4 property id" hint="Numeric id from GA4 Admin" error={err("ga4Property")}>
                <Input name="ga4Property" defaultValue={settings.ga4Property} placeholder="123456789" />
              </Field>
            </div>
          </div>
          <div className="flex justify-end border-t border-border pt-4">
            <SubmitButton>Save settings</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Integrations({ integrations }: { integrations: IntegrationView[] }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const onSync = (p: "gsc" | "ga4") =>
    start(async () => {
      const res = await syncProvider(p);
      toast(res.message ?? "", res.status === "success" ? "success" : "error");
      router.refresh();
    });
  const onBackfill = (p: "gsc" | "ga4") =>
    start(async () => {
      const res = await backfillProvider(p);
      toast(res.message ?? "", res.status === "success" ? "success" : "error");
      router.refresh();
    });
  const onDisconnect = (p: "gsc" | "ga4" | "psi") =>
    start(async () => { await disconnectProvider(p); toast("Disconnected."); router.refresh(); });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-info/30 bg-info-soft/50 px-4 py-3 text-sm text-foreground">
        Connect Google once to authorise both Search Console and Analytics. Secrets and tokens stay on the server.
        If you can&apos;t connect the API yet, use the CSV import under <strong>Data &amp; Imports</strong>.{" "}
        See <code className="rounded bg-surface-2 px-1">SETUP-INTEGRATIONS.md</code> for the full Google Cloud setup.
        <span className="mt-1 block text-xs text-muted">
          Automatic daily syncing runs via Windows Task Scheduler / cron — it does not start until you configure that
          schedule (see SETUP-INTEGRATIONS.md). The <strong>Sync 28d</strong> button below always works as a manual fallback.
        </span>
      </div>
      {integrations.map((i) => (
        <Card key={i.provider}>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{PROVIDER_LABEL[i.provider]}</h3>
                <StatusBadge options={INTEGRATION_STATUSES} value={i.status} dot />
                {!i.configured && <Badge tone="warning">Needs .env config</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted">
                {i.propertyId ? <>Property: <span className="font-mono">{i.propertyId}</span> · </> : null}
                {i.lastSyncAt ? `Last successful sync ${fmtDateTime(i.lastSyncAt)}` : "Never synced"}
                {i.syncInProgress && <span className="ml-1 text-info">· syncing…</span>}
              </p>
              {i.nextSyncAt && !i.syncInProgress && (
                <p className="mt-0.5 text-xs text-muted-2">
                  Next sync (expected, if the scheduler is running): {fmtDateTime(i.nextSyncAt)}
                </p>
              )}
              {i.lastSyncMessage && !i.lastError && (
                <p className="mt-0.5 text-xs text-muted-2">{i.lastSyncMessage}</p>
              )}
              {i.lastError && <p className="mt-1 text-xs text-danger">{i.lastError}</p>}
            </div>
            <div className="flex items-center gap-2">
              {i.provider === "psi" ? (
                <span className="text-xs text-muted-2">Used per-URL in Page Inspector</span>
              ) : i.status === "connected" ? (
                <>
                  <Button size="sm" variant="secondary" disabled={pending || i.syncInProgress} onClick={() => onSync(i.provider as "gsc" | "ga4")}>
                    <RefreshCw className="h-3.5 w-3.5" /> Sync 28d
                  </Button>
                  <Button size="sm" variant="secondary" disabled={pending || i.syncInProgress} onClick={() => onBackfill(i.provider as "gsc" | "ga4")} title="Pull ~16 months of history (one-time, slower)">
                    <RefreshCw className="h-3.5 w-3.5" /> Backfill 16mo
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDisconnect(i.provider)}>
                    <Unplug className="h-3.5 w-3.5" /> Disconnect
                  </Button>
                </>
              ) : (
                <a href="/api/integrations/google">
                  <Button size="sm" disabled={!i.configured}>
                    <Link2 className="h-3.5 w-3.5" /> Connect Google
                  </Button>
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DataTab({
  batches, demoCount, realCount, gscProperty, ga4Property,
}: {
  batches: BatchRow[]; demoCount: number; realCount: number; gscProperty: string; ga4Property: string;
}) {
  const [state, action] = useActionState(importCsvAction, idleState);
  const [source, setSource] = useState("gsc");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") { toast(state.message ?? "Imported."); router.refresh(); }
    else if (state.status === "error" && state.message) toast(state.message, "error");
  }, [state, toast, router]);

  const onClearDemo = () =>
    start(async () => {
      if (!confirm("Remove ALL seeded demo data? Real imported/entered data is kept. This cannot be undone.")) return;
      await clearDemoData();
      toast("Demo data removed.");
      router.refresh();
    });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Import CSV export</CardTitle>
            <CardDescription>
              Upload a Search Console or GA4 CSV. A <code>date</code> column creates daily rows; otherwise choose a period for page-level exports.
            </CardDescription>
          </div>
          <a href={source === "gsc" ? "/samples/search-console-sample.csv" : "/samples/ga4-sample.csv"} download>
            <Button variant="ghost" size="sm"><Download className="h-3.5 w-3.5" /> Sample CSV</Button>
          </a>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Data source" required>
                <Select name="source" value={source} onChange={(e) => setSource(e.target.value)}>
                  <Options options={[{ value: "gsc", label: "Search Console (clicks, impressions…)" }, { value: "ga4", label: "Analytics 4 (views, users…)" }]} />
                </Select>
              </Field>
              <Field label="Property id (optional)" hint="Labels the import source.">
                <Input name="propertyId" defaultValue={source === "gsc" ? gscProperty : ga4Property} placeholder="optional" />
              </Field>
            </div>
            <Field label="CSV file" required>
              <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-foreground hover:file:bg-accent-hover" />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Period start" hint="Only needed if the CSV has no date column.">
                <Input type="date" name="periodStart" />
              </Field>
              <Field label="Period end">
                <Input type="date" name="periodEnd" />
              </Field>
            </div>
            <div className="flex justify-end border-t border-border pt-4">
              <SubmitButton><Upload className="h-4 w-4" /> Import CSV</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Import history</CardTitle></CardHeader>
        <CardContent className="p-0">
          {batches.length === 0 ? (
            <div className="p-5"><EmptyState icon={Upload} title="No imports yet" description="Imported and synced batches will appear here." /></div>
          ) : (
            <Table>
              <THead>
                <tr><TH>When</TH><TH>Source</TH><TH>File</TH><TH>Rows</TH><TH>Status</TH></tr>
              </THead>
              <TBody>
                {batches.map((b) => (
                  <TR key={b.id}>
                    <TD className="text-muted">{fmtDate(b.createdAt)}</TD>
                    <TD className="uppercase">{b.source}{b.isDemo && <> <DemoBadge /></>}</TD>
                    <TD className="text-muted">{b.fileName ?? "—"}</TD>
                    <TD className="tabular-nums">{b.rowCount}{b.skippedRows > 0 && <span className="text-muted-2"> (+{b.skippedRows} skipped)</span>}</TD>
                    <TD><Badge tone={b.status === "completed" ? "success" : b.status === "partial" ? "warning" : "danger"}>{b.status}</Badge></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Demo data</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 text-muted"><FlaskConical className="h-4 w-4 text-warning" /> {demoCount} demo metric rows</span>
            <span className="inline-flex items-center gap-1.5 text-muted"><CheckCircle2 className="h-4 w-4 text-success" /> {realCount} real metric rows</span>
          </div>
          <Button variant="outline" size="sm" disabled={pending || demoCount === 0} onClick={onClearDemo}>
            Remove all demo data
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

type SettingsClientProps = Parameters<typeof SettingsClient>[0];
