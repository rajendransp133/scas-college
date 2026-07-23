"use client";

import { useState } from "react";

/**
 * A 1-based page number that resets to 1 whenever the filters change.
 *
 * `filterKey` is a stable string describing the current filter set — pass
 * something like `JSON.stringify({ search, dept, status })`. When it changes,
 * the page resets *during render* rather than in an effect: syncing state in an
 * effect would render the stale page once, then immediately re-render, which is
 * both a wasted pass and a flash of the wrong rows.
 *
 * See "You Might Not Need an Effect" — adjusting state when a prop changes is
 * the one sanctioned use of setState during render.
 */
export function usePagination(filterKey: string) {
  const [page, setPage] = useState(1);
  const [seenKey, setSeenKey] = useState(filterKey);

  if (seenKey !== filterKey) {
    setSeenKey(filterKey);
    setPage(1);
  }

  return [page, setPage] as const;
}
