"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  emptyPage,
  qs,
  type Page,
} from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import type { AttendanceSession, AttendanceStatus, Student } from "@/lib/types"
import { qk } from "./keys"

export interface AttendanceFilters {
  courseId?: string
  termId?: string
  date?: string
  dateFrom?: string
  dateTo?: string
  month?: string
  page?: number
  pageSize?: number
}

export const EMPTY_SESSION_PAGE = emptyPage<AttendanceSession>()

/** GET /attendance — sessions with their records, paginated. */
export function useAttendance(filters: AttendanceFilters = {}, enabled = true) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.attendance(filters),
    queryFn: () => apiGet<Page<AttendanceSession>>(`/attendance${qs({ ...filters })}`),
    enabled: !!token && enabled,
    staleTime: STALE.live,
    placeholderData: keepPreviousData,
  })
}

/**
 * GET /attendance/register — every session for one class (optionally one
 * month), with records. Bounded by the course, so it comes back whole: this is
 * the students × sessions matrix.
 */
export function useRegister(
  params: { courseId?: string | null; termId?: string | null; month?: string | null },
  enabled = true,
) {
  const { token } = useAuthSession()
  const { courseId, termId, month } = params
  return useQuery({
    queryKey: qk.register({ courseId, termId, month }),
    queryFn: () =>
      apiGet<AttendanceSession[]>(
        `/attendance/register${qs({
          courseId: courseId ?? undefined,
          termId: termId ?? undefined,
          month: month ?? undefined,
        })}`,
      ),
    enabled: !!token && enabled && !!courseId,
    staleTime: STALE.live,
    placeholderData: keepPreviousData,
  })
}

/** Distinct `YYYY-MM` values for the register's month picker (computed in SQL). */
export function useSessionMonths(
  courseId: string | null | undefined,
  termId?: string | null,
) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.sessionMonths(courseId ?? "", termId),
    queryFn: () =>
      apiGet<string[]>(
        `/attendance/months${qs({ courseId: courseId!, termId: termId ?? undefined })}`,
      ),
    enabled: !!token && !!courseId,
    staleTime: STALE.live,
  })
}

/** GET /attendance/roster — the server-derived class list for a course. */
export function useRoster(courseId: string | null | undefined) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.roster(courseId ?? ""),
    queryFn: () =>
      apiGet<Student[]>(`/attendance/roster${qs({ courseId: courseId! })}`),
    enabled: !!token && !!courseId,
    staleTime: STALE.standard,
  })
}

/**
 * The register's row set — current class members ∪ anyone with saved marks in
 * scope, so students who left or graduated keep their history. Computed by the
 * server; the client no longer needs the whole student table to work it out.
 */
export function useClassRoster(
  params: { courseId?: string | null; termId?: string | null; month?: string | null },
  enabled = true,
) {
  const { token } = useAuthSession()
  const { courseId, termId, month } = params
  return useQuery({
    queryKey: qk.classRoster(courseId ?? "", termId, month),
    queryFn: () =>
      apiGet<Student[]>(
        `/attendance/class-roster${qs({
          courseId: courseId!,
          termId: termId ?? undefined,
          month: month ?? undefined,
        })}`,
      ),
    enabled: !!token && enabled && !!courseId,
    staleTime: STALE.standard,
    placeholderData: keepPreviousData,
  })
}

// --- server-side aggregation ----------------------------------------------

/** One row per student, as computed by the database. */
export interface AttendanceSummaryRow {
  studentId: string
  rollNumber: string
  name: string
  programId: string | null
  currentSemester: number
  isActive: boolean
  graduated: boolean
  held: number
  attended: number
  pct: number | null
  /** "As marked", i.e. before any correction — the tamper-evidence signal. */
  origHeld: number
  origAttended: number
  origPct: number | null
  corrections: number
}

export interface AttendanceSummaryTotals {
  students: number
  defaulters: number
  held: number
  attended: number
  pct: number | null
}

export type AttendanceSummaryPage = Page<AttendanceSummaryRow> & {
  totals: AttendanceSummaryTotals
}

export interface SummaryFilters {
  termId?: string | null
  programId?: string
  semester?: number
  courseId?: string
  courseIds?: string[]
  departmentId?: string
  search?: string
  minPct?: number
  defaultersOnly?: boolean
  page?: number
  pageSize?: number
}

