import type { Metadata } from "next";
import Link from "next/link";
import { FileText, ChevronRight } from "lucide-react";
import { query } from "@/lib/db";
import type { Report } from "@/lib/models";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DemoBadge } from "@/components/ui/demo-badge";
import { ReportGenerator } from "./report-generator";
import type { ReportData } from "@/lib/report-data";
import { REPORT_STATUSES, REPORT_TYPES, labelOf } from "@/lib/enums";
import { fmtDate } from "@/lib/dates";

/**
 * A report "contains demo data" if the record itself is a seeded demo report,
 * or if the figures frozen into its snapshot at generation time came from demo
 * metrics. This is read from the already-stored snapshot — no recomputation.
 */
function reportContainsDemo(report: { isDemo: boolean; snapshot: unknown }): boolean {
  if (report.isDemo) return true;
  const snap = report.snapshot as ReportData | null;
  return Boolean(snap?.seo?.current?.isDemo) || Boolean(snap?.analytics?.current?.isDemo);
}

export const metadata: Metadata = { title: "Reports & History" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const sp = await searchParams;
  const reports = await query<Report>("SELECT * FROM `Report` ORDER BY `createdAt` DESC");

  return (
    <div>
      <PageHeader
        title="Reports & History"
        description="Generate management-ready weekly and monthly reports, with period comparison. Figures are captured as a snapshot when generated."
        actions={<ReportGenerator autoOpen={sp.new === "1"} />}
      />

      {reports.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No reports yet"
          description="Generate your first weekly report to compile your work and the website's performance for management."
        />
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <Link key={r.id} href={`/reports/${r.id}`} className="block">
              <Card interactive className="flex items-center gap-4 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-foreground">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
                    {reportContainsDemo(r) && <DemoBadge />}
                  </div>
                  <p className="text-xs text-muted-2">{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</p>
                </div>
                <Badge tone="neutral">{labelOf(REPORT_TYPES, r.type)}</Badge>
                <StatusBadge options={REPORT_STATUSES} value={r.status} />
                <ChevronRight className="h-4 w-4 text-muted-2" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
