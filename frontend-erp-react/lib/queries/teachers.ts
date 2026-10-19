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
import type { Teacher } from "@/lib/types"
import { qk } from "./keys"

export type TeacherInput = Omit<Teacher, "id">

export interface TeacherFilters {
  departmentId?: string
  search?: string
  isHod?: boolean
  sortBy?: "name" | "employeeId" | "designation" | "joiningDate"
  sortDir?: "asc" | "desc"
  page?: number
  pageSize?: number
}

export const EMPTY_TEACHER_PAGE = emptyPage<Teacher>()

export function useTeachers(filters: TeacherFilters = {}) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.teachers(filters),
    queryFn: () => apiGet<Page<Teacher>>(`/teachers${qs({ ...filters })}`),
    enabled: !!token,
    staleTime: STALE.reference,
    placeholderData: keepPreviousData,
  })
}

/**
 * Every HOD — at most one per department, so it is bounded and unpaged. Backs
 * the HOD cards row and the "this will replace <name>" warning in forms.
 */
export function useHods() {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.hods,
    queryFn: () => apiGet<Teacher[]>("/teachers/hods"),
    enabled: !!token,
    staleTime: STALE.reference,
  })
}

/**
 * Every teacher as a flat array, for dropdowns and id→name lookups.
 *
 * Deliberately separate from `useTeachers`: staff is bounded (~100 rows) so
 * one request is cheaper than paging, but callers must opt in rather than
 * accidentally unbounding a paginated list.
 */
export function useTeacherOptions() {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.teachers({ all: true }),
    queryFn: async () =>
      (await apiGet<Page<Teacher>>(`/teachers${qs({ pageSize: 200 })}`)).items,
    enabled: !!token,
    staleTime: STALE.reference,
  })
}

export function useTeacher(id: string | null | undefined) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.teacher(id ?? ""),
    queryFn: () => apiGet<Teacher>(`/teachers/${id}`),
    enabled: !!token && !!id,
    staleTime: STALE.reference,
  })
}

function invalidateTeachers(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["teachers"] })
  qc.invalidateQueries({ queryKey: ["stats"] })
  qc.invalidateQueries({ queryKey: qk.me })
}

export function useCreateTeacher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TeacherInput) => apiPost<Teacher>("/teachers", input),
    // May demote another HOD (single-HOD invariant) — refresh the whole list.
    onSuccess: () => invalidateTeachers(qc),
  })
}

export function useUpdateTeacher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<TeacherInput> }) =>
      apiPut<Teacher>(`/teachers/${id}`, input),
    onSuccess: () => invalidateTeachers(qc),
  })
}

export function useDeleteTeacher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/teachers/${id}`),
    // Drops assignments + unlinks user accounts server-side.
    onSuccess: () => qc.invalidateQueries(),
  })
}

export function useSetHod() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isHod }: { id: string; isHod: boolean }) =>
      apiPost<Teacher>(`/teachers/${id}/hod`, { isHod }),
    onSuccess: () => invalidateTeachers(qc),
  })
}
