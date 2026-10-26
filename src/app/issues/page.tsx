import type { Metadata } from "next";
import { FlaskConical } from "lucide-react";
import { query } from "@/lib/db";
import type { TechnicalIssue } from "@/lib/models";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { ISSUE_STATUSES, SEVERITIES } from "@/lib/enums";
import { toStringArray } from "@/lib/utils";
import { issueScope, demoFilter } from "@/lib/data-scope";
import { IssuesClient, type IssueRow } from "./issues-client";

export const metadata: Metadata = { title: "Technical SEO Issues" };
export const dynamic = "force-dynamic";

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const sp = await searchParams;
  const issuesRaw = await query<TechnicalIssue>(
    "SELECT * FROM `TechnicalIssue` ORDER BY `createdAt` DESC",
  );

  const issues: IssueRow[] = issuesRaw.map((i) => {
    const urlList = toStringArray(i.urls);
    return {
      id: i.id,
      title: i.title,
      urlList,
      urls: urlList.join("\n"),
      category: i.category,
      severity: i.severity,
      priority: i.priority,
      status: i.status,
      approvalStatus: i.approvalStatus,
      owner: i.owner,
      evidence: i.evidence,
      source: i.source,
      impact: i.impact,
      recommendedFix: i.recommendedFix,
      implementationNotes: i.implementationNotes,
      verificationResult: i.verificationResult,
      dateDiscovered: i.dateDiscovered,
      dateResolved: i.dateResolved,
      isDemo: i.isDemo,
      createdAt: i.createdAt,
    };
  });

  // The register below lists every issue, but the status counts reflect only
  // the active data scope: real issues once any exist, otherwise the seeded
  // demo issues. This keeps the counts consistent with the dashboard and never
  // mixes demo and real together. The full `issues` list is still rendered.
  const issueSc = await issueScope();
  const scopedIssues = issues.filter((i) => i.isDemo === demoFilter(issueSc));

  const statusCounts = ISSUE_STATUSES.map((s) => ({
    ...s,
    count: scopedIssues.filter((i) => i.status === s.value).length,
  }));
  const openCritical = scopedIssues.filter(
    (i) => i.severity === "critical" && !["verified", "wont_fix"].includes(i.status),
  ).length;
  const demoIssueCount = issues.filter((i) => i.isDemo).length;
  const realIssueCount = issues.length - demoIssueCount;

  return (
    <div>
      <PageHeader
        title="Technical SEO Issues"
        description="A register of technical issues found while auditing pages. Every entry is a recommendation to review and approve — the dashboard never edits the production website."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {statusCounts.map((s) => (
          <div
            key={s.value}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
          >
            <StatusBadge options={ISSUE_STATUSES} value={s.value} />
            <span className="text-sm font-semibold tabular-nums">{s.count}</span>
          </div>
        ))}
        {openCritical > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
            <StatusBadge options={SEVERITIES} value="critical" dot />
            <span className="text-sm font-semibold tabular-nums text-danger">
              {openCritical} unresolved
            </span>
          </div>
        )}
      </div>

      {issueSc === "real" && demoIssueCount > 0 && (
        <p className="-mt-3 mb-6 flex items-center gap-1.5 text-xs text-muted-2">
          <FlaskConical className="h-3.5 w-3.5 text-warning" />
          Status counts reflect your {realIssueCount} real issue{realIssueCount === 1 ? "" : "s"} only. The register below also includes {demoIssueCount} seeded demo issue{demoIssueCount === 1 ? "" : "s"} (tagged “Demo data”), which are excluded from these counts.
        </p>
      )}
      {issueSc === "demo" && (
        <p className="-mt-3 mb-6 flex items-center gap-1.5 text-xs text-muted-2">
          <FlaskConical className="h-3.5 w-3.5 text-warning" />
          Status counts reflect {demoIssueCount} seeded demo issue{demoIssueCount === 1 ? "" : "s"} — no real issues yet. Record an issue, or remove demo data in Settings.
        </p>
      )}

      <IssuesClient issues={issues} initialNew={sp.new === "1"} />
    </div>
  );
}
