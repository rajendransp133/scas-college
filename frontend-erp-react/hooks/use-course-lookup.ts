"use client"

import { useMemo } from "react"
import {
  useCourses,
  useDepartments,
  usePrograms,
  type FlatCourse,
} from "@/lib/queries"
import { EMPTY_ARRAY } from "@/lib/api"
import type { Department, Program } from "@/lib/types"

export interface CourseInfo extends FlatCourse {
  programName: string
  programCode: string
  departmentId: string | null
  departmentName: string
}

/**
 * The frontend's global cross-entity lookup, rebuilt from the API. Replaces the
 * sandbox store's habit of reading `semesters[].courses[]` + `programs` +
 * `departments` arrays directly. Resolves a courseId to its full parentage
 * (program + department names) in one place.
 */
export function useCourseLookup() {
  const { data: courses = EMPTY_ARRAY, isLoading: coursesLoading } = useCourses()
  const { data: programs = EMPTY_ARRAY, isLoading: programsLoading } = usePrograms()
  const { data: departments = EMPTY_ARRAY, isLoading: deptsLoading } = useDepartments()

  return useMemo(() => {
    const programMap = new Map<string, Program>(programs.map((p) => [p.id, p]))
    const departmentMap = new Map<string, Department>(
      departments.map((d) => [d.id, d]),
    )

    const courseMap = new Map<string, CourseInfo>()
    for (const c of courses) {
      const program = programMap.get(c.programId)
      const department = program ? departmentMap.get(program.departmentId) : undefined
      courseMap.set(c.id, {
        ...c,
        programName: program?.name ?? "—",
        programCode: program?.code ?? "",
        departmentId: program?.departmentId ?? null,
        departmentName: department?.name ?? "—",
      })
    }

    return {
      courseMap,
      programMap,
      departmentMap,
      courses,
      programs,
      departments,
      isLoading: coursesLoading || programsLoading || deptsLoading,
    }
  }, [
    courses,
    programs,
    departments,
    coursesLoading,
    programsLoading,
    deptsLoading,
  ])
}
