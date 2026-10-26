import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ExternalLink, ArrowLeft, MousePointerClick, Eye, Percent, TrendingUp,
  Users, Activity, CheckCircle2, FlaskConical, AlertTriangle,
} from "lucide-react";
import { queryOne, query } from "@/lib/db";
import type { PageAudit, AuditFinding } from "@/lib/models";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DeleteAuditButton, PromoteFindingButton } from "./audit-client";
import { getSeoWithComparison, getAnalyticsWithComparison } from "@/lib/metrics";
import { lastNDays } from "@/lib/dates";
import { formatNumber, formatPercent, formatPosition, truncate, toStringArray } from "@/lib/utils";
import { CONFIDENCE_LEVELS, PRIORITIES, FINDING_STATUSES, labelOf, toneOf } from "@/lib/enums";
import { explain } from "@/lib/glossary";
import { fmtDateTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Audit detail" };
export const dynamic = "force-dynamic";

function KV({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span className="text-sm text-muted" title={hint}>{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{children}</span>
    </div>
  );
}

export default async function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auditRow = await queryOne<PageAudit>("SELECT * FROM `PageAudit` WHERE `id`=?", [id]);
  if (!auditRow) notFound();
  const findings = await query<AuditFinding>(
    "SELECT * FROM `AuditFinding` WHERE `auditId`=? ORDER BY `isHypothesis` ASC, `priority` ASC",
    [id],
  );
  const audit = { ...auditRow, findings };

  const range = lastNDays(28);
  const [seo, ga] = audit.pageId
    ? await Promise.all([
        getSeoWithComparison(range, { pageId: audit.pageId }),
        getAnalyticsWithComparison(range, { pageId: audit.pageId }),
      ])
    : [null, null];

  const headings = (audit.headingStructure as { level: number; text: string }[] | null) ?? [];
  const structured = toStringArray(audit.structuredData);
  const confirmed = audit.findings.filter((f) => !f.isHypothesis);
  const hypotheses = audit.findings.filter((f) => f.isHypothesis);

  return (
    <div>
      <Link href="/inspector" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Page Inspector
      </Link>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{audit.title ?? truncate(audit.url, 80)}</h1>
          <a href={audit.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 break-all text-sm text-accent hover:underline">
            {truncate(audit.url, 90)} <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          <p className="mt-1 text-xs text-muted-2">Audited {fmtDateTime(audit.createdAt)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={`/inspector?url=${encodeURIComponent(audit.url)}`}><Button variant="secondary" size="sm">Re-audit</Button></Link>
          <DeleteAuditButton id={audit.id} />
        </div>
      </div>

      {audit.notes && (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft/60 px-4 py-3 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{audit.notes}</span>
        </div>
      )}

      {/* A + B: metrics */}
      {audit.pageId && seo?.current.hasData && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Search performance <span className="font-normal text-muted-2">· last 28 days</span></h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Clicks" value={formatNumber(seo.current.clicks)} icon={MousePointerClick} hint={explain("clicks")} delta={seo.delta.clicks} />
            <StatCard label="Impressions" value={formatNumber(seo.current.impressions)} icon={Eye} hint={explain("impressions")} delta={seo.delta.impressions} />
            <StatCard label="CTR" value={formatPercent(seo.current.ctr)} icon={Percent} hint={explain("ctr")} delta={seo.delta.ctr} />
            <StatCard label="Avg. position" value={formatPosition(seo.current.position)} icon={TrendingUp} hint={explain("position")} delta={seo.delta.position} deltaGoodWhenUp={false} />
          </div>
        </section>
      )}
      {audit.pageId && ga?.current.hasData && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Visitor analytics <span className="font-normal text-muted-2">· last 28 days</span></h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Views" value={formatNumber(ga.current.views)} icon={Eye} hint={explain("views")} delta={ga.delta.views} />
            <StatCard label="Active users" value={formatNumber(ga.current.activeUsers)} icon={Users} hint={explain("activeUsers")} delta={ga.delta.activeUsers} />
            <StatCard label="Sessions" value={formatNumber(ga.current.sessions)} icon={Activity} hint={explain("sessions")} delta={ga.delta.sessions} />
            <StatCard label="Engagement" value={formatPercent(ga.current.engagementRate)} icon={Percent} hint={explain("engagementRate")} delta={ga.delta.engagementRate} />
          </div>
        </section>
      )}
      {!audit.pageId && (
        <div className="mb-6 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
          This URL isn&apos;t in your tracked page list, so no search/visitor metrics are attached. Add it under the website pages to link metrics.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* C: technical */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Technical & on-page SEO</CardTitle></CardHeader>
            <CardContent className="py-1">
              <KV label="HTTP status">{audit.httpStatus ?? "—"}</KV>
              <KV label="Indexable" hint={explain("indexing")}>
                <Badge tone={audit.indexable === "indexable" ? "success" : audit.indexable === "blocked" ? "danger" : "neutral"}>{audit.indexable ?? "unknown"}</Badge>
              </KV>
              <KV label="Robots" hint={explain("robots")}>{audit.robots ?? "—"}</KV>
              <KV label="Canonical" hint={explain("canonical")}>{audit.canonical ? truncate(audit.canonical, 36) : "—"}</KV>
              <KV label="Title length">{audit.title ? `${audit.titleLength} chars` : "Missing"}</KV>
              <KV label="Meta description">{audit.metaDescLength ? `${audit.metaDescLength} chars` : "Missing"}</KV>
              <KV label="H1">{audit.h1 ? truncate(audit.h1, 30) : "Missing"}</KV>
              <KV label="Headings">{headings.length}</KV>
              <KV label="Images missing alt">{audit.imagesMissingAlt ?? "—"} / {audit.imagesTotal ?? "—"}</KV>
              <KV label="Internal links">{audit.internalLinks ?? "—"}</KV>
              <KV label="External links">{audit.externalLinks ?? "—"}</KV>
              <KV label="Word count">{audit.wordCount ?? "—"}</KV>
              <KV label="Structured data" hint={explain("structuredData")}>{structured.length ? structured.join(", ") : "None"}</KV>
            </CardContent>
          </Card>

          {(audit.psiFetched) && (
            <Card className="mt-4">
              <CardHeader><CardTitle>PageSpeed & Core Web Vitals</CardTitle></CardHeader>
              <CardContent className="py-1">
                <KV label="Performance score">{audit.performanceScore ?? "—"}/100</KV>
                <KV label="Accessibility score">{audit.accessibilityScore ?? "—"}/100</KV>
                <KV label="SEO score">{audit.seoScore ?? "—"}/100</KV>
                <KV label="LCP" hint={explain("lcp")}>{audit.lcp != null ? `${audit.lcp.toFixed(1)}s` : "—"}</KV>
                <KV label="CLS" hint={explain("cls")}>{audit.cls != null ? audit.cls.toFixed(2) : "—"}</KV>
                <KV label="INP" hint={explain("inp")}>{audit.inp != null ? `${Math.round(audit.inp)}ms` : "—"}</KV>
              </CardContent>
            </Card>
          )}
        </div>

        {/* D: findings */}
        <div className="lg:col-span-3">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" /> Confirmed findings ({confirmed.length})
          </h2>
          {confirmed.length === 0 ? (
            <EmptyState title="No confirmed issues detected" description="The on-page checks didn't surface confirmed problems." />
          ) : (
            <div className="space-y-3">{confirmed.map((f) => <FindingCard key={f.id} f={f} />)}</div>
          )}

          <h2 className="mb-3 mt-6 flex items-center gap-2 text-sm font-semibold text-foreground">
            <FlaskConical className="h-4 w-4 text-warning" /> Hypotheses to investigate ({hypotheses.length})
          </h2>
          <p className="mb-3 text-xs text-muted">These are inferred from traffic patterns and are <strong>not</strong> confirmed defects — investigate before acting.</p>
          {hypotheses.length === 0 ? (
            <EmptyState title="No hypotheses" description="Nothing in the traffic data suggested an issue to investigate." />
          ) : (
            <div className="space-y-3">{hypotheses.map((f) => <FindingCard key={f.id} f={f} />)}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function FindingCard({ f }: { f: {
  id: string; detected: string; evidence: string | null; why: string | null; confidence: string;
  recommendation: string | null; priority: string; owner: string | null; status: string; verificationSteps: string | null;
} }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{f.detected}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge options={PRIORITIES} value={f.priority} dot />
          <Badge tone={toneOf(CONFIDENCE_LEVELS, f.confidence)}>{labelOf(CONFIDENCE_LEVELS, f.confidence)}</Badge>
          <StatusBadge options={FINDING_STATUSES} value={f.status} />
        </div>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        {f.evidence && <Row label="Evidence">{f.evidence}</Row>}
        {f.why && <Row label="Why it matters">{f.why}</Row>}
        {f.recommendation && <Row label="Recommendation">{f.recommendation}</Row>}
        {f.verificationSteps && <Row label="How to verify">{f.verificationSteps}</Row>}
        {f.owner && <Row label="Suggested owner">{f.owner}</Row>}
      </dl>
      <div className="mt-3 flex justify-end border-t border-border pt-3">
        <PromoteFindingButton findingId={f.id} />
      </div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-2">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}
