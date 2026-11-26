import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/**
 * App-wide loading state. Rendered instantly by Next on any client-side
 * navigation whose page isn't ready within a frame, so every page click gives
 * immediate feedback (the app shell stays; the content area shows a skeleton)
 * instead of appearing frozen. Pages with their own loading.tsx override this.
 */
export default function Loading() {
  return (
    <div>
      <div className="mb-6">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-48 w-full" />
      </div>
    </div>
  );
}
