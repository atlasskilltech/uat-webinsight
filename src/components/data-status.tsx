import Link from "next/link";
import { FlaskConical, PlugZap, Info } from "lucide-react";

/**
 * Honest banner about where the figures come from. Never implies a live
 * connection that doesn't exist.
 */
export function DataStatusBanner({
  isDemo,
  hasData,
}: {
  isDemo: boolean;
  hasData: boolean;
}) {
  if (!hasData) {
    return (
      <div className="mb-5 flex items-start gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm">
        <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-muted-2" />
        <p className="text-muted">
          <span className="font-medium text-foreground">No performance data yet.</span>{" "}
          Connect Google or import a CSV in{" "}
          <Link href="/settings" className="font-medium text-accent hover:underline">
            Settings → Integrations
          </Link>{" "}
          to see real figures here.
        </p>
      </div>
    );
  }
  if (isDemo) {
    return (
      <div className="mb-5 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft/60 px-4 py-3 text-sm">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-foreground">
          <span className="font-medium">Showing demo data.</span> These are seeded
          sample figures for demonstration — not ATLAS&apos;s real metrics. Connect a
          data source or remove demo data in{" "}
          <Link href="/settings" className="font-medium text-accent hover:underline">
            Settings
          </Link>
          .
        </p>
      </div>
    );
  }
  return null;
}

export function InlineNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-2" />
      <span>{children}</span>
    </div>
  );
}
