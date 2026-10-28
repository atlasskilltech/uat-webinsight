import type { Metadata } from "next";
import { MousePointerClick, Eye, Percent, TrendingUp, Users, Activity, LayoutList } from "lucide-react";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataStatusBanner, InlineNote } from "@/components/data-status";
import { DateRangePicker } from "@/components/date-range-picker";
import { SearchTrend, VisitorTrend } from "./seo-charts";
import {
  getSeoWithComparison,
  getAnalyticsWithComparison,
  getTrend,
  getTopPages,
  getLatestDataDate,
} from "@/lib/metrics";
import { getIntegrations } from "@/lib/integrations";
import { resolveSeoRange, resolveSeoCompare, rangeLabel, compareLabel, utcDayWindow } from "@/lib/dates";
import { formatNumber, formatPercent, formatPosition, truncate } from "@/lib/utils";
import { explain } from "@/lib/glossary";

export const metadata: Metadata = { title: "SEO & Website Analytics" };
export const dynamic = "force-dynamic";

export default async function SeoPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; start?: string; end?: string; cmp?: string; cmpStart?: string; cmpEnd?: string }>;
}) {
  const sp = await searchParams;
  const resolved = resolveSeoRange(sp);
  let range = resolved.range;
  const invalid = resolved.invalid;
  // "Latest day" (24h key): snap to the most recent day that actually has data,
  // since daily GSC/GA4 data lags ~2-3 days so the literal last day is usually empty.
  if (sp.range === "24h") {
    const latest = await getLatestDataDate();
    if (latest) range = utcDayWindow(latest);
  }
  const { compareRange, mode: cmpMode } = resolveSeoCompare(sp, range);

  const [seo, ga, trend, topPages, integrations] = await Promise.all([
    getSeoWithComparison(range, { compareRange }),
    getAnalyticsWithComparison(range, { compareRange }),
    getTrend(range),
    getTopPages(range),
    getIntegrations(),
  ]);

  const gsc = integrations.find((i) => i.provider === "gsc");
  const ga4 = integrations.find((i) => i.provider === "ga4");
  const hasData = seo.current.hasData || ga.current.hasData;
  const isDemo = seo.current.isDemo || ga.current.isDemo;

  return (
    <div>
      <PageHeader
        title="SEO & Website Analytics"
        description={`Search and visitor performance for the website. Comparing ${rangeLabel(range)} with ${compareLabel(cmpMode)} (${rangeLabel(compareRange)}).`}
        actions={<DateRangePicker />}
      />

      <DataStatusBanner isDemo={isDemo} hasData={hasData} />

      {invalid && (
        <div className="mb-5 rounded-lg border border-warning/30 bg-warning-soft/60 px-4 py-3 text-sm text-foreground">
          The custom date range was invalid (the end date was before the start date), so the default range is shown. Pick a valid range to try again.
        </div>
      )}

      {/* ---- Search Console ---- */}
      <SectionTitle
        title="Search performance — Google Search Console"
        description="How the website performs in Google Search results."
        action={<Badge tone={gsc?.status === "connected" ? "success" : "neutral"} dot>{gsc?.status === "connected" ? "Connected" : "Not connected"}</Badge>}
      />
      {seo.current.hasData ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Search clicks" value={formatNumber(seo.current.clicks)} icon={MousePointerClick} hint={explain("clicks")} delta={seo.delta.clicks} />
            <StatCard label="Impressions" value={formatNumber(seo.current.impressions)} icon={Eye} hint={explain("impressions")} delta={seo.delta.impressions} />
            <StatCard label="Average CTR" value={formatPercent(seo.current.ctr)} icon={Percent} hint={explain("ctr")} delta={seo.delta.ctr} />
            <StatCard label="Average position" value={formatPosition(seo.current.position)} icon={TrendingUp} hint={explain("position")} delta={seo.delta.position} deltaGoodWhenUp={false} />
          </div>
          <Card className="mt-3">
            <CardHeader><CardTitle>Clicks & impressions trend</CardTitle></CardHeader>
            <CardContent><SearchTrend data={trend} /></CardContent>
          </Card>
        </>
      ) : (
        <EmptyState icon={TrendingUp} title="No Search Console data" description="Connect Search Console or import a GSC CSV to see search performance." />
      )}

      {/* ---- Analytics ---- */}
      <div className="mt-8">
        <SectionTitle
          title="Visitor analytics — Google Analytics 4"
          description="What visitors do once they are on the site. Measured separately from Search."
          action={<Badge tone={ga4?.status === "connected" ? "success" : "neutral"} dot>{ga4?.status === "connected" ? "Connected" : "Not connected"}</Badge>}
        />
        {ga.current.hasData ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Views" value={formatNumber(ga.current.views)} icon={Eye} hint={explain("views")} delta={ga.delta.views} />
              <StatCard label="Active users" value={formatNumber(ga.current.activeUsers)} icon={Users} hint={explain("activeUsers")} delta={ga.delta.activeUsers} />
              <StatCard label="Sessions" value={formatNumber(ga.current.sessions)} icon={Activity} hint={explain("sessions")} delta={ga.delta.sessions} />
              <StatCard label="Engagement rate" value={formatPercent(ga.current.engagementRate)} icon={Percent} hint={explain("engagementRate")} delta={ga.delta.engagementRate} />
            </div>
            <Card className="mt-3">
              <CardHeader><CardTitle>Views & active users trend</CardTitle></CardHeader>
              <CardContent><VisitorTrend data={trend} /></CardContent>
            </Card>
          </>
        ) : (
          <EmptyState icon={Users} title="No Analytics data" description="Connect GA4 or import a GA4 CSV to see visitor analytics." />
        )}
      </div>

      {/* ---- Top pages ---- */}
      <div className="mt-8">
        <SectionTitle title="Top landing pages by search clicks" description="Pages receiving the most organic search clicks in this period." />
        <Card>
          {topPages.length === 0 ? (
            <CardContent><EmptyState icon={LayoutList} title="No page-level data" description="Page-level rows appear when per-page data is imported or synced." /></CardContent>
          ) : (
            <Table>
              <THead>
                <tr><TH>Page</TH><TH className="text-right">Clicks</TH><TH className="text-right">Impressions</TH><TH className="text-right">CTR</TH></tr>
              </THead>
              <TBody>
                {topPages.map((p, i) => (
                  <TR key={i}>
                    <TD className="max-w-md">
                      <span className="font-medium">{p.page?.title ?? "Unknown page"}</span>
                      <span className="block truncate text-xs text-muted-2">{truncate(p.page?.path, 60)}</span>
                    </TD>
                    <TD className="text-right tabular-nums">{formatNumber(p.clicks)}</TD>
                    <TD className="text-right tabular-nums text-muted">{formatNumber(p.impressions)}</TD>
                    <TD className="text-right tabular-nums text-muted">{formatPercent(p.ctr)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <div className="mt-3">
          <InlineNote>
            Search Console and Analytics measure different things and are shown separately. Search clicks come from Google results; views and users describe on-site behaviour. They will not match exactly.
          </InlineNote>
        </div>
      </div>
    </div>
  );
}
