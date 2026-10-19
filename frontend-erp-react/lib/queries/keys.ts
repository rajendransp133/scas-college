// Central query-key factory.
//
// Keys are hierarchical so a prefix invalidates everything beneath it:
// `["students"]` matches `["students","list",{...}]` and
// `["students","detail",id]` alike. Filter objects are part of the key, so a
// paginated/filtered view caches per filter combination rather than
// clobbering one shared entry.

/**
 * Anything that varies a list query: filters + pagination + sort.
 * `object` rather than `Record<string, unknown>` so plain interfaces (which
 * have no index signature) can be passed directly.
 */
export type ListParams = object

export const qk = {
  me: ["me"] as const,
  settings: ["settings"] as const,

  departments: ["departments"] as const,
  department: (id: string) => ["departments", "detail", id] as const,

  // "list" segment: without it a department id sat in the same slot as
  // `program`'s "detail" literal.
  programs: (departmentId?: string | null) =>
    ["programs", "list", departmentId ?? null] as const,
  program: (id: string) => ["programs", "detail", id] as const,

  semesters: (programId: string) => ["semesters", programId] as const,
  courses: ["courses"] as const,

  students: (params?: ListParams) => ["students", "list", params ?? {}] as const,
  studentIds: (params?: ListParams) => ["students", "ids", params ?? {}] as const,
  student: (id: string) => ["students", "detail", id] as const,
  rollNumbers: ["students", "roll-numbers"] as const,
  /** Sorted, de-duplicated ids — so the same set of students reuses one entry. */
  studentLookup: (sortedIds: string[]) => ["students", "lookup", sortedIds] as const,

  teachers: (params?: ListParams) => ["teachers", "list", params ?? {}] as const,
  hods: ["teachers", "hods"] as const,
  teacher: (id: string) => ["teachers", "detail", id] as const,

  terms: ["terms"] as const,

  assignments: (termId?: string | null) =>
    ["assignments", termId ?? null] as const,

  attendance: (params?: ListParams) =>
    ["attendance", "sessions", params ?? {}] as const,
  register: (params?: ListParams) =>
    ["attendance", "register", params ?? {}] as const,
  sessionMonths: (courseId: string, termId?: string | null) =>
    ["attendance", "months", courseId, termId ?? null] as const,
  roster: (courseId: string) => ["roster", courseId] as const,
  classRoster: (courseId: string, termId?: string | null, month?: string | null) =>
    ["roster", "class", courseId, termId ?? null, month ?? null] as const,
  summary: (params?: ListParams) =>
    ["attendance", "summary", params ?? {}] as const,
  breakdown: (studentId: string, termId?: string | null) =>
    ["attendance", "breakdown", studentId, termId ?? null] as const,
  redFlags: (termId?: string | null) =>
    ["attendance", "red-flags", termId ?? null] as const,

  audit: (params?: ListParams) => ["audit", "list", params ?? {}] as const,
  lockHistory: ["audit", "lock-history"] as const,

  materials: (params?: ListParams) => ["materials", "list", params ?? {}] as const,

  users: (params?: ListParams) => ["users", "list", params ?? {}] as const,
  userDirectory: ["users", "directory"] as const,

  dashboard: (termId?: string | null) => ["stats", "dashboard", termId ?? null] as const,
  unstaffed: (termId?: string | null, semesters?: number[]) =>
    ["stats", "unstaffed", termId ?? null, semesters ?? null] as const,
  shortfall: (termId?: string | null, minPct?: number) =>
    ["stats", "shortfall", termId ?? null, minPct ?? null] as const,
}
