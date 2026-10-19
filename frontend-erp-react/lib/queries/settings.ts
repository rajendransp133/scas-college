"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPut } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import { qk } from "./keys"

/** App-wide state every page is scoped by: the current term + the lock date. */
export interface AppSettings {
  currentTermId: string | null
  lockDate: string | null
}

export function useSettings() {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.settings,
    queryFn: () => apiGet<AppSettings>("/settings"),
    enabled: !!token,
    staleTime: STALE.standard,
  })
}

export function useSetCurrentTerm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (termId: string) => apiPut("/terms/current", { termId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.settings })
      qc.invalidateQueries({ queryKey: qk.terms })
    },
  })
}

export function useSetLockDate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: string | null) =>
      apiPut<{ lockDate: string | null }>("/lock-date", { date }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.settings })
      qc.invalidateQueries({ queryKey: ["audit"] })
      // The lock state tile on the dashboard / close-out checklist.
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
  })
}
