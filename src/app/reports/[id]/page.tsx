import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { queryOne } from "@/lib/db";
import type { Report } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { ReportToolbar } from "./report-toolbar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buildReportData, type ReportData } from "@/lib/report-data";
import { SEVERITIES, labelOf, TASK_CATEGORIES } from "@/lib/enums";
import { fmtDate } from "@/lib/dates";
import { formatNumber, formatPercent, formatPosition } from "@/lib/utils";

export const metadata: Metadata = { title: "Report" };
export const dynamic = "force-dynamic";

function Delta({ d }: { d: { label: string; direction: string } }) {
  if (d.direction === "na") return <span className="text-muted-2">—</span>;
  const tone = d.direction === "up" ? "text-success" : d.direction === "down" ? "text-danger" : "text-muted";
  return <span className={tone}>{d.label}</span>;
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7 break-inside-avoid">
      <h2 className="mb-2 flex items-center gap-2 border-b border-border pb-1.5 text-sm font-semibold text-foreground">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-accent-soft text-[11px] font-bold text-accent-soft-foreground">{n}</span>
        {title}
      </h2>
      <div className="text-sm text-foreground">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-2">{children}</p>;
}

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [report, settings] = await Promise.all([
    queryOne<Report>("SELECT * FROM `Report` WHERE `id`=?", [id]),
    getSettings(),
  ]);
  if (!report) notFound();
  // Older/seeded reports may not have a stored snapshot — build it on demand.
  const data = (report.snapshot as unknown as ReportData | null) ??
    (await buildReportData({ start: report.periodStart, end: report.periodEnd }));
  const { seo, analytics, work } = data;

  return (
    <div className="print-container">
      <Link href="/reports" className="no-print mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Reports
      </Link>

      <ReportToolbar id={report.id} title={report.title} status={report.status} executiveSummary={report.executiveSummary ?? ""} snapshot={data} />

      <article className="mx-auto max-w-3xl rounded-xl border border-border bg-surface p-8 print:border-0 print:p-0">
        {/* Masthead */}
        <header className="mb-6 border-b border-border pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-accent">{settings.siteName} · {report.type === "weekly" ? "Weekly" : report.type === "monthly" ? "Monthly" : "Custom"} report</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{report.title}</h1>
              <p className="mt-1 text-sm text-muted">
                {fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)}
                {report.comparePeriodStart && <> · compared with {fmtDate(report.comparePeriodStart)} – {fmtDate(report.comparePeriodEnd)}</>}
              </p>
            </div>
            <StatusBadge options={[{ value: "draft", label: "Draft", tone: "warning" }, { value: "final", label: "Final", tone: "success" }]} value={report.status} />
          </div>
          {settings.ownerName && <p className="mt-2 text-xs text-muted-2">Prepared by {settings.ownerName}</p>}
        </header>

        {/* 1. Executive summary */}
        <Section n={1} title="Executive summary">
          {report.executiveSummary ? (
            <p className="whitespace-pre-wrap leading-relaxed">{report.executiveSummary}</p>
          ) : (
            <Empty>No executive summary yet — use “Edit summary” to add one.</Empty>
          )}
        </Section>

        {/* 2. Work completed */}
        <Section n={2} title="Work completed">
          {work.completed.length === 0 ? <Empty>No tasks were completed in this period.</Empty> : (
            <ul className="space-y-2">
              {work.completed.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                  <span><strong>{t.title}</strong> <Badge tone="neutral" className="ml-1">{labelOf(TASK_CATEGORIES, t.category)}</Badge>{t.completionSummary && <span className="block text-muted">{t.completionSummary}</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 3. In progress & blocked */}
        <Section n={3} title="In progress & blocked">
          <p className="mb-2 text-muted">{work.counts.inProgress} in progress · {work.counts.blocked} blocked · {work.counts.overdue} overdue</p>
          {work.inProgress.length > 0 && (
            <ul className="mb-2 space-y-1">
              {work.inProgress.slice(0, 8).map((t, i) => (
                <li key={i}>• {t.title} <span className="text-muted-2">({t.progress}%{t.nextAction ? ` — next: ${t.nextAction}` : ""})</span></li>
              ))}
            </ul>
          )}
          {work.blocked.map((t, i) => (
            <p key={i} className="text-danger">⚠ Blocked: {t.title}{t.blocker ? ` — ${t.blocker}` : ""}</p>
          ))}
          {work.inProgress.length === 0 && work.blocked.length === 0 && <Empty>Nothing in progress or blocked.</Empty>}
        </Section>

        {/* 4. Website performance */}
        <Section n={4} title="Website performance">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
            {seo.current.hasData ? (
              <>
                <Metric label="Clicks" value={formatNumber(seo.current.clicks)} delta={<Delta d={seo.delta.clicks} />} />
                <Metric label="Impressions" value={formatNumber(seo.current.impressions)} delta={<Delta d={seo.delta.impressions} />} />
                <Metric label="CTR" value={formatPercent(seo.current.ctr)} delta={<Delta d={seo.delta.ctr} />} />
                <Metric label="Avg position" value={formatPosition(seo.current.position)} delta={<Delta d={seo.delta.position} />} />
              </>
            ) : <Empty>No Search Console data for this period.</Empty>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
            {analytics.current.hasData ? (
              <>
                <Metric label="Views" value={formatNumber(analytics.current.views)} delta={<Delta d={analytics.delta.views} />} />
                <Metric label="Active users" value={formatNumber(analytics.current.activeUsers)} delta={<Delta d={analytics.delta.activeUsers} />} />
                <Metric label="Sessions" value={formatNumber(analytics.current.sessions)} delta={<Delta d={analytics.delta.sessions} />} />
                <Metric label="Engagement" value={formatPercent(analytics.current.engagementRate)} delta={<Delta d={analytics.delta.engagementRate} />} />
              </>
            ) : <Empty>No Analytics data for this period.</Empty>}
          </div>
          {(seo.current.isDemo || analytics.current.isDemo) && <p className="mt-2 text-xs text-warning">Figures include demo data — not real Atlas metrics.</p>}
        </Section>

        {/* 5. Pages requiring attention + 6 */}
        <Section n={5} title="Top pages & pages requiring attention">
          {data.topPages.length > 0 ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-muted-2"><th className="py-1">Page</th><th className="py-1 text-right">Clicks</th><th className="py-1 text-right">CTR</th></tr></thead>
              <tbody>
                {data.topPages.map((p, i) => (
                  <tr key={i} className="border-t border-border"><td className="py-1">{p.title}</td><td className="py-1 text-right tabular-nums">{formatNumber(p.clicks)}</td><td className="py-1 text-right tabular-nums">{formatPercent(p.ctr)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>No page-level data.</Empty>}
        </Section>

        {/* 6. SEO issues */}
        <Section n={6} title="SEO issues discovered & fixes verified">
          {data.issues.discovered.length > 0 ? (
            <ul className="mb-2 space-y-1">
              {data.issues.discovered.map((i, k) => (
                <li key={k} className="flex items-center gap-2"><StatusBadge options={SEVERITIES} value={i.severity} /> {i.title}</li>
              ))}
            </ul>
          ) : <Empty>No new issues discovered in this period.</Empty>}
          {data.issues.verifiedFixes.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium uppercase text-muted-2">Verified fixes</p>
              {data.issues.verifiedFixes.map((i, k) => <p key={k} className="text-success">✓ {i.title}{i.verificationResult ? ` — ${i.verificationResult}` : ""}</p>)}
            </div>
          )}
        </Section>

        {/* 7. Backend & server */}
        <Section n={7} title="Backend & server activities">
          {data.operations.length > 0 ? (
            <ul className="space-y-1">
              {data.operations.map((o, i) => <li key={i}>• <span className="text-muted-2">{o.occurredAt}</span> — <strong>{o.system}</strong>: {o.title} <span className="text-muted-2">({o.status})</span></li>)}
            </ul>
          ) : <Empty>No logged operations in this period.</Empty>}
        </Section>

        {/* 8. Competitor findings */}
        <Section n={8} title="Competitor findings">
          {data.competitors.length > 0 ? (
            <ul className="space-y-1">
              {data.competitors.map((c, i) => <li key={i}>• <strong>{c.organisation}</strong>: {c.observation} <Badge tone="info" className="ml-1">{c.recommendation}</Badge></li>)}
            </ul>
          ) : <Empty>No competitor research logged in this period.</Empty>}
        </Section>

        {/* 9. Recommendations / risks / next week */}
        <Section n={9} title="Recommendations, risks & next-week priorities">
          <div className="space-y-2">
            {data.issues.openPriority.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase text-muted-2">Open priority issues / approvals needed</p>
                {data.issues.openPriority.map((i, k) => (
                  <p key={k}>• {i.title} <span className="text-muted-2">({i.severity}{i.approvalStatus === "pending" ? ", awaiting approval" : ""})</span></p>
                ))}
              </div>
            )}
            {data.work.inProgress.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase text-muted-2">Priorities for next period</p>
                {data.work.inProgress.slice(0, 5).map((t, k) => <p key={k}>• {t.nextAction || t.title}</p>)}
              </div>
            )}
            {data.issues.openPriority.length === 0 && data.work.inProgress.length === 0 && <Empty>No outstanding priorities recorded.</Empty>}
          </div>
        </Section>

        <footer className="mt-8 border-t border-border pt-3 text-xs text-muted-2">
          Generated by Atlas Web Insight. Figures reflect data captured at generation time. Where results are shown, they are actual stored/imported figures; proposed work and estimates are labelled as such.
        </footer>
      </article>
    </div>
  );
}

function Metric({ label, value, delta }: { label: string; value: string; delta: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-2">{label}</p>
      <p className="text-base font-semibold tabular-nums text-foreground">{value} <span className="text-xs font-normal">{delta}</span></p>
    </div>
  );
}
