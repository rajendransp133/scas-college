"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiDelete, apiGet, apiPost } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import type { Course, Semester } from "@/lib/types"
import { qk } from "./keys"

export type CourseInput = Omit<Course, "id">

/** GET /semesters?programId= — each semester nests its courses. */
export function useSemesters(programId: string | null | undefined) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.semesters(programId ?? ""),
    queryFn: () =>
      apiGet<Semester[]>(`/semesters?programId=${encodeURIComponent(programId!)}`),
    enabled: !!token && !!programId,
    staleTime: STALE.reference,
  })
}

/** Invalidate everything curriculum-related after a semester/course change. */
function invalidateCurriculum(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["semesters"] })
  qc.invalidateQueries({ queryKey: ["programs"] })
  qc.invalidateQueries({ queryKey: qk.courses })
}

export function useAddSemester() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { programId: string; number: number }) =>
      apiPost<Semester>("/semesters", input),
    onSuccess: () => invalidateCurriculum(qc),
  })
}

export function useDeleteSemester() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/semesters/${id}`),
    onSuccess: () => qc.invalidateQueries(), // cascades to assignments/attendance/materials
  })
}

export function useAddCourse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ semesterId, input }: { semesterId: string; input: CourseInput }) =>
      apiPost<Course>(`/semesters/${semesterId}/courses`, input),
    onSuccess: () => invalidateCurriculum(qc),
  })
}

export function useDeleteCourse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ semesterId, courseId }: { semesterId: string; courseId: string }) =>
      apiDelete(`/semesters/${semesterId}/courses/${courseId}`),
    onSuccess: () => qc.invalidateQueries(),
  })
}
