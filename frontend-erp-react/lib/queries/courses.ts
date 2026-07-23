"use client"

import { useQuery } from "@tanstack/react-query"
import { apiGet } from "@/lib/api"
import { useAuthSession } from "@/lib/auth-provider"
import { STALE } from "@/lib/query-provider"
import type { Course } from "@/lib/types"
import { qk } from "./keys"

/** A course with its parentage resolved — the global course lookup. */
export interface FlatCourse extends Course {
  semesterId: string
  semesterNumber: number
  programId: string
}

/** GET /courses — every course flat, for cross-entity name/parent lookups. */
export function useCourses() {
  const { token } = useAuthSession()
  return useQuery({
    queryKey: qk.courses,
    queryFn: () => apiGet<FlatCourse[]>("/courses"),
    enabled: !!token,
    staleTime: STALE.static,
  })
}
