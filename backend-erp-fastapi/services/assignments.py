from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import services.cache as cache_keys
from enums.AuditAction import AuditActionEnum
from ids import new_id
from models import CourseAssignment, User
from services.audit import make_audit
from services.cache import invalidate
from services.util import commit_or_raise, not_found

_CONFLICTS = {
    "uq_assignment_triple": "This teacher is already assigned to the course",
    "course_assignment_course_id_fkey": "Course not found",
    "course_assignment_teacher_id_fkey": "Teacher not found",
    "course_assignment_term_id_fkey": "Term not found",
}


async def list_assignments(
    db: AsyncSession, term_id: Optional[str] = None
) -> list[CourseAssignment]:
    stmt = select(CourseAssignment)
    if term_id:
        stmt = stmt.where(CourseAssignment.term_id == term_id)
    rows = await db.execute(stmt)
    return list(rows.scalars().all())


async def assign_teacher(
    db: AsyncSession, course_id: str, teacher_id: str, term_id: str, actor: User
) -> CourseAssignment:
    existing = await db.execute(
        select(CourseAssignment).where(
            CourseAssignment.course_id == course_id,
            CourseAssignment.teacher_id == teacher_id,
            CourseAssignment.term_id == term_id,
        )
    )
    found = existing.scalar_one_or_none()
    if found is not None:
        return found  # no-op if already assigned
    asg = CourseAssignment(
        id=new_id("asg"),
        course_id=course_id,
        teacher_id=teacher_id,
        term_id=term_id,
    )
    db.add(asg)
    db.add(
        make_audit(
            actor.id,
            AuditActionEnum.ASSIGN_COURSE,
            course_id=course_id,
            term_id=term_id,
            note=f"Assigned teacher {teacher_id}",
        )
    )
    await commit_or_raise(db, _CONFLICTS)
    await db.refresh(asg)
    # Teachers' "my courses" sets are cached per (teacher, term).
    await invalidate(cache_keys.ASSIGNMENTS)
    return asg


async def unassign_teacher(
    db: AsyncSession, course_id: str, teacher_id: str, term_id: str, actor: User
) -> None:
    existing = await db.execute(
        select(CourseAssignment).where(
            CourseAssignment.course_id == course_id,
            CourseAssignment.teacher_id == teacher_id,
            CourseAssignment.term_id == term_id,
        )
    )
    found = existing.scalar_one_or_none()
    if found is None:
        raise not_found("Assignment not found")
    db.add(
        make_audit(
            actor.id,
            AuditActionEnum.UNASSIGN_COURSE,
            course_id=course_id,
            term_id=term_id,
            note=f"Unassigned teacher {teacher_id}",
        )
    )
    await db.delete(found)
    await db.commit()
    await invalidate(cache_keys.ASSIGNMENTS)
