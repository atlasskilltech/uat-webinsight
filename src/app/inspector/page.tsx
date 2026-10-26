import type { Metadata } from "next";
import Link from "next/link";
import { SearchCheck, ChevronRight, FileSearch } from "lucide-react";
import { query } from "@/lib/db";
import type { PageAudit } from "@/lib/models";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineNote } from "@/components/data-status";
import { InspectorForm } from "./inspector-form";
import { fmtRelative } from "@/lib/dates";
import { truncate } from "@/lib/utils";

export const metadata: Metadata = { title: "Page Inspector" };
export const dynamic = "force-dynamic";

export default async function InspectorPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const { url } = await searchParams;
  const auditRows = await query<PageAudit>(
    "SELECT * FROM `PageAudit` ORDER BY `createdAt` DESC LIMIT ?",
    [30],
  );
  const auditIds = auditRows.map((a) => a.id);
  const countRows = auditIds.length
    ? await query<{ auditId: string; c: number }>(
        "SELECT `auditId`, COUNT(*) AS c FROM `AuditFinding` WHERE `auditId` IN (?) GROUP BY `auditId`",
        [auditIds],
      )
    : [];
  const countMap = new Map(countRows.map((r) => [r.auditId, Number(r.c)]));
  const audits = auditRows.map((a) => ({ ...a, _count: { findings: countMap.get(a.id) ?? 0 } }));

  return (
    <div>
      <PageHeader
        title="Page Inspector"
        description="Audit an individual URL: on-page SEO, technical signals, Core Web Vitals and a rules-based diagnosis."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Run a new audit</CardTitle></CardHeader>
            <CardContent>
              <InspectorForm defaultUrl={url} />
              <div className="mt-4">
                <InlineNote>
                  The inspector fetches the public page and known metrics. A page returning HTTP 200 is <strong>not</strong> proof it is indexed, and public crawling can&apos;t measure real visitor counts — those come from your connected GA4 / Search Console data.
                </InlineNote>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="bg-surface-2">
            <CardHeader><CardTitle>How it works</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-muted">
              <p><strong className="text-foreground">1.</strong> Fetches and parses the page HTML.</p>
              <p><strong className="text-foreground">2.</strong> Pulls search & visitor metrics if the URL is a known page.</p>
              <p><strong className="text-foreground">3.</strong> Optionally runs PageSpeed Insights.</p>
              <p><strong className="text-foreground">4.</strong> Runs the diagnostic engine, separating <em>confirmed</em> issues from <em>hypotheses</em>.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Recent audits</h2>
        {audits.length === 0 ? (
          <EmptyState icon={FileSearch} title="No audits yet" description="Run your first audit above to create a structured record." />
        ) : (
          <div className="space-y-2">
            {audits.map((a) => (
              <Link key={a.id} href={`/inspector/${a.id}`}>
                <Card interactive className="flex items-center gap-4 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-foreground">
                    <SearchCheck className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{a.title ?? truncate(a.url, 70)}</p>
                    <p className="truncate text-xs text-muted-2">{truncate(a.url, 80)}</p>
                  </div>
                  <div className="hidden items-center gap-2 sm:flex">
                    {a.httpStatus && <Badge tone={a.httpStatus < 300 ? "success" : a.httpStatus < 400 ? "warning" : "danger"}>HTTP {a.httpStatus}</Badge>}
                    <Badge tone={a._count.findings > 0 ? "info" : "neutral"}>{a._count.findings} finding{a._count.findings === 1 ? "" : "s"}</Badge>
                  </div>
                  <span className="hidden text-xs text-muted-2 md:block">{fmtRelative(a.createdAt)}</span>
                  <ChevronRight className="h-4 w-4 text-muted-2" />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
