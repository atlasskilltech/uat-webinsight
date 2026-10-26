import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lightweight CSS-only tooltip — no JS, works in server components.
 * Used heavily to explain metrics (CTR, impressions, Core Web Vitals, …) to
 * non-technical readers.
 */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-xs -translate-x-1/2 scale-95 rounded-lg border border-border-strong bg-foreground px-2.5 py-1.5 text-xs font-normal leading-snug text-background opacity-0 shadow-lg transition-all duration-150 group-hover/tt:scale-100 group-hover/tt:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}

/** An inline info icon with an explanatory tooltip. */
export function InfoHint({ content }: { content: React.ReactNode }) {
  return (
    <Tooltip content={content}>
      <Info
        className="h-3.5 w-3.5 text-muted-2 hover:text-muted"
        aria-hidden="true"
      />
    </Tooltip>
  );
}
