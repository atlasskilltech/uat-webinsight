import { cn } from "@/lib/utils";
import { type Option, type Tone, labelOf, toneOf } from "@/lib/enums";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  info: "bg-info-soft text-info border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  accent: "bg-accent-soft text-accent-soft-foreground border-transparent",
};

export function Badge({
  tone = "neutral",
  className,
  dot,
  children,
}: {
  tone?: Tone;
  className?: string;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-current"
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

/** Render a badge from an enum option list + stored value. */
export function StatusBadge({
  options,
  value,
  dot,
  className,
}: {
  options: readonly Option[];
  value?: string | null;
  dot?: boolean;
  className?: string;
}) {
  return (
    <Badge tone={toneOf(options, value)} dot={dot} className={className}>
      {labelOf(options, value)}
    </Badge>
  );
}
