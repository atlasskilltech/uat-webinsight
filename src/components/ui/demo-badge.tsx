import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Marks any value or record that originates from seeded sample data so it is
 * never mistaken for Atlas's real metrics.
 */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-warning/30 bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning",
        className,
      )}
      title="This is seeded demonstration data, not real ATLAS data."
    >
      <FlaskConical className="h-2.5 w-2.5" />
      Demo data
    </span>
  );
}
