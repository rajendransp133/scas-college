"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiDelete, apiGet, apiPost, qs } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import type { CourseAssignment } from "@/lib/types"
import { qk } from "./keys"

/**
 * One term's assignments. With no `termId` the server answers for the
 * *current* term — never every term, which grew by a college's staffing each
 * semester — so pass the term you mean.
 */
export function useAssignments(termId?: string | null, enabled = true) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.assignments(termId),
    queryFn: () =>
      apiGet<CourseAssignment[]>(`/assignments${qs({ termId: termId ?? undefined })}`),
    enabled: !!token && enabled,
    staleTime: STALE.reference,
  })
}

export function useAssignTeacher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { courseId: string; teacherId: string; termId: string }) =>
      apiPost<CourseAssignment>("/assignments", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignments"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
  })
}

export function useUnassignTeacher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { courseId: string; teacherId: string; termId: string }) =>
      apiDelete(`/assignments${qs({ ...input })}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignments"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
  })
}
