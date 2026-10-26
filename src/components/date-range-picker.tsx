"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarRange, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import {
  SEO_RANGE_PRESETS,
  SEO_DEFAULT_RANGE_KEY,
  fmtDate,
  toISODate,
  subMonths,
} from "@/lib/dates";

/**
 * Google Search Console-style date-range picker for the SEO & Analytics page.
 *
 * Presets (Last 6 / 12 / 16 months) and a Custom option with start/end pickers,
 * Apply and Cancel. The chosen range is written to the URL as query params
 * (`range`, plus `start`/`end` for custom), which the server component reads to
 * drive every metric query. Validation prevents an end date before the start.
 */
export function DateRangePicker({ paramKey = "range" }: { paramKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlKey = params.get(paramKey) ?? SEO_DEFAULT_RANGE_KEY;
  const urlStart = params.get("start");
  const urlEnd = params.get("end");

  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string>(urlKey);
  const [customStart, setCustomStart] = useState<string>(urlStart ?? toISODate(subMonths(new Date(), 6)));
  const [customEnd, setCustomEnd] = useState<string>(urlEnd ?? toISODate(new Date()));
  const popRef = useRef<HTMLDivElement>(null);

  // Reset the local draft to the URL's current state whenever the popover opens.
  useEffect(() => {
    if (open) {
      setSel(urlKey);
      setCustomStart(urlStart ?? toISODate(subMonths(new Date(), 6)));
      setCustomEnd(urlEnd ?? toISODate(new Date()));
    }
  }, [open, urlKey, urlStart, urlEnd]);

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

  // Label shown on the trigger button for the currently-applied range.
  const activeLabel = (() => {
    if (urlKey === "custom" && urlStart && urlEnd && urlEnd >= urlStart) {
      return `${fmtDate(urlStart)} – ${fmtDate(urlEnd)}`;
    }
    const preset = SEO_RANGE_PRESETS.find((p) => p.key === urlKey);
    return preset?.label ?? "Last 6 months";
  })();

  const apply = () => {
    if (customInvalid) return;
    const next = new URLSearchParams(params.toString());
    next.set(paramKey, sel);
    if (sel === "custom") {
      next.set("start", customStart);
      next.set("end", customEnd);
    } else {
      next.delete("start");
      next.delete("end");
    }
    setOpen(false);
    router.push(`${pathname}?${next.toString()}`);
  };

  const options = [...SEO_RANGE_PRESETS, { key: "custom", label: "Custom", months: 0 }] as const;

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
          className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-surface p-3 shadow-lg"
        >
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-2">Date range</p>
          <div className="space-y-0.5">
            {options.map((o) => (
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
                <p className="col-span-2 -mt-1 text-xs text-danger">
                  The end date can’t be before the start date.
                </p>
              )}
            </div>
          )}

          <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={apply} disabled={customInvalid}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  );
}
