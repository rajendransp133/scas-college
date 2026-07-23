"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import type { Department } from "@/lib/types"
import { qk } from "./keys"

export type DepartmentInput = Omit<Department, "id">

export function useDepartments() {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.departments,
    queryFn: () => apiGet<Department[]>("/departments"),
    enabled: !!token,
    staleTime: STALE.static,
  })
}

export function useCreateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: DepartmentInput) =>
      apiPost<Department>("/departments", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.departments }),
  })
}

export function useUpdateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DepartmentInput }) =>
      apiPut<Department>(`/departments/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.departments }),
  })
}

export function useDeleteDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/departments/${id}`),
    // Cascades server-side (programs → semesters → courses → assignments →
    // attendance → materials); teachers/students orphan. Refresh everything.
    onSuccess: () => qc.invalidateQueries(),
  })
}
