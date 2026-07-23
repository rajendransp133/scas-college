from __future__ import annotations

from typing import Optional
from urllib.parse import urlparse

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from deps import own_course_ids
from ids import new_id
from models import Course, Program, Semester, StudyMaterial, User
from permissions import role_capabilities
from services.pagination import PageParams, paginate, search_clause
from services.util import not_found, now_utc

MATERIAL_URL_MAX_LEN = 2048

# Shared with `services/scope.py` so the two never disagree about which courses
# belong to a department or a class. The *policy* stays separate: sharing scope
# is not reading scope (an attendance-manager reads every register but has no
# materials at all), so this module keeps its own capability checks below.
from services.scope import (  # noqa: E402
    class_course_ids as _class_course_ids,
    dept_course_ids as _dept_course_ids,
)


async def visible_course_ids(
    db: AsyncSession, user: User, term_id: Optional[str]
) -> Optional[set[str]]:
    """None means "all courses" (admin/principal)."""
    caps = role_capabilities(user.role)
    if caps.manage_all_materials:
        return None
    ids: set[str] = set()
    if user.teacher_id and term_id:
        ids |= await own_course_ids(db, user, term_id)
    if user.role.value == "hod" and user.teacher_id:
        from models import Teacher

        teacher = await db.get(Teacher, user.teacher_id)
        if teacher and teacher.department_id:
            ids |= await _dept_course_ids(db, teacher.department_id)
    if user.role.value == "student-rep" and user.program_id and user.class_semester:
        ids |= await _class_course_ids(db, user.program_id, user.class_semester)
    return ids


async def list_materials(
    db: AsyncSession,
    user: User,
    term_id: Optional[str],
    params: PageParams,
    program_id: Optional[str] = None,
    semester: Optional[int] = None,
    course_id: Optional[str] = None,
    search: Optional[str] = None,
) -> tuple[list[StudyMaterial], int]:
    stmt = select(StudyMaterial).order_by(StudyMaterial.uploaded_at.desc())
    visible = await visible_course_ids(db, user, term_id)
    if visible is not None:
        if not visible:
            return [], 0
        stmt = stmt.where(StudyMaterial.course_id.in_(visible))
    if course_id:
        stmt = stmt.where(StudyMaterial.course_id == course_id)
    if program_id:
        allowed = await _class_course_ids_for_program(db, program_id, semester)
        stmt = stmt.where(StudyMaterial.course_id.in_(allowed or {"__none__"}))
    if search and search.strip():
        stmt = stmt.where(
            or_(*search_clause(search, StudyMaterial.title, StudyMaterial.url))
        )
    items, total = await paginate(db, stmt, params)
    return list(items), total


async def _class_course_ids_for_program(
    db: AsyncSession, program_id: str, semester: Optional[int]
) -> set[str]:
    stmt = (
        select(Course.id)
        .join(Semester, Course.semester_id == Semester.id)
        .where(Semester.program_id == program_id)
    )
    if semester is not None:
        stmt = stmt.where(Semester.number == semester)
    rows = await db.execute(stmt)
    return {r[0] for r in rows.all()}


async def ensure_can_upload(
    db: AsyncSession, user: User, course_id: str, term_id: str
) -> None:
    scope = role_capabilities(user.role).material_scope
    if scope == "all":
        return
    if scope == "own" and course_id in await own_course_ids(db, user, term_id):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You cannot upload materials to this course",
    )


def normalise_url(url: str) -> str:
    """Accept only absolute http(s) links — a material is a link we hand to the
    browser, so anything else (javascript:, data:, a bare word) is rejected."""
    cleaned = (url or "").strip()
    if not cleaned:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A link is required",
        )
    if len(cleaned) > MATERIAL_URL_MAX_LEN:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Link exceeds {MATERIAL_URL_MAX_LEN} characters",
        )
    parsed = urlparse(cleaned)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Link must be a full http:// or https:// address",
        )
    return cleaned


async def create_material(
    db: AsyncSession,
    user: User,
    *,
    course_id: str,
    term_id: str,
    title: str,
    description: Optional[str],
    url: str,
) -> StudyMaterial:
    material = StudyMaterial(
        id=new_id("mat"),
        course_id=course_id,
        term_id=term_id,
        title=title.strip(),
        description=description,
        url=normalise_url(url),
        uploaded_by=user.id,
        uploaded_at=now_utc(),
    )
    db.add(material)
    await db.commit()
    await db.refresh(material)
    return material


async def get_material(db: AsyncSession, material_id: str) -> StudyMaterial:
    m = await db.get(StudyMaterial, material_id)
    if m is None:
        raise not_found("Material not found")
    return m


async def delete_material(db: AsyncSession, user: User, material_id: str) -> None:
    m = await get_material(db, material_id)
    caps = role_capabilities(user.role)
    if not (caps.manage_all_materials or m.uploaded_by == user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot delete this material",
        )
    await db.delete(m)
    await db.commit()
