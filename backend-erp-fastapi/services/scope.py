"""Server-side read scoping — which slice of the college an account may see.

Until this module existed, scoping was a *client* concern: `lib/permissions.ts`
kept a student-rep on `/attendance/register` and preset the HOD's department
filter, while every read endpoint accepted whatever `courseId`/`departmentId`
the caller sent. Changing one query parameter was enough for a class-rep login —
a password shared by an entire class — to pull any other class's register, any
roster (with addresses, dates of birth and guardian phone numbers) and the
college-wide attendance summary.

The rule here is the one the rest of the codebase already assumed:

    a caller may read a class only if `view_scope` puts that class in reach.

Two shapes, because the two questions differ:

* **course-set** (`visible_course_ids`) — attendance lives on courses. `None`
  means "no restriction"; a set (possibly empty) is the whitelist.
* **class-pairs** (`visible_class_keys`) — students live in a
  (program, semester) class. Same `None` convention.

Both are derived from the same assignments/department/class facts, so a role
can never see a course through one door and not the other.
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import Select, and_, false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import services.cache as cache_keys
from models import Course, Program, Semester, Student, Teacher, User
from permissions import role_capabilities
from services.cache import cached

# A class: the (program_id, semester_number) pair a cohort sits in.
ClassKey = tuple[str, int]


async def dept_course_ids(db: AsyncSession, department_id: str) -> set[str]:
    """Every course of a department's programs. A three-table join that an HOD
    would otherwise run on every read, so it is cached per department and
    dropped by `invalidate_curriculum()`. Returned as a fresh set — callers
    union into it."""

    async def load() -> list[str]:
        rows = await db.execute(
            select(Course.id)
            .join(Semester, Course.semester_id == Semester.id)
            .join(Program, Semester.program_id == Program.id)
            .where(Program.department_id == department_id)
        )
        return sorted(r[0] for r in rows.all())

    return set(await cached(f"{cache_keys.DEPT_COURSES}:{department_id}", load))


async def class_course_ids(
    db: AsyncSession, program_id: str, semester_number: int
) -> set[str]:
    rows = await db.execute(
        select(Course.id)
        .join(Semester, Course.semester_id == Semester.id)
        .where(Semester.program_id == program_id, Semester.number == semester_number)
    )
    return {r[0] for r in rows.all()}


async def hod_department_id(db: AsyncSession, user: User) -> Optional[str]:
    """An HOD's department comes from the linked teacher record, never from a
    request parameter — that indirection is the whole point."""
    if not user.teacher_id:
        return None
    teacher = await db.get(Teacher, user.teacher_id)
    return teacher.department_id if teacher else None


async def _own_course_ids(db: AsyncSession, user: User, term_id: Optional[str]) -> set[str]:
    if not user.teacher_id or not term_id:
        return set()
    # Imported here: deps imports services.cache, and services.* importing deps
    # at module level closes the loop.
    from deps import own_course_ids as _cached_own

    return await _cached_own(db, user, term_id)


async def visible_course_ids(
    db: AsyncSession, user: User, term_id: Optional[str]
) -> Optional[set[str]]:
    """Course ids this caller may read. `None` = unrestricted."""
    scope = role_capabilities(user.role).view_scope
    if scope == "all":
        return None
    if scope == "own":
        return await _own_course_ids(db, user, term_id)
    if scope == "department":
        # A copy, never the set `own_course_ids` handed back: the in-memory
        # cache once returned its own stored set here, and the `|=` below wrote
        # the whole department into the HOD's cached *own* courses — the set
        # `ensure_can_mark` / `ensure_can_upload` trust.
        ids = set(await _own_course_ids(db, user, term_id))
        department_id = await hod_department_id(db, user)
        if department_id:
            ids |= await dept_course_ids(db, department_id)
        return ids
    if scope == "class":
        if user.program_id and user.class_semester:
            return await class_course_ids(db, user.program_id, user.class_semester)
        return set()
    return set()


async def visible_class_keys(
    db: AsyncSession, user: User, term_id: Optional[str]
) -> Optional[set[ClassKey]]:
    """(program, semester) pairs this caller may read students from.

    `None` = unrestricted. An HOD is handled by department instead — see
    `apply_student_scope`, which needs the department as a column filter rather
    than an enumerated pair list.
    """
    scope = role_capabilities(user.role).view_scope
    if scope == "all":
        return None
    if scope == "class":
        if user.program_id and user.class_semester:
            return {(user.program_id, user.class_semester)}
        return set()
    # teacher / hod: the classes behind their assigned courses.
    course_ids = await _own_course_ids(db, user, term_id)
    if not course_ids:
        return set()
    rows = await db.execute(
        select(Semester.program_id, Semester.number)
        .join(Course, Course.semester_id == Semester.id)
        .where(Course.id.in_(course_ids))
    )
    return {(r[0], r[1]) for r in rows.all()}


async def aggregate_department_scope(
    db: AsyncSession, user: User
) -> Optional[str]:
    """The department a college-level aggregate (`/stats/*`) is narrowed to.

    `None` = the whole college. Those counters only make sense at college or
    department grain, so roles scoped narrower than a department (teacher,
    student-rep) get a 403 rather than a college-wide figure they may not read.
    """
    scope = role_capabilities(user.role).view_scope
    if scope == "all":
        return None
    if scope == "department":
        department_id = await hod_department_id(db, user)
        if department_id:
            return department_id
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="College-wide statistics are not available to this account",
    )


async def assert_course_visible(
    db: AsyncSession, user: User, course_id: str, term_id: Optional[str]
) -> None:
    """403 unless the caller may read this course.

    Deliberately the same message and status for "out of scope" as for
    "no scope at all" — a caller probing course ids learns nothing from the
    difference.
    """
    visible = await visible_course_ids(db, user, term_id)
    if visible is None or course_id in visible:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have access to this class",
    )


async def apply_course_scope(
    stmt: Select, db: AsyncSession, user: User, term_id: Optional[str], column
) -> Select:
    """Narrow a statement to the caller's courses via `column` (a course_id).

    An empty scope yields an impossible predicate rather than an unfiltered
    query — `in_(set())` is the failure mode that quietly returns everything if
    written by hand.
    """
    visible = await visible_course_ids(db, user, term_id)
    if visible is None:
        return stmt
    if not visible:
        return stmt.where(false())
    return stmt.where(column.in_(visible))


async def apply_student_scope(
    stmt: Select, db: AsyncSession, user: User, term_id: Optional[str]
) -> Select:
    """Narrow a Student query to the caller's scope.

    An HOD filters on the department column: students of the department are in
    reach whether or not their class currently has a course this term, which an
    assignment-derived pair list would miss.
    """
    scope = role_capabilities(user.role).view_scope
    if scope == "all":
        return stmt
    if scope == "none":
        return stmt.where(false())

    clauses = []
    if scope == "department":
        department_id = await hod_department_id(db, user)
        if department_id:
            clauses.append(Student.department_id == department_id)

    keys = await visible_class_keys(db, user, term_id)
    if keys:
        clauses.extend(
            and_(
                Student.program_id == program_id,
                Student.current_semester == semester,
            )
            for program_id, semester in keys
        )

    if not clauses:
        return stmt.where(false())
    return stmt.where(or_(*clauses))


async def assert_student_visible(
    db: AsyncSession, user: User, student: Student, term_id: Optional[str]
) -> None:
    """403 unless this student falls inside the caller's scope."""
    scope = role_capabilities(user.role).view_scope
    if scope == "all":
        return
    if scope == "department":
        department_id = await hod_department_id(db, user)
        if department_id and student.department_id == department_id:
            return
    keys = await visible_class_keys(db, user, term_id)
    if keys and (student.program_id, student.current_semester) in keys:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have access to this student",
    )
