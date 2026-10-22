"""Role capability matrix ported 1:1 from the frontend `lib/permissions.ts`."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from enums.UserRole import UserRoleEnum

Scope = str  # "all" | "own" | "none"

# How much of the college an account may *read*. Distinct from `mark_scope`
# (who may write attendance) and `material_scope` (who may share materials):
# an attendance-manager writes everywhere but a student-rep writes nowhere and
# still has to read something.
#
#   "all"        — the whole college
#   "department" — the HOD's own department, plus any class they personally
#                  teach (cross-department teaching is allowed)
#   "own"        — only the classes the linked teacher is assigned to this term
#   "class"      — the single (program, semester) a student-rep login is pinned to
#   "none"       — nothing
ViewScope = str


@dataclass(frozen=True)
class Capabilities:
    manage_users: bool = False
    manage_academics: bool = False
    view_scope: ViewScope = "none"
    # May read a student's *personal* fields (contact, address, date of birth,
    # guardian). Distinct from `view_scope`, which decides *which* students are
    # in reach at all: a teacher marking a register or a class-rep login can see
    # the roster (roll + name + status) but not classmates' home addresses or
    # guardian phone numbers. Held by roles with a pastoral/administrative need
    # for the record — admin, principal, HOD — not by teacher/att-mgr/rep.
    view_student_pii: bool = False
    mark_scope: Scope = "none"
    edit_attendance: bool = False
    delete_attendance: bool = False
    override_lock: bool = False
    view_audit: bool = False
    lock_attendance: bool = False
    material_scope: Scope = "none"
    manage_all_materials: bool = False


NONE = Capabilities()

CAPABILITIES: dict[UserRoleEnum, Capabilities] = {
    UserRoleEnum.ADMIN: Capabilities(
        manage_users=True,
        manage_academics=True,
        view_scope="all",
        view_student_pii=True,
        mark_scope="all",
        edit_attendance=True,
        delete_attendance=True,
        override_lock=True,
        view_audit=True,
        lock_attendance=True,
        material_scope="all",
        manage_all_materials=True,
    ),
    # The principal runs academics, manages login accounts and may take a
    # class, but correction and oversight are the administrator's alone: no
    # editing or deleting saved attendance, no lock override, no audit log, no
    # freezing records. Account management is deliberately *partial* — see
    # `services/users.py::assert_may_manage`: a principal cannot create, edit
    # or delete an `admin` account, which would otherwise be a one-step
    # escalation into exactly the oversight powers withheld above.
    UserRoleEnum.PRINCIPAL: Capabilities(
        manage_users=True,
        manage_academics=True,
        view_scope="all",
        view_student_pii=True,
        mark_scope="all",
        edit_attendance=False,
        delete_attendance=False,
        override_lock=False,
        view_audit=False,
        lock_attendance=False,
        material_scope="all",
        manage_all_materials=True,
    ),
    UserRoleEnum.TEACHER: Capabilities(
        view_scope="own", mark_scope="own", material_scope="own"
    ),
    # Runs the registers day to day, so it also freezes them: `lock_attendance`
    # (the oversight page's freeze card) — but not `view_audit`. The red flags
    # and the log watch the people who correct attendance, this role included,
    # so they stay with the administrator.
    UserRoleEnum.ATTENDANCE_MANAGER: Capabilities(
        view_scope="all",
        mark_scope="all",
        edit_attendance=True,
        delete_attendance=True,
        override_lock=True,
        lock_attendance=True,
    ),
    UserRoleEnum.HOD: Capabilities(
        view_scope="department",
        view_student_pii=True,
        mark_scope="own",
        material_scope="own",
    ),
    # Study Materials only (scoped to their class in services/materials.py).
    # The login is shared by the whole class, so anything it can reach is
    # effectively public to those students — attendance and rosters are not.
    UserRoleEnum.STUDENT_REP: Capabilities(view_scope="none"),
}


def role_capabilities(role: Optional[UserRoleEnum]) -> Capabilities:
    if role is None:
        return NONE
    return CAPABILITIES.get(role, NONE)
