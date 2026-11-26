import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/**
 * Instant loading state for the SEO & Analytics page. This page runs several
 * data aggregations, so without a loading boundary a left-click (client-side
 * navigation) shows no feedback until the whole page is ready — which feels
 * like "nothing happened / the page doesn't open". Next renders this skeleton
 * immediately on navigation and swaps in the real page when it's ready.
 */
export default function SeoLoading() {
  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Skeleton className="h-6 w-64" />
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      {/* Search performance */}
      <Skeleton className="mb-3 h-4 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={`s${i}`} />
        ))}
      </div>

      {/* Visitor analytics */}
      <Skeleton className="mt-8 mb-3 h-4 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={`a${i}`} />
        ))}
      </div>

      {/* Charts + breakdown */}
      <div className="mt-8 rounded-xl border border-border bg-surface p-5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-56 w-full" />
      </div>
    </div>
  );
}
