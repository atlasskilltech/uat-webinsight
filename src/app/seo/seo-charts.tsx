"use client";

import { TrendChart, type Series } from "@/components/charts/charts";
import type { TrendPoint } from "@/lib/metrics";

const fmtNum = (v: number) => v.toLocaleString();

export function SearchTrend({ data }: { data: TrendPoint[] }) {
  const series: Series[] = [
    { key: "clicks", label: "Clicks", color: "var(--accent)", format: fmtNum },
    { key: "impressions", label: "Impressions", color: "var(--chart-2)", format: fmtNum },
  ];
  return <TrendChart data={data} xKey="date" series={series} />;
}

export function VisitorTrend({ data }: { data: TrendPoint[] }) {
  const series: Series[] = [
    { key: "views", label: "Views", color: "var(--chart-3)", format: fmtNum },
    { key: "activeUsers", label: "Active users", color: "var(--accent)", format: fmtNum },
  ];
  return <TrendChart data={data} xKey="date" series={series} />;
}
