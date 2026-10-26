"use client";

import { TrendChart, SimpleBarChart, type Series } from "@/components/charts/charts";
import type { TrendPoint } from "@/lib/metrics";

const fmtNum = (v: number) => v.toLocaleString();

export function WebsiteTrend({ data }: { data: TrendPoint[] }) {
  const series: Series[] = [
    { key: "clicks", label: "Search clicks", color: "var(--accent)", format: fmtNum },
    { key: "activeUsers", label: "Active users", color: "var(--chart-3)", format: fmtNum },
  ];
  return <TrendChart data={data} xKey="date" series={series} height={220} />;
}

export function TaskCompletionTrend({ data }: { data: { date: string; completed: number }[] }) {
  const series: Series[] = [{ key: "completed", label: "Tasks completed", color: "var(--accent)" }];
  return <SimpleBarChart data={data} xKey="date" series={series} height={220} />;
}
