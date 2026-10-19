from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ids import new_id
from models import Course, Department, Program, Semester, User
from services.audit import guard_attendance_cascade
from services.cache import invalidate_curriculum
from schemas.Department import DepartmentCreate, DepartmentUpdate
from services.util import apply_updates, commit_or_raise, not_found

_CONFLICTS = {
    "department_name_key": "Department name already exists",
    "department_code_key": "Department code already exists",
}


async def list_departments(db: AsyncSession) -> list[Department]:
    # Columns only — the relationships are lazy="raise", so nothing else loads.
    rows = await db.execute(select(Department).order_by(Department.name))
    return list(rows.scalars().all())


async def get_department(db: AsyncSession, dept_id: str) -> Department:
    """The detail response nests programs + teachers, so load exactly those two
    collections (two extra queries) — never the curriculum below them."""
    rows = await db.execute(
        select(Department)
        .where(Department.id == dept_id)
        .options(
            selectinload(Department.programs),
            selectinload(Department.teachers),
        )
    )
    dep = rows.scalar_one_or_none()
    if dep is None:
        raise not_found("Department not found")
    return dep


async def _get_department_row(db: AsyncSession, dept_id: str) -> Department:
    """Bare row for update/delete — no relationship loading."""
    dep = await db.get(Department, dept_id)
    if dep is None:
        raise not_found("Department not found")
    return dep


async def create_department(db: AsyncSession, data: DepartmentCreate) -> Department:
    dep = Department(id=new_id("dept"), name=data.name, code=data.code)
    db.add(dep)
    await commit_or_raise(db, _CONFLICTS)
    await db.refresh(dep)
    await invalidate_curriculum()
    return dep


async def update_department(
    db: AsyncSession, dept_id: str, data: DepartmentUpdate
) -> Department:
    dep = await _get_department_row(db, dept_id)
    apply_updates(dep, data)
    await commit_or_raise(db, _CONFLICTS)
    await db.refresh(dep)
    await invalidate_curriculum()
    return dep


async def delete_department(db: AsyncSession, user: User, dept_id: str) -> None:
    # DB-level cascades remove programs -> semesters -> courses -> assignments
    # -> attendance -> materials. Teachers/students are orphaned (FK SET NULL).
    # The attendance part is audited and lock-guarded first.
    dep = await _get_department_row(db, dept_id)
    await guard_attendance_cascade(
        db,
        user,
        label=f"Department {dep.code}",
        courses=select(Course.id)
        .join(Semester, Semester.id == Course.semester_id)
        .join(Program, Program.id == Semester.program_id)
        .where(Program.department_id == dept_id),
    )
    await db.delete(dep)
    await db.commit()
    await invalidate_curriculum()
