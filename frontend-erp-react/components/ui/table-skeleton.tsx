import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * Placeholder rows for a table whose first page is still loading. Drop it into
 * the `isLoading` branch that already precedes the empty state:
 *
 *   {isLoading ? <TableRowsSkeleton rows={8} cols={6} /> : items.length === 0 ? …}
 *
 * Widths vary per column so the block reads as text, not as a grid of bars.
 */
const WIDTHS = ["w-24", "w-40", "w-32", "w-20", "w-28", "w-36", "w-16"]

export function TableRowsSkeleton({
  rows = 8,
  cols,
}: {
  rows?: number
  cols: number
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <TableRow key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <TableCell key={c}>
              <Skeleton className={cn("h-4", WIDTHS[(r + c) % WIDTHS.length])} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}
