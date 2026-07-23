"use client"

import { useQuery } from "@tanstack/react-query"
import { apiGet, qs } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import { qk } from "./keys"

/**
 * Dashboard counters, computed in SQL in one round trip.
 *
 * These used to be derived on the client from `useAttendance({})` — i.e. by
 * downloading every attendance session in the database on every dashboard
 * load. Scoping (an HOD sees only their department) is applied server-side
 * from the caller's own role, not passed in.
 */
export interface DashboardStats {
  students: number
  teachers: number
  programs: number
  sessionsThisTerm: number
  sessionsToday: number
  correctionsThisWeek: number
  shortfall: number
}

export function useDashboardStats(termId?: string | null, enabled = true) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.dashboard(termId),
    queryFn: () =>
      apiGet<DashboardStats>(`/stats/dashboard${qs({ termId: termId ?? undefined })}`),
    enabled: !!token && enabled,
    staleTime: STALE.live,
  })
}

export interface UnstaffedCourse {
  courseId: string
  name: string
  code: string
  semesterNumber: number
  programId: string
}

/**
 * Courses with no teacher assigned this term.
 *
 * `semesters` are the semester numbers in session for the term's parity — the
 * parity rule stays defined on the client (`semesterInSession`), and the
 * filtering happens in SQL.
 */
export function useUnstaffedCourses(
  termId?: string | null,
  semesters?: number[],
  enabled = true,
) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.unstaffed(termId, semesters),
    queryFn: () =>
      apiGet<UnstaffedCourse[]>(
        `/stats/unstaffed-courses${qs({
          termId: termId ?? undefined,
          semesters: semesters,
        })}`,
      ),
    enabled: !!token && enabled,
    staleTime: STALE.standard,
  })
}

/** How many enrolled students sit below the attendance threshold. */
export function useShortfallCount(
  termId?: string | null,
  minPct?: number,
  enabled = true,
) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.shortfall(termId),
    queryFn: () =>
      apiGet<{ count: number }>(
        `/stats/shortfall-count${qs({ termId: termId ?? undefined, minPct })}`,
      ),
    enabled: !!token && enabled,
    staleTime: STALE.live,
  })
}
