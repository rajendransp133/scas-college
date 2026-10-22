import { describe, expect, it } from "vitest"
import { canManageRole, homePath, isPathAllowed, roleCapabilities } from "@/lib/permissions"
import type { UserRole } from "@/lib/types"

const ALL_ROLES: UserRole[] = [
  "admin",
  "principal",
  "teacher",
  "attendance-manager",
  "hod",
  "student-rep",
]

describe("isPathAllowed()", () => {
  it("admin can reach everything, including /users and oversight pages", () => {
    expect(isPathAllowed("admin", "/users")).toBe(true)
    expect(isPathAllowed("admin", "/attendance/audit")).toBe(true)
    expect(isPathAllowed("admin", "/attendance/sessions")).toBe(true)
    expect(isPathAllowed("admin", "/anything/at/all")).toBe(true)
  })

  it("teacher cannot reach /users", () => {
    expect(isPathAllowed("teacher", "/users")).toBe(false)
  })

  it("teacher can reach attendance marking + materials", () => {
    expect(isPathAllowed("teacher", "/attendance")).toBe(true)
    expect(isPathAllowed("teacher", "/attendance/register")).toBe(true)
    expect(isPathAllowed("teacher", "/materials")).toBe(true)
  })

  // The trickiest rule: /attendance/audit (and its /log subpath) is a prefix
  // match excluded from the /attendance grant for teacher/hod, even though it
  // lives under /attendance.
  it("excludes /attendance/audit (and /attendance/audit/log) from the /attendance grant for teacher/hod", () => {
    for (const role of ["teacher", "hod"] as const) {
      expect(isPathAllowed(role, "/attendance/audit")).toBe(false)
      expect(isPathAllowed(role, "/attendance/audit/log")).toBe(false)
      // but the plain /attendance prefix is still allowed for these roles
      expect(isPathAllowed(role, "/attendance")).toBe(true)
    }
  })

  // The attendance-manager may freeze records, so it reaches the oversight page
  // itself — but never the log beneath it (no viewAudit).
  it("lets attendance-manager open /attendance/audit but not /attendance/audit/log", () => {
    expect(isPathAllowed("attendance-manager", "/attendance/audit")).toBe(true)
    expect(isPathAllowed("attendance-manager", "/attendance/audit/log")).toBe(false)
  })

  it("also excludes /attendance/sessions for teacher, hod and principal (admin/attendance-manager only)", () => {
    for (const role of ["teacher", "hod", "principal"] as const) {
      expect(isPathAllowed(role, "/attendance/sessions")).toBe(false)
    }
    // attendance-manager IS allowed on /attendance/sessions (session mgmt is admin/att-mgr only)
    expect(isPathAllowed("attendance-manager", "/attendance/sessions")).toBe(true)
    expect(isPathAllowed("admin", "/attendance/sessions")).toBe(true)
  })

  it("principal can reach everything except the oversight pages", () => {
    expect(isPathAllowed("principal", "/students")).toBe(true)
    expect(isPathAllowed("principal", "/attendance")).toBe(true)
    expect(isPathAllowed("principal", "/semester-close")).toBe(true)
    // Principals manage accounts too — minus admin ones, see canManageRole().
    expect(isPathAllowed("principal", "/users")).toBe(true)
    expect(isPathAllowed("principal", "/attendance/audit")).toBe(false)
    expect(isPathAllowed("principal", "/attendance/sessions")).toBe(false)
  })

  it("hod is scoped to dashboard/students/teachers/programs/attendance/materials", () => {
    expect(isPathAllowed("hod", "/")).toBe(true)
    expect(isPathAllowed("hod", "/students")).toBe(true)
    expect(isPathAllowed("hod", "/teachers")).toBe(true)
    expect(isPathAllowed("hod", "/programs")).toBe(true)
    expect(isPathAllowed("hod", "/attendance")).toBe(true)
    expect(isPathAllowed("hod", "/materials")).toBe(true)
    expect(isPathAllowed("hod", "/users")).toBe(false)
    expect(isPathAllowed("hod", "/promotions")).toBe(false)
  })

  it("attendance-manager is scoped to attendance pages only (oversight page yes, audit log no)", () => {
    expect(isPathAllowed("attendance-manager", "/attendance")).toBe(true)
    expect(isPathAllowed("attendance-manager", "/attendance/register")).toBe(true)
    expect(isPathAllowed("attendance-manager", "/attendance/audit/log")).toBe(false)
    expect(isPathAllowed("attendance-manager", "/students")).toBe(false)
    expect(isPathAllowed("attendance-manager", "/materials")).toBe(false)
  })

  it("student-rep is locked to /materials", () => {
    expect(isPathAllowed("student-rep", "/materials")).toBe(true)
    expect(homePath("student-rep")).toBe("/materials")
    // No attendance page at all, nor anything else
    expect(isPathAllowed("student-rep", "/attendance/register")).toBe(false)
    expect(isPathAllowed("student-rep", "/attendance/summary")).toBe(false)
    expect(isPathAllowed("student-rep", "/attendance")).toBe(false)
    expect(isPathAllowed("student-rep", "/attendance/audit")).toBe(false)
    expect(isPathAllowed("student-rep", "/attendance/sessions")).toBe(false)
    expect(isPathAllowed("student-rep", "/students")).toBe(false)
    expect(isPathAllowed("student-rep", "/users")).toBe(false)
  })

  it("subpaths of an allowed prefix are also allowed (prefix matching)", () => {
    expect(isPathAllowed("teacher", "/attendance/register")).toBe(true)
    expect(isPathAllowed("student-rep", "/materials/anything")).toBe(true)
  })
})

