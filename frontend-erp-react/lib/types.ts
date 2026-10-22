// Domain types for the College ERP. These mirror the FastAPI backend's
// schemas 1:1 (camelCase JSON); the backend is the source of truth.

export type ID = string

export interface Department {
  id: ID
  name: string
  code: string
}

export const PROGRAM_LEVELS = ["UG", "PG", "PhD"] as const

export type ProgramLevel = (typeof PROGRAM_LEVELS)[number]

/** Human-readable name for each program level. */
export const PROGRAM_LEVEL_LABELS: Record<ProgramLevel, string> = {
  UG: "Undergraduate",
  PG: "Postgraduate",
  PhD: "Doctoral",
}

export interface Program {
  id: ID
  name: string
  code: string
  /** Foreign key → Department.id */
  departmentId: ID
  /** Academic level: undergraduate, postgraduate, or doctoral. */
  level: ProgramLevel
}

export const COURSE_TYPES = [
  "Core",
  "Elective",
  "Professional Core",
  "Professional Elective",
  "Lab",
  "Open Elective",
  "Audit",
] as const

export type CourseType = (typeof COURSE_TYPES)[number]

export interface Course {
  id: ID
  name: string
  code: string
  credits: number
  type?: CourseType
}

export interface Semester {
  id: ID
  /** Foreign key → Program.id */
  programId: ID
  /** Unique per program (number, programId) */
  number: number
  courses: Course[]
}

export type Gender = "male" | "female" | "other"

/**
 * Only the identity pair (roll number + name) and the class placement
 * (department/program/semester, which decide the attendance roster) are
 * required at intake. Everything else is optional and back-fillable — the
 * registrar rarely has it all on enrolment day.
 */
export interface Student {
  id: ID
  /** Unique, human-facing identifier. Locked once the student exists. */
  rollNumber: string
  name: string
  /** Foreign key → Department.id */
  departmentId: ID
  /** Foreign key → Program.id */
  programId: ID
  currentSemester: number
  email?: string | null
  phone?: string | null
  address?: string | null
  dateOfBirth?: string | null // ISO yyyy-mm-dd
  gender?: Gender | null
  admissionYear?: number | null
  guardianName?: string | null
  guardianRelation?: string | null
  guardianPhone?: string | null
  /** Soft-delete flag. */
  isActive: boolean
  /** Lifecycle flag: completed the program. Excluded from class rosters. */
  graduated?: boolean
}

export const DESIGNATIONS = [
  "Professor",
  "Associate Professor",
  "Assistant Professor",
  "Lecturer",
] as const

export type Designation = (typeof DESIGNATIONS)[number]

/**
 * Only the identity pair (employee id + name) and the department are required.
 * The department stays mandatory because it decides HOD-ship and course
 * assignment; everything else is optional and back-fillable, the same way
 * {@link Student} works at intake.
 */
export interface Teacher {
  id: ID
  /** Unique employee identifier. Locked once the teacher exists. */
  employeeId: string
  name: string
  /** Foreign key → Department.id */
  departmentId: ID
  /** Defaults to "Assistant Professor" server-side when omitted. */
  designation: Designation
  /** At most one HOD per department. */
  isHod: boolean
  email?: string | null
  phone?: string | null
  qualification?: string | null
  joiningDate?: string | null // ISO yyyy-mm-dd
}

/** Which half of the academic year a term is: odd semesters run in "odd" terms. */
export type TermParity = "odd" | "even"

/**
 * An academic term, defined by its academic year + parity (e.g. 2026 + "odd"
 * = "2026-27 (Odd)"). Unique on `(startYear, parity)`; `endYear` is always
 * `startYear + 1` and `name` is derived via `termLabel()` at creation.
 * Teaching staff are assigned per term, so the teacher for a course can differ
 * each term. One term is the "current" one (see `currentTermId` in the store).
 */
export interface AcademicTerm {
  id: ID
  /** Derived display label, e.g. "2026-27 (Odd)". */
  name: string
  /** First calendar year of the academic year, e.g. 2026 for 2026-27. */
  startYear: number
  /** Always `startYear + 1`. */
  endYear: number
  parity: TermParity
}

