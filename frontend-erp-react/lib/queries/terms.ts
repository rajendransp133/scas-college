"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPost } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import type { AcademicTerm, TermParity } from "@/lib/types"
import { qk } from "./keys"

export function useTerms() {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.terms,
    queryFn: () => apiGet<AcademicTerm[]>("/terms"),
    enabled: !!token,
    staleTime: STALE.static,
  })
}

export function useAddTerm() {
  const qc = useQueryClient()
  return useMutation({
    // Backend derives name/endYear from (startYear, parity).
    mutationFn: (input: { startYear: number; parity: TermParity }) =>
      apiPost<AcademicTerm>("/terms", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.terms }),
  })
}
