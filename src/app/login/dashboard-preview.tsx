import { LayoutDashboard, ListChecks, LineChart, SearchCheck, Network, FileText, BarChart3, ClipboardList, Settings } from "lucide-react";

/**
 * Decorative, illustrative dashboard mock for the login showcase. Static markup
 * only (no client JS, no charting lib) to keep the login page lightweight. All
 * numbers are clearly labelled as illustrative — they are NOT live analytics.
 */

const BARS = [34, 28, 46, 40, 58, 44, 66, 52, 72, 60, 84, 70, 92, 62];
const METRICS = [
  { label: "Total Pageviews", value: "245.8K", delta: "+12%", stroke: "#60a5fa" },
  { label: "Total Users", value: "68.4K", delta: "+8%", stroke: "#a78bfa" },
  { label: "Average CTR", value: "3.2%", delta: "+0.6%", stroke: "#34d399" },
  { label: "Total Blogs", value: "124", delta: "+18%", stroke: "#f472b6" },
];
const NAV = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: ListChecks, label: "My Work" },
  { icon: LineChart, label: "SEO & Analytics" },
  { icon: SearchCheck, label: "Page Inspector" },
  { icon: Network, label: "Sitemap" },
  { icon: FileText, label: "Blog" },
  { icon: BarChart3, label: "Reports" },
  { icon: ClipboardList, label: "Tasks" },
  { icon: Settings, label: "Settings" },
];
const TOP_PAGES = [
  { path: "/", v: "45.2K" },
  { path: "/schools/isdi", v: "18.6K" },
  { path: "/schools/isme", v: "12.4K" },
  { path: "/schools/ugdx", v: "10.8K" },
  { path: "/campusvisit", v: "8.1K" },
];

function Sparkline({ stroke }: { stroke: string }) {
  return (
    <svg viewBox="0 0 80 24" className="h-6 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points="0,20 12,16 24,18 36,10 48,13 60,6 72,9 80,4"
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DashboardPreview() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 shadow-2xl shadow-indigo-950/50 ring-1 ring-blue-500/10 backdrop-blur-sm"
    >
      <div className="flex">
        {/* Mini sidebar */}
        <div className="hidden w-36 shrink-0 flex-col gap-0.5 border-r border-white/5 bg-slate-950/60 p-3 sm:flex">
          <div className="mb-3 flex items-center gap-1.5 px-1">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br from-teal-400 to-emerald-500 text-[9px] font-bold text-slate-900">A</span>
            <span className="text-[10px] font-semibold text-white/90">ATLAS</span>
          </div>
          {NAV.map((n) => (
            <div
              key={n.label}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[10px] ${
                n.active ? "bg-blue-500/20 text-white" : "text-slate-400"
              }`}
            >
              <n.icon className="h-3 w-3 shrink-0" />
              <span className="truncate">{n.label}</span>
            </div>
          ))}
        </div>

        {/* Main */}
        <div className="min-w-0 flex-1 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-white">Executive Dashboard</p>
              <p className="text-[9px] text-slate-400">Website performance and key metrics at a glance.</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded-md border border-white/10 px-2 py-1 text-[9px] text-slate-300">Oct 1, 2026 – Oct 23, 2026</span>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white">A</span>
            </div>
          </div>

          {/* Metric cards */}
          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {METRICS.map((m) => (
              <div key={m.label} className="rounded-lg border border-white/10 bg-white/5 p-2">
                <p className="truncate text-[8px] uppercase tracking-wide text-slate-400">{m.label}</p>
                <p className="mt-0.5 text-sm font-bold text-white">{m.value}</p>
                <p className="text-[8px] font-medium text-emerald-400">↑ {m.delta}</p>
                <Sparkline stroke={m.stroke} />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1.6fr_1fr]">
            {/* Bar chart */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="mb-2 text-[10px] font-semibold text-white">Website Traffic Overview</p>
              <div className="flex h-24 items-end gap-1">
                {BARS.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-gradient-to-t from-blue-600 to-indigo-400"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[7px] text-slate-500">
                <span>Oct 1</span><span>Oct 10</span><span>Oct 23</span>
              </div>
            </div>

            {/* Top pages */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="mb-2 text-[10px] font-semibold text-white">Top Pages</p>
              <ul className="space-y-1.5">
                {TOP_PAGES.map((p) => (
                  <li key={p.path} className="flex items-center justify-between text-[9px]">
                    <span className="truncate text-slate-300">{p.path}</span>
                    <span className="tabular-nums text-slate-400">{p.v}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mt-2 text-right text-[8px] italic text-slate-500">Illustrative preview — not live data</p>
        </div>
      </div>
    </div>
  );
}
