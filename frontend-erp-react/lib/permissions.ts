"use client"

// Role-based permissions, mirroring the backend's `permissions.py` 1:1. The
// server enforces these; this copy drives the UI. Single source of truth:
// pages read capability flags from useAuth() instead of checking roles inline.

import { useMemo } from "react"
import { useAssignments, useMe, useSettings, useTeacher } from "@/lib/queries"
import { EMPTY_ARRAY } from "@/lib/api"
import type { Teacher, User, UserRole } from "@/lib/types"

export interface Capabilities {
  /** Create/edit/delete login accounts (Users page). */
  manageUsers: boolean
  /** CRUD on departments, programs, students, teachers, promotions, assignments. */
  manageAcademics: boolean
  /**
   * May read a student's *personal* fields (contact, address, DOB, guardian) —
   * distinct from which students are in reach at all. Held by admin/principal/hod;
   * a teacher or class-rep sees the roster (roll + name + status) with these
   * blanked server-side. UI copy: hide the PII columns/cards when this is false.
   */
  viewStudentPii: boolean
  /**
   * Who may create a new attendance session: any course ("all"), only courses
   * assigned to the account's linked teacher ("own" — first-time only unless
   * editAttendance is also true), or nobody ("none").
   */
  markScope: "all" | "own" | "none"
  /** Re-save an existing attendance session / edit saved records. */
  editAttendance: boolean
  /** Delete an attendance session. */
  deleteAttendance: boolean
  /**
   * Edit/delete attendance for dates ≤ lockDate. Roles without it (teachers,
   * HODs, reps) are hard-blocked by the store once a date is locked.
   */
  overrideLock: boolean
  /** See the audit log / oversight page. */
  viewAudit: boolean
  /** Lock attendance up to a date (freezes it for non-override roles). */
  lockAttendance: boolean
  /**
   * Who may upload study materials: to any course ("all"), only to courses
   * assigned to the account's linked teacher ("own"), or nobody ("none").
   */
  materialScope: "all" | "own" | "none"
  /** Delete anyone's study material (uploaders can always delete their own). */
  manageAllMaterials: boolean
}

const NONE: Capabilities = {
  manageUsers: false,
  manageAcademics: false,
  viewStudentPii: false,
  markScope: "none",
  editAttendance: false,
  deleteAttendance: false,
  overrideLock: false,
  viewAudit: false,
  lockAttendance: false,
  materialScope: "none",
  manageAllMaterials: false,
}

const CAPABILITIES: Record<UserRole, Capabilities> = {
  admin: {
    manageUsers: true,
    manageAcademics: true,
    viewStudentPii: true,
    markScope: "all",
    editAttendance: true,
    deleteAttendance: true,
    overrideLock: true,
    viewAudit: true,
    lockAttendance: true,
    materialScope: "all",
    manageAllMaterials: true,
  },
  // A principal may also teach (optional linked teacher record), but their
  // "all" scope already covers marking any course. Correction and oversight
  // belong to the administrator alone — the principal cannot edit or delete
  // saved attendance, read the audit log, or freeze records. They still run the
  // Semester Close-Out checklist (gated on manageAcademics).
  //
  // manageUsers is *partial* for principals: the backend
  // (`services/users.py::assert_may_manage`) refuses any write touching an
  // `admin` account, because minting one would be a one-step escalation into
  // exactly the oversight powers withheld above. `canManageRole()` below
  // mirrors that so the UI doesn't offer a request the API will reject.
  principal: {
    manageUsers: true,
    manageAcademics: true,
    viewStudentPii: true,
    markScope: "all",
    editAttendance: false,
    deleteAttendance: false,
    overrideLock: false,
    viewAudit: false,
    lockAttendance: false,
    materialScope: "all",
    manageAllMaterials: true,
  },
  teacher: {
    ...NONE,
    markScope: "own", // first-time only; blocked once a session exists
    materialScope: "own",
  },
  // Runs the registers day to day, so it also freezes them (the oversight
  // page's freeze card) — but no viewAudit: the red flags and the log watch the
  // people who correct attendance, this role included.
  "attendance-manager": {
    ...NONE,
    markScope: "all",
    editAttendance: true,
    deleteAttendance: true,
    overrideLock: true,
    lockAttendance: true,
  },
  // HODs also teach: they can take first-time attendance for their own
  // assigned courses, but everything else stays view-only, dept-scoped.
  hod: {
    ...NONE,
    viewStudentPii: true,
    markScope: "own",
    materialScope: "own",
  },
  // One shared read-only account per class — Study Materials only (no
  // attendance, no rosters); the backend refuses those reads with a 403.
  "student-rep": NONE,
}

/**
 * Pure capability lookup — used by the store's lock guard (which has no React
 * context) as well as useAuth() below. Null role = logged out = no rights.
 */
export function roleCapabilities(role: UserRole | null): Capabilities {
  return role ? CAPABILITIES[role] : NONE
}

