"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { formatNumber, formatPercent, formatPosition, truncate } from "@/lib/utils";
import { countryName } from "@/lib/countries";

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
const PAGE_SIZES = [10, 25, 50, 100];

function deviceLabel(k: string): string {
  const s = (k || "").toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unknown";
}

/**
 * Search Console-style performance breakdown, mirroring the tabs under the GSC
 * Performance chart: Queries, Pages, Countries, Devices. All respect the
 * selected date range and paginate through every row (10/25/50/100 per page).
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const changeTab = (t: Tab) => {
    setTab(t);
    setPage(1);
  };

  const tabs = [
    { value: "queries", label: `Queries (${queries.length})` },
    { value: "pages", label: `Pages (${pages.length})` },
    { value: "countries", label: `Countries (${countries.length})` },
    { value: "devices", label: `Devices (${devices.length})` },
  ];

  const active: (BreakdownRow | PageBreakdownRow)[] =
    tab === "queries" ? queries : tab === "countries" ? countries : tab === "devices" ? devices : pages;

  const total = active.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const startIdx = (safePage - 1) * pageSize;
  const pageItems = active.slice(startIdx, startIdx + pageSize);

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
    <TR key={startIdx + i}>
      <TD className="max-w-md">{label}</TD>
      <TD className="text-right tabular-nums">{formatNumber(r.clicks)}</TD>
      <TD className="text-right tabular-nums text-muted">{formatNumber(r.impressions)}</TD>
      <TD className="text-right tabular-nums text-muted">{formatPercent(r.ctr)}</TD>
      <TD className="text-right tabular-nums text-muted">{formatPosition(r.position)}</TD>
    </TR>
  );

  return (
    <Card className="mt-3 overflow-hidden">
      <div className="border-b border-border p-3">
        <Segmented options={tabs} value={tab} onChange={(v) => changeTab(v as Tab)} />
      </div>
      {total === 0 ? (
        <div className="p-2">
          <EmptyState
            icon={Search}
            title={`No ${tab} data`}
            description="Breakdown rows appear after a sync pulls this dimension from Search Console for the selected period."
          />
        </div>
      ) : (
        <>
          <Table>
            <THead>{metricHead}</THead>
            <TBody>
              {tab === "pages"
                ? (pageItems as PageBreakdownRow[]).map((p, i) =>
                    metricRow(
                      p.page?.title ? (
                        <>
                          <span className="font-medium">{p.page.title}</span>
                          <span className="block truncate text-xs text-muted-2">{truncate(p.page.path ?? "", 70)}</span>
                        </>
                      ) : (
                        // No stored title — show the URL path as the label, like Search Console does.
                        <span className="block truncate font-medium">{truncate(p.page?.path ?? "(unknown)", 80)}</span>
                      ),
                      p,
                      i,
                    ),
                  )
                : (pageItems as BreakdownRow[]).map((r, i) =>
                    metricRow(
                      <span className="truncate font-medium">
                        {tab === "devices" ? deviceLabel(r.key) : tab === "countries" ? countryName(r.key) : r.key || "(not set)"}
                      </span>,
                      r,
                      i,
                    ),
                  )}
            </TBody>
          </Table>

          {/* Pagination footer */}
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-border p-3 text-xs text-muted">
            <label className="flex items-center gap-2">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-md border border-border bg-surface px-2 py-1 text-foreground focus-ring"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <span className="tabular-nums">
              {startIdx + 1}–{Math.min(startIdx + pageSize, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={safePage >= pageCount}
                className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
