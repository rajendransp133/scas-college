"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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

interface ChangePasswordResponse {
  accessToken: string
  tokenType: string
  user: User
}

/**
 * POST /auth/change-password — self-service, for the signed-in account.
 *
 * The server rotates the account's token epoch, which revokes every *other*
 * session it had handed out, and returns a fresh token for this device. We swap
 * that in (`replaceToken`) so the current session survives the rotation — any
 * other device holding the old token drops to the login screen on its next
 * request.
 */
export function useChangePassword() {
  const { replaceToken } = useAuthSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      apiPost<ChangePasswordResponse>("/auth/change-password", input),
    onSuccess: (res) => {
      replaceToken(res.accessToken)
      void queryClient.invalidateQueries({ queryKey: qk.me })
    },
  })
}
