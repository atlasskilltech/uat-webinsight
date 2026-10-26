import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { RECOMMENDATIONS, labelOf } from "@/lib/enums";
import { CompetitorsClient, type ResearchRow } from "./competitors-client";

export const metadata: Metadata = { title: "Competitor Intelligence" };
export const dynamic = "force-dynamic";

function SummaryChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-lg font-semibold leading-none tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const sp = await searchParams;
  const rows = await prisma.competitorResearch.findMany({
    orderBy: { researchDate: "desc" },
  });

  const entries: ResearchRow[] = rows.map((r) => ({
    id: r.id,
    organisation: r.organisation,
    website: r.website,
    researchDate: r.researchDate,
    sourceUrl: r.sourceUrl,
    observation: r.observation,
    category: r.category,
    isAssumption: r.isAssumption,
    evidence: r.evidence,
    relevance: r.relevance,
    effort: r.effort,
    expectedBenefit: r.expectedBenefit,
    measurement: r.measurement,
    recommendation: r.recommendation,
    status: r.status,
    followUpDate: r.followUpDate,
    isDemo: r.isDemo,
  }));

  const counts = RECOMMENDATIONS.map((rec) => ({
    label: labelOf(RECOMMENDATIONS, rec.value),
    value: entries.filter((e) => e.recommendation === rec.value).length,
  }));

  return (
    <div>
      <PageHeader
        title="Competitor Intelligence"
        description="Structured research into what other institutions do well — public observations, clearly separated from assumptions."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {counts.map((c) => (
          <SummaryChip key={c.label} label={c.label} value={c.value} />
        ))}
      </div>

      <CompetitorsClient entries={entries} initialNew={sp.new === "1"} />
    </div>
  );
}
