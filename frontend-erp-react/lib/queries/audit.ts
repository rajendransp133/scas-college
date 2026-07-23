"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { apiGet, emptyPage, qs, type Page } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import type { AuditAction, AuditEntry } from "@/lib/types"
import { qk } from "./keys"

export interface AuditFilters {
  termId?: string
  action?: AuditAction
  userId?: string
  studentId?: string
  courseId?: string
  page?: number
  pageSize?: number
}

export const EMPTY_AUDIT_PAGE = emptyPage<AuditEntry>()

/**
 * GET /audit — the append-only log, paginated newest-first (admin/principal
 * only; 403 otherwise). The log is 200k+ rows and never fetched whole.
 */
export function useAudit(filters: AuditFilters = {}, enabled = true) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.audit(filters),
    queryFn: () => apiGet<Page<AuditEntry>>(`/audit${qs({ ...filters })}`),
    enabled: !!token && enabled,
    staleTime: STALE.live,
    placeholderData: keepPreviousData,
  })
}

/**
 * Lock/unlock events for the oversight page's freeze history. These carry no
 * termId, so they can't be found through the term-filtered log query.
 */
export function useLockHistory(enabled = true) {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.lockHistory,
    queryFn: () => apiGet<AuditEntry[]>("/audit/lock-history"),
    enabled: !!token && enabled,
    staleTime: STALE.live,
  })
}
