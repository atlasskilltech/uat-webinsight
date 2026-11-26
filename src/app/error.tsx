"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * App-level error boundary. If a page fails while opening (including a failed
 * client-side navigation), this renders a recoverable message with retry
 * instead of leaving the click dead or showing a blank error. Must be a client
 * component with a `reset` prop (Next.js convention).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error in the browser console for diagnosis.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">This page didn&apos;t load</h2>
      <p className="mt-1 max-w-md text-sm text-muted">
        Something went wrong opening this page. Try again, or reload — if it keeps happening, let us know.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
      {error.digest && <p className="mt-3 text-xs text-muted-2">Reference: {error.digest}</p>}
    </div>
  );
}