/**
 * GET /attendance/summary — per-student attendance %, aggregated in SQL.
 * Replaces the old client-side pass over every session in the term.
 */
export function useAttendanceSummary(filters: SummaryFilters = {}, enabled = true) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.summary(filters),
    queryFn: () =>
      apiGet<AttendanceSummaryPage>(
        `/attendance/summary${qs({
          ...filters,
          termId: filters.termId ?? undefined,
        })}`,
      ),
    enabled: !!token && enabled,
    staleTime: STALE.live,
    placeholderData: keepPreviousData,
  })
}

export interface CourseTally {
  courseId: string
  held: number
  attended: number
  pct: number | null
  origHeld: number
  origAttended: number
  origPct: number | null
  corrections: number
}

/** Per-course tally for one student (summary expand row / student detail). */
export function useStudentBreakdown(
  studentId: string | null | undefined,
  termId?: string | null,
  enabled = true,
) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.breakdown(studentId ?? "", termId),
    queryFn: () =>
      apiGet<CourseTally[]>(
        `/attendance/summary/breakdown${qs({
          studentId: studentId!,
          termId: termId ?? undefined,
        })}`,
      ),
    enabled: !!token && enabled && !!studentId,
    staleTime: STALE.live,
  })
}

export interface RedFlags {
  passingOnlyViaCorrections: {
    studentId: string
    name: string
    rollNumber: string
    held: number
    attended: number
    pct: number | null
    origPct: number | null
    corrections: number
  }[]
  correctionsByUser: { userId: string; corrections: number }[]
}

/** Attendance-integrity warning signs (admin/principal oversight page). */
export function useRedFlags(termId?: string | null, enabled = true) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.redFlags(termId),
    queryFn: () =>
      apiGet<RedFlags>(`/attendance/red-flags${qs({ termId: termId ?? undefined })}`),
    enabled: !!token && enabled,
    staleTime: STALE.live,
  })
}

// --- mutations -------------------------------------------------------------

function invalidateAttendance(
  qc: ReturnType<typeof useQueryClient>,
  { keepRegister = false }: { keepRegister?: boolean } = {},
) {
  // Sessions, register, summary, breakdown and red flags all live under
  // ["attendance"]; the audit log and dashboard counters move too.
  qc.invalidateQueries({
    queryKey: ["attendance"],
    predicate: (q) => !(keepRegister && q.queryKey[1] === "register"),
  })
  qc.invalidateQueries({ queryKey: ["audit"] })
  qc.invalidateQueries({ queryKey: ["stats"] })
  // Rosters key off ["roster", …], outside the ["attendance"] namespace, so a
  // save/correction would otherwise leave a stale class list on screen.
  qc.invalidateQueries({ queryKey: ["roster"] })
}

export interface SaveAttendanceInput {
  courseId: string
  date: string
  period: number
  termId: string
  records: { studentId: string; status: AttendanceStatus }[]
}

/**
 * POST /attendance — upsert on (courseId, date, period). The backend does the
 * correction diffing, audit stamping, and lock guard; we just send the records.
 */
export function useSaveAttendance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveAttendanceInput) =>
      apiPost<AttendanceSession>("/attendance", input),
    onSuccess: () => invalidateAttendance(qc),
  })
}

/** PATCH one cell of a saved session. */
export function useSetAttendanceStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      sessionId,
      studentId,
      status,
    }: {
      sessionId: string
      studentId: string
      status: AttendanceStatus
    }) =>
      apiPatch<AttendanceSession>(
        `/attendance/${sessionId}/records/${studentId}`,
        { status },
      ),
    // The PATCH returns the whole corrected session — write it straight into
    // every cached register instead of refetching the matrix per click.
    onSuccess: (session) => {
      qc.setQueriesData<AttendanceSession[]>(
        { queryKey: ["attendance", "register"] },
        (old) => old?.map((s) => (s.id === session.id ? session : s)),
      )
      invalidateAttendance(qc, { keepRegister: true })
    },
  })
}

export function useDeleteSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => apiDelete(`/attendance/${sessionId}`),
    onSuccess: () => invalidateAttendance(qc),
  })
}
