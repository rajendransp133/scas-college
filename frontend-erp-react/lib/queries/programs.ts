"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import type { Program, Semester } from "@/lib/types"
import { qk } from "./keys"

export type ProgramInput = Omit<Program, "id">
/** Create also seeds semesters 1..N server-side. */
export type ProgramCreateInput = ProgramInput & { semesterCount: number }

/** GET /programs/{id} nests the program's semesters (each with its courses). */
export interface ProgramDetail extends Program {
  semesters: Semester[]
}

export function usePrograms(departmentId?: string | null) {
  const { token } = useAuthSession()
  const path = departmentId
    ? `/programs?departmentId=${encodeURIComponent(departmentId)}`
    : "/programs"
  return useQuery({
    queryKey: qk.programs(departmentId),
    queryFn: () => apiGet<Program[]>(path),
    enabled: !!token,
    staleTime: STALE.reference,
  })
}

export function useProgram(id: string | null | undefined) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.program(id ?? ""),
    queryFn: () => apiGet<ProgramDetail>(`/programs/${id}`),
    enabled: !!token && !!id,
    staleTime: STALE.reference,
  })
}

export function useCreateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ProgramCreateInput) => apiPost<Program>("/programs", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["programs"] })
      qc.invalidateQueries({ queryKey: qk.courses })
    },
  })
}

export function useUpdateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProgramInput }) =>
      apiPut<Program>(`/programs/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["programs"] }),
  })
}

export function useDeleteProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/programs/${id}`),
    onSuccess: () => qc.invalidateQueries(), // cascades widely
  })
}
