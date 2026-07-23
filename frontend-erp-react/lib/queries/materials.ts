"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { apiDelete, apiGet, apiPost, emptyPage, qs, type Page } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import type { StudyMaterial } from "@/lib/types"
import { qk } from "./keys"

export interface MaterialFilters {
  programId?: string
  semester?: number
  courseId?: string
  search?: string
  page?: number
  pageSize?: number
}

export const EMPTY_MATERIAL_PAGE = emptyPage<StudyMaterial>()

/** GET /materials — role-scoped and paginated (the server decides visibility). */
export function useMaterials(filters: MaterialFilters = {}) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.materials(filters),
    queryFn: () => apiGet<Page<StudyMaterial>>(`/materials${qs({ ...filters })}`),
    enabled: !!token,
    placeholderData: keepPreviousData,
  })
}

export interface CreateMaterialInput {
  courseId: string
  termId: string
  title: string
  description?: string
  /** Absolute http(s) URL — the server rejects anything else with a 422. */
  url: string
}

/** POST /materials — share a link with a class. Nothing is uploaded. */
export function useCreateMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateMaterialInput) =>
      apiPost<StudyMaterial>("/materials", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["materials"] }),
  })
}

export function useDeleteMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/materials/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["materials"] }),
  })
}
