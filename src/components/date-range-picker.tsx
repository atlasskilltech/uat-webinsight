"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarRange, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import {
  SEO_RANGE_PRESETS,
  SEO_COMPARE_PRESETS,
  SEO_DEFAULT_RANGE_KEY,
  fmtDate,
  toISODate,
  subMonths,
} from "@/lib/dates";

/**
 * Google Search Console-style date-range picker for the SEO & Analytics page.
 *
 * Two tabs:
 *  - Filter — preset windows (24 hours … 16 months) or a Custom start/end range.
 *  - Compare — compare against the Previous period, Year over year, or a Custom
 *    period.
 *
 * The selection is written to the URL query params (`range`, `start`/`end` for a
 * custom range; `cmp`, `cmpStart`/`cmpEnd` for a custom compare), which the
 * server component reads to drive every metric query.
 */
export function DateRangePicker({ paramKey = "range" }: { paramKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlKey = params.get(paramKey) ?? SEO_DEFAULT_RANGE_KEY;
  const urlStart = params.get("start");
  const urlEnd = params.get("end");
  const urlCmp = params.get("cmp") ?? "previous";
  const urlCmpStart = params.get("cmpStart");
  const urlCmpEnd = params.get("cmpEnd");

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"filter" | "compare">("filter");

  const [sel, setSel] = useState<string>(urlKey);
  const [customStart, setCustomStart] = useState<string>(urlStart ?? toISODate(subMonths(new Date(), 6)));
  const [customEnd, setCustomEnd] = useState<string>(urlEnd ?? toISODate(new Date()));

  const [cmp, setCmp] = useState<string>(urlCmp);
  const [cmpStart, setCmpStart] = useState<string>(urlCmpStart ?? toISODate(subMonths(new Date(), 12)));
  const [cmpEnd, setCmpEnd] = useState<string>(urlCmpEnd ?? toISODate(subMonths(new Date(), 6)));

  const popRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  // Restore the last-used filters when the page is opened without any in the
  // URL (e.g. via the sidebar link). Runs on the client, so it works even when
  // the router serves a cached page — no hard refresh needed.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (params.get(paramKey)) return; // URL already carries a filter
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("seo_filters");
    } catch {
      /* storage unavailable */
    }
    if (saved && saved.includes("range=")) {
      router.replace(`${pathname}?${saved}`);
    }
  }, [params, paramKey, pathname, router]);

  // Reset the local draft to the URL's current state whenever the popover opens.
  useEffect(() => {
    if (!open) return;
    setSel(urlKey);
    setCustomStart(urlStart ?? toISODate(subMonths(new Date(), 6)));
    setCustomEnd(urlEnd ?? toISODate(new Date()));
    setCmp(urlCmp);
    setCmpStart(urlCmpStart ?? toISODate(subMonths(new Date(), 12)));
    setCmpEnd(urlCmpEnd ?? toISODate(subMonths(new Date(), 6)));
  }, [open, urlKey, urlStart, urlEnd, urlCmp, urlCmpStart, urlCmpEnd]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const customInvalid = sel === "custom" && (!customStart || !customEnd || customEnd < customStart);
  const cmpInvalid = cmp === "custom" && (!cmpStart || !cmpEnd || cmpEnd < cmpStart);
  const invalid = customInvalid || cmpInvalid;

  // Label shown on the trigger button for the currently-applied range.
  const activeLabel = (() => {
    if (urlKey === "custom" && urlStart && urlEnd && urlEnd >= urlStart) {
      return `${fmtDate(urlStart)} – ${fmtDate(urlEnd)}`;
    }
    const preset = SEO_RANGE_PRESETS.find((p) => p.key === urlKey);
    return preset?.label ?? "6 months";
  })();

  const apply = () => {
    if (invalid) return;
    const next = new URLSearchParams(params.toString());

    next.set(paramKey, sel);
    if (sel === "custom") {
      next.set("start", customStart);
      next.set("end", customEnd);
    } else {
      next.delete("start");
      next.delete("end");
    }

    if (cmp && cmp !== "previous") {
      next.set("cmp", cmp);
      if (cmp === "custom") {
        next.set("cmpStart", cmpStart);
        next.set("cmpEnd", cmpEnd);
      } else {
        next.delete("cmpStart");
        next.delete("cmpEnd");
      }
    } else {
      next.delete("cmp");
      next.delete("cmpStart");
      next.delete("cmpEnd");
    }

    const qs = next.toString();
    // Remember the selection so returning to the page (e.g. via the sidebar
    // link, which has no query params) restores it instead of the default.
    try {
      localStorage.setItem("seo_filters", qs);
    } catch {
      /* storage unavailable — fall back to URL only */
    }
    setOpen(false);
    router.push(`${pathname}?${qs}`);
  };

  const rangeOptions = [...SEO_RANGE_PRESETS.map((p) => ({ key: p.key, label: p.label })), { key: "custom", label: "Custom" }];

  return (
    <div className="relative" ref={popRef}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarRange className="h-3.5 w-3.5 text-muted-2" />
        {activeLabel}
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-2 transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose date range"
          className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-border bg-surface p-3 shadow-lg"
        >
          {/* Tabs */}
          <div className="mb-3 flex gap-1 border-b border-border">
            {(["filter", "compare"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                  tab === t ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground",
                )}
                aria-selected={tab === t}
                role="tab"
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "filter" ? (
            <>
              <div className="space-y-0.5">
                {rangeOptions.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setSel(o.key)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors",
                      sel === o.key ? "bg-accent-soft text-accent-soft-foreground font-medium" : "text-foreground hover:bg-surface-hover",
                    )}
                    aria-pressed={sel === o.key}
                  >
                    {o.label}
                    {sel === o.key && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>

              {sel === "custom" && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
                  <Field label="Start date">
                    <Input type="date" value={customStart} max={customEnd || undefined} onChange={(e) => setCustomStart(e.target.value)} />
                  </Field>
                  <Field label="End date">
                    <Input type="date" value={customEnd} min={customStart || undefined} onChange={(e) => setCustomEnd(e.target.value)} />
                  </Field>
                  {customInvalid && (
                    <p className="col-span-2 -mt-1 text-xs text-danger">The end date can’t be before the start date.</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-0.5">
                {SEO_COMPARE_PRESETS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setCmp(o.key)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors",
                      cmp === o.key ? "bg-accent-soft text-accent-soft-foreground font-medium" : "text-foreground hover:bg-surface-hover",
                    )}
                    aria-pressed={cmp === o.key}
                  >
                    {o.label}
                    {cmp === o.key && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>

              {cmp === "custom" && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
                  <Field label="Compare start">
                    <Input type="date" value={cmpStart} max={cmpEnd || undefined} onChange={(e) => setCmpStart(e.target.value)} />
                  </Field>
                  <Field label="Compare end">
                    <Input type="date" value={cmpEnd} min={cmpStart || undefined} onChange={(e) => setCmpEnd(e.target.value)} />
                  </Field>
                  {cmpInvalid && (
                    <p className="col-span-2 -mt-1 text-xs text-danger">The end date can’t be before the start date.</p>
                  )}
                </div>
              )}
            </>
          )}

          <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={apply} disabled={invalid}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  );
}