/** Display label for a term: `termLabel(2026, "odd")` → `"2026-27 (Odd)"`. */
export const termLabel = (startYear: number, parity: TermParity) =>
  `${startYear}-${String(startYear + 1).slice(2)} (${parity === "odd" ? "Odd" : "Even"})`

/**
 * Whether a semester number is in session for a term: odd terms hold the
 * odd-numbered semesters, even terms the even ones. No term ⇒ everything is
 * in session (so callers degrade gracefully while the store hydrates).
 */
export const semesterInSession = (
  semNumber: number,
  term: AcademicTerm | null | undefined,
) => !term || (semNumber % 2 === 1) === (term.parity === "odd")

/**
 * Teaching assignment: links a teacher to a single course **for one term**.
 * A course is owned by exactly one Semester (and therefore one Program), so the
 * course id already pins down the program + semester. A course may have
 * **multiple teachers per term** (from any department — cross-department
 * teaching is allowed); unique on `(courseId, teacherId, termId)`. All of a
 * course's teachers share the same attendance register.
 */
export interface CourseAssignment {
  id: ID
  /** Foreign key → Course.id */
  courseId: ID
  /** Foreign key → Teacher.id */
  teacherId: ID
  /** Foreign key → AcademicTerm.id */
  termId: ID
}

export const USER_ROLES = [
  "admin",
  "principal",
  "teacher",
  "attendance-manager",
  "hod",
  "student-rep",
] as const

export type UserRole = (typeof USER_ROLES)[number]

/** Human-readable name for each login role. */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  principal: "Principal",
  teacher: "Teacher",
  "attendance-manager": "Attendance Manager",
  hod: "HOD",
  "student-rep": "Student Representative",
}

/**
 * A login account.
 *
 * `password` is **write-only**: it is sent when creating an account or
 * changing one, and the API never returns it (the server stores a bcrypt
 * hash). Responses are typed `Omit<User, "password">` at the call sites.
 */
export interface User {
  id: ID
  name: string
  /** Unique, case-insensitive login identifier. */
  email: string
  password: string
  role: UserRole
  /**
   * Foreign key → Teacher.id. Required for "teacher" and "hod" roles: a
   * teacher's own courses and an HOD's department are derived from the
   * linked Teacher record. Optional for "principal" (who may also teach).
   */
  teacherId?: ID
  /**
   * "student-rep" only: the class the shared account belongs to.
   * **One rep account per (programId, classSemester)** — the whole class
   * shares this login, read-only.
   */
  /** Foreign key → Program.id */
  programId?: ID
  classSemester?: number
  /**
   * Soft-disable flag. A departing/suspended account is deactivated (its login
   * is rejected server-side) rather than deleted, so its audit-actor links
   * survive. Always present on responses; omitted on create (defaults active).
   */
  isActive?: boolean
}

export type AttendanceStatus = "present" | "absent" | "late" | "od"

export interface AttendanceRecord {
  /** Foreign key → Student.id */
  studentId: ID
  status: AttendanceStatus
  /**
   * Audit trail: set on the FIRST correction only, preserving what was
   * originally marked. A record with `originalStatus` renders a "corrected"
   * marker in the register — visible to every viewer, including the class.
   */
  originalStatus?: AttendanceStatus
  /** Foreign key → User.id — who made the latest correction. */
  editedBy?: ID
  /** ISO datetime of the latest correction. */
  editedAt?: string
}

/**
 * One class meeting for a course on a date. Unique on (courseId, date).
 * The roster is derived (active, non-graduated students in the course's
 * program whose currentSemester matches the course's semester number).
 */
export interface AttendanceSession {
  id: ID
  /** Foreign key → Course.id */
  courseId: ID
  /** Foreign key → AcademicTerm.id — the term this class was held in. */
  termId: ID
  /** ISO yyyy-mm-dd */
  date: string
  /** 1-based class hour/period on that date. Unique on (courseId, date, period). */
  period: number
  records: AttendanceRecord[]
  /** Foreign key → User.id — who created the session. */
  markedBy?: ID
  /** ISO datetime the session was created. */
  markedAt?: string
}

