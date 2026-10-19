from __future__ import annotations

from typing import Optional

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import services.cache as cache_keys
from ids import new_id
from models import Teacher
from services.cache import invalidate
from schemas.Teacher import TeacherCreate, TeacherUpdate
from services.pagination import PageParams, apply_sort, paginate, search_clause
from services.util import apply_updates, commit_or_raise, not_found

_CONFLICTS = {
    "teacher_employee_id_key": "Employee id already exists",
    "teacher_email_key": "A teacher with this email already exists",
    "teacher_department_id_fkey": "Department not found",
    "uq_one_hod_per_department": (
        "This department's HOD changed at the same moment — reload and try again"
    ),
}

SORTABLE = {
    "name": Teacher.name,
    "employeeId": Teacher.employee_id,
    "designation": Teacher.designation,
    "joiningDate": Teacher.joining_date,
}


async def _demote_other_hods(
    db: AsyncSession, department_id: Optional[str], keep_id: Optional[str]
) -> None:
    """Ensure at most one HOD per department by clearing is_hod on others."""
    if not department_id:
        return
    stmt = (
        update(Teacher)
        .where(Teacher.department_id == department_id, Teacher.is_hod.is_(True))
        .values(is_hod=False)
    )
    if keep_id is not None:
        stmt = stmt.where(Teacher.id != keep_id)
    await db.execute(stmt)


async def list_teachers(
    db: AsyncSession,
    params: PageParams,
    department_id: Optional[str] = None,
    search: Optional[str] = None,
    is_hod: Optional[bool] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
) -> tuple[list[Teacher], int]:
    stmt = select(Teacher)
    if department_id:
        stmt = stmt.where(Teacher.department_id == department_id)
    if is_hod is not None:
        stmt = stmt.where(Teacher.is_hod.is_(is_hod))
    if search and search.strip():
        stmt = stmt.where(
            or_(*search_clause(search, Teacher.name, Teacher.employee_id))
        )
    stmt = apply_sort(stmt, sort_by, sort_dir, SORTABLE, Teacher.name)
    items, total = await paginate(db, stmt, params)
    return list(items), total


async def list_hods(db: AsyncSession) -> list[Teacher]:
    """Every HOD — at most one per department, so this is bounded by the
    department count and needs no paging."""
    rows = await db.execute(
        select(Teacher).where(Teacher.is_hod.is_(True)).order_by(Teacher.name)
    )
    return list(rows.scalars().all())


async def get_teacher(db: AsyncSession, teacher_id: str) -> Teacher:
    t = await db.get(Teacher, teacher_id)
    if t is None:
        raise not_found("Teacher not found")
    return t


async def create_teacher(db: AsyncSession, data: TeacherCreate) -> Teacher:
    if data.is_hod:
        await _demote_other_hods(db, data.department_id, keep_id=None)
    teacher = Teacher(id=new_id("tch"), **data.model_dump(by_alias=False))
    db.add(teacher)
    await commit_or_raise(db, _CONFLICTS)
    await db.refresh(teacher)
    return teacher


async def update_teacher(
    db: AsyncSession, teacher_id: str, data: TeacherUpdate
) -> Teacher:
    teacher = await get_teacher(db, teacher_id)
    fields = data.model_dump(exclude_unset=True, by_alias=False)
    target_dept = fields.get("department_id", teacher.department_id)
    if fields.get("is_hod"):
        await _demote_other_hods(db, target_dept, keep_id=teacher_id)
    apply_updates(teacher, data)
    await commit_or_raise(db, _CONFLICTS)
    await db.refresh(teacher)
    return teacher


async def delete_teacher(db: AsyncSession, teacher_id: str) -> None:
    # DB cascades drop assignments; User.teacher_id is SET NULL (account survives).
    teacher = await get_teacher(db, teacher_id)
    await db.delete(teacher)
    await db.commit()
    # The cascade took this teacher's assignments with it; their cached
    # own-course set would otherwise keep granting mark/upload rights.
    await invalidate(cache_keys.ASSIGNMENTS)


async def set_hod(db: AsyncSession, teacher_id: str, is_hod: bool) -> Teacher:
    teacher = await get_teacher(db, teacher_id)
    if is_hod:
        await _demote_other_hods(db, teacher.department_id, keep_id=teacher_id)
    teacher.is_hod = is_hod
    await commit_or_raise(db, _CONFLICTS)
    await db.refresh(teacher)
    return teacher
