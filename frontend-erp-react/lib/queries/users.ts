"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { apiDelete, apiGet, apiPost, apiPut, qs, type Page } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import type { User, UserRole } from "@/lib/types"
import { qk } from "./keys"

/** Accounts never expose the password hash — responses omit `password`. */
export type UserResponse = Omit<User, "password">
export type UserCreateInput = Omit<User, "id">
export type UserUpdateInput = Partial<Omit<User, "id">>

export interface UserFilters {
  search?: string
  role?: UserRole
  page?: number
  pageSize?: number
}

/** Paginated account list (admin/principal). Search and role filtering run in
 *  SQL — never fetch a page and filter it here. */
export function useUsers(filters: UserFilters = {}, enabled = true) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.users(filters),
    queryFn: () => apiGet<Page<UserResponse>>(`/users${qs({ ...filters })}`),
    enabled: !!token && enabled,
    placeholderData: keepPreviousData,
  })
}

/** id→name for every account — any authenticated user (name resolution). */
export interface UserDirectoryEntry {
  id: string
  name: string
}
export function useUserDirectory() {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.userDirectory,
    queryFn: () => apiGet<UserDirectoryEntry[]>("/users/directory"),
    enabled: !!token,
    staleTime: STALE.static,
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UserCreateInput) => apiPost<UserResponse>("/users", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UserUpdateInput }) =>
      apiPut<UserResponse>(`/users/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  })
}
