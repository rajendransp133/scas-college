"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { apiGet, apiPost } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import type { User } from "@/lib/types"
import { qk } from "./keys"

/** GET /auth/me — the current user plus the scope the backend derives for it. */
export interface MeResponse {
  user: User
  /** HOD's department (null for other roles). */
  departmentId: string | null
  /** Student-rep's class program (null for other roles). */
  classProgramId: string | null
  /** Student-rep's class semester (null for other roles). */
  classSemester: number | null
}

export function useMe() {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.me,
    queryFn: () => apiGet<MeResponse>("/auth/me"),
    enabled: !!token,
    staleTime: STALE.static,
  })
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

/**
 * POST /auth/change-password — self-service, for the signed-in account.
 *
 * Nothing to invalidate: the password isn't part of any cached query, and the
 * existing JWT stays valid (it carries a user id, not a credential hash).
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      apiPost<void>("/auth/change-password", input),
  })
}
