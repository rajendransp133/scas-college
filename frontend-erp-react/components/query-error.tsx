"use client"

import { RotateCw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ApiError, errMsg } from "@/lib/api"

/**
 * What a page shows when its main query *failed* — distinct from its empty
 * state. Without this, a 403 (a role asking outside its scope) or a 500 read
 * as "No accounts match your filters" / "Student not found", which sends the
 * user looking for data problems that aren't there.
 */
export function QueryError({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  const forbidden = error instanceof ApiError && error.status === 403
  return (
    <div
      role="alert"
      className={
        className ??
        "flex flex-col items-center gap-2 rounded-xl border bg-card p-8 text-center shadow-sm"
      }
    >
      <TriangleAlert size={24} className="text-amber-600" />
      <p className="text-sm font-medium">
        {forbidden ? "You don't have access to this." : "This couldn't be loaded."}
      </p>
      <p className="text-sm text-muted-foreground">{errMsg(error)}</p>
      {onRetry && !forbidden && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw size={16} />
          Try again
        </Button>
      )}
    </div>
  )
}
