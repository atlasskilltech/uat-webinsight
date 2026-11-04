"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Search } from "lucide-react";
import { formatNumber, formatPercent, formatPosition, truncate } from "@/lib/utils";

export interface BreakdownRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
export interface PageBreakdownRow {
  page?: { title?: string | null; path?: string | null };
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

type Tab = "queries" | "pages" | "countries" | "devices";

function deviceLabel(k: string): string {
  const s = (k || "").toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unknown";
}

/**
 * Search Console-style performance breakdown, mirroring the tabs under the GSC
 * Performance chart: Queries, Pages, Countries, Devices. All respect the
 * selected date range.
 */
export function SeoBreakdowns({
  queries,
  pages,
  countries,
  devices,
}: {
  queries: BreakdownRow[];
  pages: PageBreakdownRow[];
  countries: BreakdownRow[];
  devices: BreakdownRow[];
}) {
  const [tab, setTab] = useState<Tab>("queries");

  const tabs = [
    { value: "queries", label: `Queries (${queries.length})` },
    { value: "pages", label: `Pages (${pages.length})` },
    { value: "countries", label: `Countries (${countries.length})` },
    { value: "devices", label: `Devices (${devices.length})` },
  ];

  const metricHead = (
    <tr>
      <TH>{tab === "queries" ? "Query" : tab === "pages" ? "Page" : tab === "countries" ? "Country" : "Device"}</TH>
      <TH className="text-right">Clicks</TH>
      <TH className="text-right">Impressions</TH>
      <TH className="text-right">CTR</TH>
      <TH className="text-right">Position</TH>
    </tr>
  );

  const metricRow = (label: React.ReactNode, r: BreakdownRow | PageBreakdownRow, i: number) => (
    <TR key={i}>
      <TD className="max-w-md">{label}</TD>
      <TD className="text-right tabular-nums">{formatNumber(r.clicks)}</TD>
      <TD className="text-right tabular-nums text-muted">{formatNumber(r.impressions)}</TD>
      <TD className="text-right tabular-nums text-muted">{formatPercent(r.ctr)}</TD>
      <TD className="text-right tabular-nums text-muted">{formatPosition(r.position)}</TD>
    </TR>
  );

  const current =
    tab === "queries" ? queries : tab === "countries" ? countries : tab === "devices" ? devices : pages;
  const isEmpty = current.length === 0;

  return (
    <Card className="mt-3 overflow-hidden">
      <div className="border-b border-border p-3">
        <Segmented options={tabs} value={tab} onChange={(v) => setTab(v as Tab)} />
      </div>
      {isEmpty ? (
        <div className="p-2">
          <EmptyState
            icon={Search}
            title={`No ${tab} data`}
            description="Breakdown rows appear after a sync pulls this dimension from Search Console for the selected period."
          />
        </div>
      ) : (
        <Table>
          <THead>{metricHead}</THead>
          <TBody>
            {tab === "pages"
              ? pages.map((p, i) =>
                  metricRow(
                    <>
                      <span className="font-medium">{p.page?.title ?? "Unknown page"}</span>
                      <span className="block truncate text-xs text-muted-2">{truncate(p.page?.path ?? "", 60)}</span>
                    </>,
                    p,
                    i,
                  ),
                )
              : current.map((r, i) =>
                  metricRow(
                    <span className="truncate font-medium">
                      {tab === "devices" ? deviceLabel((r as BreakdownRow).key) : (r as BreakdownRow).key || "(not set)"}
                    </span>,
                    r,
                    i,
                  ),
                )}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
