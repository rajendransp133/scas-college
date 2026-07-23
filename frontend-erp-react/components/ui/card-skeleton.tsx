import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * Placeholder for a page whose main content is a grid of cards (the dashboard
 * tiles, the materials list, the "my classes" picker) rather than a table.
 */
export function CardGridSkeleton({
  cards = 4,
  lines = 3,
  className,
}: {
  cards?: number
  lines?: number
  className?: string
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-6 xl:grid-cols-2", className)}>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="rounded-xl border bg-card shadow-sm">
          <div className="flex flex-col gap-2 border-b p-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="divide-y">
            {Array.from({ length: lines }, (_, j) => (
              <div key={j} className="flex items-center gap-3 p-4">
                <Skeleton className="size-9 shrink-0 rounded-md" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** A row of placeholder stat tiles — the dashboard's top strip. */
export function StatTilesSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: tiles }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  )
}

/**
 * A stack of placeholder rows inside one bordered card — the shape used by the
 * checklist / list-in-a-card pages.
 */
export function ListCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t")}
        >
          <Skeleton className="size-[18px] shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <Skeleton className="h-8 w-32 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  )
}

/** Placeholder for a detail page's header + info cards. */
export function DetailPageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 shrink-0 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: cards }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm"
          >
            <Skeleton className="h-4 w-32" />
            {Array.from({ length: 4 }, (_, j) => (
              <div key={j} className="flex justify-between gap-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
