import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { cn, percentChange } from "@/lib/utils";
import { InfoHint } from "./tooltip";

type Delta = ReturnType<typeof percentChange>;

/**
 * KPI / stat card. Every figure must come from real data; when a value is
 * missing we show an explicit state instead of inventing a number.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  delta,
  deltaGoodWhenUp = true,
  caption,
  href,
  state = "ok",
  tone,
}: {
  label: string;
  value?: React.ReactNode;
  icon?: LucideIcon;
  hint?: React.ReactNode;
  delta?: Delta;
  deltaGoodWhenUp?: boolean;
  caption?: string;
  href?: string;
  /** ok = show value; empty = no data; disconnected = integration off */
  state?: "ok" | "empty" | "disconnected";
  tone?: "accent" | "warning" | "danger" | "success";
}) {
  const toneRing =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "success"
          ? "text-success"
          : "text-accent";

  const className = cn(
    "group block rounded-xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
    href && "transition-colors hover:border-border-strong hover:bg-surface-hover",
  );

  const inner = (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted">{label}</span>
          {hint && <InfoHint content={hint} />}
        </div>
        {Icon && (
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2",
              toneRing,
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </div>

      {state === "disconnected" ? (
        <p className="mt-3 text-base font-medium text-muted-2">Not connected</p>
      ) : state === "empty" ? (
        <p className="mt-3 text-base font-medium text-muted-2">No data</p>
      ) : (
        <div className="mt-2.5 flex items-end justify-between gap-2">
          <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
            {value}
          </span>
          {delta && delta.direction !== "na" && (
            <DeltaPill delta={delta} goodWhenUp={deltaGoodWhenUp} />
          )}
        </div>
      )}

      {caption && state === "ok" && (
        <p className="mt-1.5 text-xs text-muted-2">{caption}</p>
      )}
      {state === "disconnected" && (
        <p className="mt-1.5 text-xs text-muted-2">Connect in Settings</p>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    );
  }
  return <div className={className}>{inner}</div>;
}

function DeltaPill({
  delta,
  goodWhenUp,
}: {
  delta: Delta;
  goodWhenUp: boolean;
}) {
  const up = delta.direction === "up";
  const flat = delta.direction === "flat";
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums",
        good === null && "bg-surface-2 text-muted",
        good === true && "bg-success-soft text-success",
        good === false && "bg-danger-soft text-danger",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {delta.label}
    </span>
  );
}
