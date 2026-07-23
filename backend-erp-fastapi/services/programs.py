from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import services.cache as cache_keys
from ids import new_id
from models import Program, Semester
from services.cache import invalidate_curriculum
from schemas.Program import ProgramCreate, ProgramUpdate
from services.util import apply_updates, conflict, not_found


async def list_programs(
    db: AsyncSession, department_id: Optional[str] = None
) -> list[Program]:
    stmt = select(Program).order_by(Program.name)
    if department_id:
        stmt = stmt.where(Program.department_id == department_id)
    rows = await db.execute(stmt)
    return list(rows.scalars().all())


async def get_program(db: AsyncSession, program_id: str) -> Program:
    """Detail response nests semesters → courses; load that one branch
    explicitly (2 extra queries, not one per semester)."""
    rows = await db.execute(
        select(Program)
        .where(Program.id == program_id)
        .options(selectinload(Program.semesters).selectinload(Semester.courses))
    )
    prog = rows.scalar_one_or_none()
    if prog is None:
        raise not_found("Program not found")
    return prog


async def _get_program_row(db: AsyncSession, program_id: str) -> Program:
    """Bare row for update/delete — no relationship loading."""
    prog = await db.get(Program, program_id)
    if prog is None:
        raise not_found("Program not found")
    return prog


async def create_program(db: AsyncSession, data: ProgramCreate) -> Program:
    prog = Program(
        id=new_id("prog"),
        name=data.name,
        code=data.code,
        level=data.level,
        department_id=data.department_id,
    )
    db.add(prog)
    # Auto-generate semesters 1..N (mirrors the frontend create dialog).
    for n in range(1, data.semester_count + 1):
        db.add(Semester(id=new_id("sem"), program_id=prog.id, number=n))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise conflict("Program could not be created (duplicate or bad reference)")
    await db.refresh(prog)
    invalidate_curriculum()
    return prog


async def update_program(
    db: AsyncSession, program_id: str, data: ProgramUpdate
) -> Program:
    prog = await _get_program_row(db, program_id)
    apply_updates(prog, data)
    await db.commit()
    await db.refresh(prog)
    invalidate_curriculum()
    return prog


async def delete_program(db: AsyncSession, program_id: str) -> None:
    prog = await _get_program_row(db, program_id)
    await db.delete(prog)
    await db.commit()
    invalidate_curriculum()
