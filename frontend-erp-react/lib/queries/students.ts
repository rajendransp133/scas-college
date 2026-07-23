"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { apiDelete, apiGet, apiPost, apiPut, emptyPage, qs, type Page } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import type { Student } from "@/lib/types"
import { qk } from "./keys"

export type StudentInput = Omit<Student, "id">

export type StudentStatus = "active" | "inactive" | "graduated"

/**
 * Everything the server filters on. Search, filters, sort and paging all run
 * in SQL — the client never receives rows it isn't showing.
 */
export interface StudentFilters {
  departmentId?: string
  programId?: string
  semester?: number
  /** Set-membership over semester numbers — used for parity questions. */
  semesters?: number[]
  search?: string
  status?: StudentStatus
  sortBy?: "rollNumber" | "name" | "currentSemester" | "admissionYear" | "email"
  sortDir?: "asc" | "desc"
  page?: number
  pageSize?: number
}

/** Stable empty page so `data ?? EMPTY_STUDENT_PAGE` keeps a constant identity. */
export const EMPTY_STUDENT_PAGE = emptyPage<Student>()

export function useStudents(filters: StudentFilters = {}) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.students(filters),
    queryFn: () => apiGet<Page<Student>>(`/students${qs({ ...filters })}`),
    enabled: !!token,
    // Paging/searching keeps the previous page on screen instead of flashing
    // an empty table while the next one loads.
    placeholderData: keepPreviousData,
  })
}

/** Ids of every matching student — for cohort actions (promote/graduate). */
export function useStudentIds(
  filters: Pick<StudentFilters, "departmentId" | "programId" | "semester" | "status">,
  enabled = true,
) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.studentIds(filters),
    queryFn: () => apiGet<string[]>(`/students/ids${qs({ ...filters })}`),
    enabled: !!token && enabled,
  })
}

/**
 * Existing roll numbers only, for the bulk-upload dialog's duplicate check.
 * `enabled` so it loads when the dialog opens rather than on page mount.
 */
export function useRollNumbers(enabled = true) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: ["students", "roll-numbers"] as const,
    queryFn: () => apiGet<string[]>("/students/roll-numbers"),
    enabled: !!token && enabled,
    staleTime: STALE.standard,
  })
}

export interface StudentRef {
  id: string
  name: string
  rollNumber: string
}

/**
 * Resolve a specific set of student ids to name + roll number.
 *
 * For pages that render names against ids they got from elsewhere (the audit
 * log, a session roster). Keyed on the sorted id set so paging through a log
 * reuses the cache whenever the same students reappear.
 */
export function useStudentLookup(ids: string[]) {
  const { token } = useAuthSession()
  const sorted = [...new Set(ids)].sort()
  return useQuery({
    queryKey: ["students", "lookup", sorted] as const,
    queryFn: () => apiGet<StudentRef[]>(`/students/lookup${qs({ ids: sorted })}`),
    enabled: !!token && sorted.length > 0,
    staleTime: STALE.reference,
    placeholderData: keepPreviousData,
  })
}

export function useStudent(id: string | null | undefined) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.student(id ?? ""),
    queryFn: () => apiGet<Student>(`/students/${id}`),
    enabled: !!token && !!id,
    staleTime: STALE.standard,
  })
}

export function useCreateStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: StudentInput) => apiPost<Student>("/students", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["students"] }),
  })
}

export function useUpdateStudent() {
  const qc = useQueryClient()
  return useMutation({
    // rollNumber is locked server-side on edit; sending it is harmless (ignored).
    mutationFn: ({ id, input }: { id: string; input: Partial<StudentInput> }) =>
      apiPut<Student>(`/students/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["students"] }),
  })
}

export function useDeleteStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/students/${id}`),
    // Hard delete also strips the student's attendance records.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students"] })
      qc.invalidateQueries({ queryKey: ["attendance"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
  })
}

function invalidateRoster(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["students"] })
  qc.invalidateQueries({ queryKey: ["stats"] })
  qc.invalidateQueries({ queryKey: ["roster"] })
}

export function useToggleStudentActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<Student>(`/students/${id}/toggle-active`),
    onSuccess: () => invalidateRoster(qc),
  })
}

/**
 * `repsRemoved` counts class-rep logins the server retired because their class
 * moved out of that semester in whole — a partial promotion leaves the account
 * alone. The admin creates a fresh account for the class's new semester.
 */
export function usePromoteStudents() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiPost<{ promoted: number; repsRemoved: number }>("/students/promote", { ids }),
    onSuccess: () => {
      invalidateRoster(qc)
      // A retired rep account changes the /users directory too.
      void qc.invalidateQueries({ queryKey: ["users"] })
    },
  })
}

/** `repsRemoved`: rep logins retired because their class has graduated. */
export function useGraduateStudents() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiPost<{ graduated: number; repsRemoved: number }>("/students/graduate", { ids }),
    onSuccess: () => {
      invalidateRoster(qc)
      void qc.invalidateQueries({ queryKey: ["users"] })
    },
  })
}
