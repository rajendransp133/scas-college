"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiDelete, apiGet, apiPost, qs } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import type { CourseAssignment } from "@/lib/types"
import { qk } from "./keys"

export function useAssignments(termId?: string | null) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.assignments(termId),
    queryFn: () =>
      apiGet<CourseAssignment[]>(`/assignments${qs({ termId: termId ?? undefined })}`),
    enabled: !!token,
    staleTime: STALE.reference,
  })
}

export function useAssignTeacher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { courseId: string; teacherId: string; termId: string }) =>
      apiPost<CourseAssignment>("/assignments", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignments"] }),
  })
}

export function useUnassignTeacher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { courseId: string; teacherId: string; termId: string }) =>
      apiDelete(`/assignments${qs({ ...input })}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignments"] }),
  })
}