export const AUDIT_ACTIONS = [
  "mark",
  "edit",
  // One student dropped from a session that still exists. Its own action, not
  // an "edit", because removing a record also removes the originalStatus trail
  // corrections leave behind — this entry is the only remaining evidence.
  "remove-record",
  "delete-session",
  "lock",
  "unlock",
  // Administrative changes — accounts, students, teachers, curriculum,
  // assignments, terms. Mirrors backend enums/AuditAction.py. They carry no
  // termId (except assignments), so the log shows them in every term; the
  // entity is named in `note`.
  "create-user",
  "update-user",
  "delete-user",
  "change-password",
  "create-student",
  "update-student",
  "delete-student",
  "promote-students",
  "graduate-students",
  "create-teacher",
  "update-teacher",
  "delete-teacher",
  "create-department",
  "update-department",
  "delete-department",
  "create-program",
  "update-program",
  "delete-program",
  "create-semester",
  "delete-semester",
  "create-course",
  "delete-course",
  "assign-course",
  "unassign-course",
  "create-term",
  "set-current-term",
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** Human-readable name for each audit action. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  mark: "Marked",
  edit: "Corrected",
  "remove-record": "Removed student",
  "delete-session": "Deleted session",
  lock: "Locked",
  unlock: "Unlocked",
  "create-user": "Created account",
  "update-user": "Updated account",
  "delete-user": "Deleted account",
  "change-password": "Changed password",
  "create-student": "Added student",
  "update-student": "Updated student",
  "delete-student": "Deleted student",
  "promote-students": "Promoted students",
  "graduate-students": "Graduated students",
  "create-teacher": "Added teacher",
  "update-teacher": "Updated teacher",
  "delete-teacher": "Deleted teacher",
  "create-department": "Added department",
  "update-department": "Updated department",
  "delete-department": "Deleted department",
  "create-program": "Added program",
  "update-program": "Updated program",
  "delete-program": "Deleted program",
  "create-semester": "Added semester",
  "delete-semester": "Deleted semester",
  "create-course": "Added course",
  "delete-course": "Deleted course",
  "assign-course": "Assigned teacher",
  "unassign-course": "Unassigned teacher",
  "create-term": "Added term",
  "set-current-term": "Changed current term",
}

/**
 * Append-only log of every attendance mutation: who did what, when, and
 * (for corrections) the before → after statuses. Entries are never deleted —
 * they survive even when the session or student they reference is removed.
 */
export interface AuditEntry {
  id: ID
  /** ISO datetime. */
  at: string
  /** Foreign key → User.id — who performed the action. */
  userId: ID
  action: AuditAction
  /** Foreign key → Course.id */
  courseId?: ID
  /** Foreign key → AcademicTerm.id */
  termId?: ID
  /** Session date (ISO yyyy-mm-dd). */
  date?: string
  period?: number
  /** Foreign key → Student.id */
  studentId?: ID
  /** Correction: status before the change. */
  from?: AttendanceStatus
  /** Correction: status after the change. */
  to?: AttendanceStatus
  /** Free text — tombstone counts, lock date… */
  note?: string
}

/**
 * Study material a teacher shares with a class. A **link**, not a file: the
 * backend stores only the URL (no blob column, no download endpoint), and the
 * card's thumbnail is derived from the URL client-side by `lib/material-link.ts`.
 */
export interface StudyMaterial {
  id: ID
  /** Foreign key → Course.id — the class is the course's program+semester roster. */
  courseId: ID
  /** Foreign key → AcademicTerm.id — the term when shared (display only). */
  termId: ID
  title: string
  description?: string
  /** The shared link — always an absolute http(s) URL (validated server-side). */
  url: string
  /** Foreign key → User.id — stamped by the server. */
  uploadedBy: ID
  /** ISO datetime — stamped by the server. */
  uploadedAt: string
}
