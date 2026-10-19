"use client"

import { useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ApiError } from "@/lib/api"

/**
 * How long a cached read stays fresh, by how often the underlying data
 * actually changes. Exported so individual hooks pick a tier by name instead
 * of scattering magic numbers.
 */
export const STALE = {
  /** Effectively static for a session: terms, course lookup, departments, directory. */
  static: 30 * 60_000,
  /** Reference data that changes on admin action: programs, semesters, teachers. */
  reference: 5 * 60_000,
  /** Normal operational data: students, materials, assignments. */
  standard: 60_000,
  /** Changes constantly / integrity-sensitive: attendance, audit, dashboard. */
  live: 15_000,
} as const

/**
 * App-wide React Query client.
 *
 * - `staleTime` defaults to a minute: without it every mount refetches, which
 *   with this many components meant duplicate requests on every navigation.
 * - `refetchOnMount` stays at its default (`true`), which refetches on mount
 *   **only when the data is stale or was invalidated** — fresh data is served
 *   from cache with no request, so the `staleTime` tiers are what prevent the
 *   double-requesting. Setting it to `false` disabled that check entirely:
 *   a mutation's `invalidateQueries` only refetched queries on screen, so
 *   saving attendance and then opening the summary showed the old numbers for
 *   up to `gcTime`.
 * - `gcTime` is generous so going back to a page you just left is instant.
 * - 4xx responses are never retried (they won't succeed on a retry); transient
 *   5xx/network errors get a couple of tries with backoff.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: STALE.standard,
            gcTime: 10 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status >= 400 && error.status < 500)
                return false
              return failureCount < 2
            },
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
          },
          mutations: {
            retry: false,
          },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
