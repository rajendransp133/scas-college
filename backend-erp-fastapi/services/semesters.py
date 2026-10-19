from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import services.cache as cache_keys
from ids import new_id
from models import Course, Semester, User
from services.audit import guard_attendance_cascade
from services.cache import cached, invalidate_curriculum
from schemas.Course import CourseCreate, CourseFlatResponse
from schemas.Semester import SemesterCreate
from services.util import commit_or_raise, not_found

_CONFLICTS = {
    "uq_semester_program_number": "Semester number already exists for this program",
    "semester_program_id_fkey": "Program not found",
    "course_semester_id_fkey": "Semester not found",
}


async def list_all_courses(db: AsyncSession) -> list[dict]:
    """Flat list of every course with its semester number + owning program id —
    the global course lookup used across role-scoped views.

    Loaded by most pages, changes only via curriculum edits, and is a few
    hundred rows — so it is cached and invalidated by those edits.
    """

    async def load() -> list[dict]:
        rows = await db.execute(
            select(
                Course.id,
                Course.name,
                Course.code,
                Course.credits,
                Course.type,
                Course.semester_id,
                Semester.number,
                Semester.program_id,
            )
            .join(Semester, Course.semester_id == Semester.id)
            .order_by(Semester.program_id, Semester.number, Course.code)
        )
        return [
            CourseFlatResponse(
                id=r.id,
                name=r.name,
                code=r.code,
                credits=r.credits,
                type=r.type,
                semester_id=r.semester_id,
                semester_number=r.number,
                program_id=r.program_id,
            ).model_dump(mode="json")
            for r in rows.all()
        ]

    return await cached(f"{cache_keys.COURSES}:all", load)


async def list_semesters(db: AsyncSession, program_id: str) -> list[Semester]:
    # The response nests courses, so load them in one extra query.
    rows = await db.execute(
        select(Semester)
        .where(Semester.program_id == program_id)
        .options(selectinload(Semester.courses))
        .order_by(Semester.number)
    )
    return list(rows.scalars().all())


async def add_semester(db: AsyncSession, data: SemesterCreate) -> Semester:
    sem = Semester(id=new_id("sem"), program_id=data.program_id, number=data.number)
    db.add(sem)
    await commit_or_raise(db, _CONFLICTS)
    await db.refresh(sem)
    await invalidate_curriculum()
    return sem


async def get_semester(db: AsyncSession, semester_id: str) -> Semester:
    sem = await db.get(Semester, semester_id)
    if sem is None:
        raise not_found("Semester not found")
    return sem


async def delete_semester(db: AsyncSession, user: User, semester_id: str) -> None:
    sem = await get_semester(db, semester_id)
    await guard_attendance_cascade(
        db,
        user,
        label=f"Semester {sem.number}",
        courses=select(Course.id).where(Course.semester_id == semester_id),
    )
    await db.delete(sem)
    await db.commit()
    await invalidate_curriculum()


async def add_course(
    db: AsyncSession, semester_id: str, data: CourseCreate
) -> Course:
    await get_semester(db, semester_id)  # 404 if missing
    course = Course(
        id=new_id("c"),
        name=data.name,
        code=data.code,
        credits=data.credits,
        type=data.type,
        semester_id=semester_id,
    )
    db.add(course)
    await commit_or_raise(db, _CONFLICTS)
    await db.refresh(course)
    await invalidate_curriculum()
    return course


async def delete_course(
    db: AsyncSession, user: User, semester_id: str, course_id: str
) -> None:
    course = await db.get(Course, course_id)
    if course is None or course.semester_id != semester_id:
        raise not_found("Course not found")
    await guard_attendance_cascade(
        db,
        user,
        label=f"Course {course.code}",
        courses=select(Course.id).where(Course.id == course_id),
    )
    await db.delete(course)
    await db.commit()
    await invalidate_curriculum()