describe("roleCapabilities()", () => {
  it("null role (logged out) has no rights at all", () => {
    const caps = roleCapabilities(null)
    expect(caps.markScope).toBe("none")
    expect(caps.materialScope).toBe("none")
    expect(caps.overrideLock).toBe(false)
    expect(caps.viewAudit).toBe(false)
    expect(caps.manageUsers).toBe(false)
    expect(caps.manageAcademics).toBe(false)
  })

  it("admin: markScope all, overrideLock true, viewAudit true", () => {
    const caps = roleCapabilities("admin")
    expect(caps.markScope).toBe("all")
    expect(caps.overrideLock).toBe(true)
    expect(caps.viewAudit).toBe(true)
    expect(caps.lockAttendance).toBe(true)
    expect(caps.manageUsers).toBe(true)
  })

  it("teacher: markScope own, no overrideLock, no viewAudit", () => {
    const caps = roleCapabilities("teacher")
    expect(caps.markScope).toBe("own")
    expect(caps.overrideLock).toBe(false)
    expect(caps.viewAudit).toBe(false)
    expect(caps.editAttendance).toBe(false)
    expect(caps.materialScope).toBe("own")
  })

  it("attendance-manager: markScope all + overrideLock + lockAttendance, but viewAudit stays false (admin only)", () => {
    const caps = roleCapabilities("attendance-manager")
    expect(caps.markScope).toBe("all")
    expect(caps.overrideLock).toBe(true)
    expect(caps.editAttendance).toBe(true)
    expect(caps.deleteAttendance).toBe(true)
    expect(caps.viewAudit).toBe(false)
    expect(caps.lockAttendance).toBe(true)
  })

  it("principal: manageUsers + manageAcademics + markScope all, but no correction/oversight rights", () => {
    const caps = roleCapabilities("principal")
    // Account management is granted, but only partially — see canManageRole().
    expect(caps.manageUsers).toBe(true)
    expect(caps.manageAcademics).toBe(true)
    expect(caps.markScope).toBe("all")
    expect(caps.editAttendance).toBe(false)
    expect(caps.deleteAttendance).toBe(false)
    expect(caps.overrideLock).toBe(false)
    expect(caps.viewAudit).toBe(false)
    expect(caps.lockAttendance).toBe(false)
    expect(caps.materialScope).toBe("all")
    expect(caps.manageAllMaterials).toBe(true)
  })

  it("hod: markScope own (also teaches), dept-scoped viewer otherwise", () => {
    const caps = roleCapabilities("hod")
    expect(caps.markScope).toBe("own")
    expect(caps.materialScope).toBe("own")
    expect(caps.overrideLock).toBe(false)
    expect(caps.manageAcademics).toBe(false)
  })

  it("student-rep: no write access anywhere", () => {
    const caps = roleCapabilities("student-rep")
    expect(caps.markScope).toBe("none")
    expect(caps.materialScope).toBe("none")
    expect(caps.overrideLock).toBe(false)
    expect(caps.viewAudit).toBe(false)
  })

  it("viewStudentPii: held by admin/principal/hod, withheld from teacher/att-mgr/rep", () => {
    // Mirrors backend permissions.py — a teacher or class-rep sees the roster
    // (roll + name + status) but the server blanks personal fields for them.
    expect(roleCapabilities("admin").viewStudentPii).toBe(true)
    expect(roleCapabilities("principal").viewStudentPii).toBe(true)
    expect(roleCapabilities("hod").viewStudentPii).toBe(true)
    expect(roleCapabilities("teacher").viewStudentPii).toBe(false)
    expect(roleCapabilities("attendance-manager").viewStudentPii).toBe(false)
    expect(roleCapabilities("student-rep").viewStudentPii).toBe(false)
  })

  it("every role produces a capabilities object with all fields defined", () => {
    for (const role of ALL_ROLES) {
      const caps = roleCapabilities(role)
      expect(caps).toMatchObject({
        manageUsers: expect.any(Boolean),
        manageAcademics: expect.any(Boolean),
        viewStudentPii: expect.any(Boolean),
        editAttendance: expect.any(Boolean),
        deleteAttendance: expect.any(Boolean),
        overrideLock: expect.any(Boolean),
        viewAudit: expect.any(Boolean),
        lockAttendance: expect.any(Boolean),
        manageAllMaterials: expect.any(Boolean),
      })
      expect(["all", "own", "none"]).toContain(caps.markScope)
      expect(["all", "own", "none"]).toContain(caps.materialScope)
    }
  })
})

describe("canManageRole()", () => {
  it("admin may manage every role, including other admins", () => {
    for (const role of ALL_ROLES) {
      expect(canManageRole("admin", role)).toBe(true)
    }
  })

  it("principal may manage every role except admin", () => {
    // This is the whole reason granting principals manageUsers is safe: the
    // capability matrix withholds audit/lock/correction from them, and minting
    // an admin account would be a one-step route back to all of it.
    expect(canManageRole("principal", "admin")).toBe(false)
    for (const role of ALL_ROLES.filter((r) => r !== "admin")) {
      expect(canManageRole("principal", role)).toBe(true)
    }
  })

  it("roles without manageUsers may manage nobody", () => {
    for (const actor of ["teacher", "hod", "attendance-manager", "student-rep"] as const) {
      for (const target of ALL_ROLES) {
        expect(canManageRole(actor, target)).toBe(false)
      }
    }
  })

  it("logged out may manage nobody", () => {
    for (const role of ALL_ROLES) {
      expect(canManageRole(null, role)).toBe(false)
    }
  })
})