/**
 * Whether `actor` may create/edit/delete an account whose role is `target`.
 *
 * Mirrors the server-side guard in `services/users.py::assert_may_manage`:
 * admin accounts are administrator-only, so a principal with `manageUsers`
 * can't promote themselves (or anyone) into the oversight role.
 */
export function canManageRole(
  actor: UserRole | null,
  target: UserRole,
): boolean {
  if (!roleCapabilities(actor).manageUsers) return false
  return target !== "admin" || actor === "admin"
}

/** Route prefixes each role may visit. Admin/principal are handled as "all". */
const ATTENDANCE_ROUTES = ["/attendance"]
const TEACHER_ROUTES = ["/attendance", "/materials"]
const HOD_ROUTES = [
  "/", // dept-scoped dashboard (exact match only — matches() prefixes with "p/")
  "/students",
  "/teachers",
  "/programs",
  "/attendance",
  "/materials",
]
const STUDENT_REP_ROUTES = ["/materials"]
/** Oversight page — admin only, even though it lives under /attendance. The
 * attendance-manager is the exception: it may open the page itself (to freeze
 * records) but not the log beneath it. */
const AUDIT_ROUTE = "/attendance/audit"
const AUDIT_LOG_ROUTE = "/attendance/audit/log"
/** Session management — admin/attendance-manager only; everyone else views
 * saved attendance in the Register instead. */
const SESSIONS_ROUTE = "/attendance/sessions"

const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"))

export function isPathAllowed(role: UserRole, pathname: string): boolean {
  switch (role) {
    case "admin":
      return true
    case "principal":
      // Everything except the admin-only oversight pages. /users is reachable
      // (principals manage accounts, minus admin ones — see canManageRole);
      // /semester-close stays reachable too — the checklist is the principal's.
      return !matches(pathname, [AUDIT_ROUTE, SESSIONS_ROUTE])
    case "teacher":
      return (
        matches(pathname, TEACHER_ROUTES) &&
        !matches(pathname, [AUDIT_ROUTE, SESSIONS_ROUTE])
      )
    case "attendance-manager":
      return (
        matches(pathname, ATTENDANCE_ROUTES) &&
        !matches(pathname, [AUDIT_LOG_ROUTE])
      )
    case "hod":
      return (
        matches(pathname, HOD_ROUTES) &&
        !matches(pathname, [AUDIT_ROUTE, SESSIONS_ROUTE])
      )
    case "student-rep":
      return matches(pathname, STUDENT_REP_ROUTES)
  }
}

/** Where each role lands after login or a blocked navigation. */
export function homePath(role: UserRole): string {
  switch (role) {
    case "admin":
    case "principal":
      return "/"
    case "teacher":
    case "attendance-manager":
      return "/attendance"
    case "hod":
      return "/"
    case "student-rep":
      return "/materials"
  }
}

export interface Auth {
  user: User | null
  role: UserRole | null
  /** Teacher record linked to the account (teacher/hod required, principal optional). */
  teacher: Teacher | null
  /** HOD's own department (from the linked teacher). Null for other roles. */
  departmentId: string | null
  /** Student rep's class (program + semester). Null for other roles. */
  classScope: { programId: string; semester: number } | null
  can: Capabilities
  /** Course ids assigned to the account's linked teacher for a term. Empty when
   * unlinked. Only the current term is loaded, so other terms read as empty. */
  ownCourseIds: (termId: string) => Set<string>
}

export function useAuth(): Auth {
  // Backed by the API now: /auth/me supplies the user + derived scope
  // (departmentId for HODs, class program/semester for reps); assignments drive
  // "own courses". The public Auth shape is unchanged so consumers don't care.
  const { data: me } = useMe()
  const user = me?.user ?? null
  const { data: teacher = null } = useTeacher(user?.teacherId)
  // Own courses only matter for an account with a linked teacher, and every
  // caller asks about the current term — so that is all this loads (it used to
  // fetch every term's assignments for every role, admins and reps included).
  const { data: settings } = useSettings()
  const { data: assignments = EMPTY_ARRAY } = useAssignments(
    settings?.currentTermId,
    !!user?.teacherId && !!settings?.currentTermId,
  )

  return useMemo(() => {
    const role = user?.role ?? null
    const linkedTeacher = user?.teacherId ? teacher : null
    return {
      user,
      role,
      teacher: linkedTeacher,
      departmentId: me?.departmentId ?? null,
      classScope:
        me?.classProgramId != null && me?.classSemester != null
          ? { programId: me.classProgramId, semester: me.classSemester }
          : null,
      can: role ? CAPABILITIES[role] : NONE,
      // Any account with a linked teacher record (teacher, HOD, principal…)
      // has "own courses" — whoever takes the class can mark its attendance.
      ownCourseIds: (termId: string) =>
        linkedTeacher
          ? new Set(
              assignments
                .filter(
                  (a) => a.teacherId === linkedTeacher.id && a.termId === termId,
                )
                .map((a) => a.courseId),
            )
          : new Set<string>(),
    }
  }, [user, teacher, me, assignments])
}
