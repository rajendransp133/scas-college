from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

import services.analytics as svc
from database.connection import get_db
from deps import current_term_id, get_current_user
from models import Teacher, User

router = APIRouter(prefix="/stats", tags=["stats"])


async def _scope_department(db: AsyncSession, user: User) -> Optional[str]:
    """HODs see their own department only; every other role sees the college."""
    if user.role.value == "hod" and user.teacher_id:
        teacher = await db.get(Teacher, user.teacher_id)
        return teacher.department_id if teacher else None
    return None


@router.get("/dashboard")
async def dashboard(
    term_id: Optional[str] = Query(None, alias="termId"),
    min_pct: float = Query(75.0, alias="minPct", ge=0, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every dashboard counter in one round trip, computed in SQL.

    The dashboard previously derived these client-side from `useAttendance({})`
    — i.e. by downloading every session in the database.
    """
    term = term_id or await current_term_id(db)
    department_id = await _scope_department(db, user)
    return await svc.dashboard_stats(db, term, department_id, min_pct)


@router.get("/unstaffed-courses")
async def unstaffed_courses(
    term_id: Optional[str] = Query(None, alias="termId"),
    semesters: Optional[list[int]] = Query(
        None,
        description="Semester numbers in session for the term's parity (e.g. 1,3,5)",
    ),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Courses with no teacher assigned for the term — the staffing gap shown
    on the dashboard strip and the semester close-out checklist."""
    term = term_id or await current_term_id(db)
    if not term:
        return []
    return await svc.unstaffed_courses(db, term, semesters)


@router.get("/shortfall-count")
async def shortfall(
    term_id: Optional[str] = Query(None, alias="termId"),
    min_pct: float = Query(75.0, alias="minPct", ge=0, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """How many enrolled students are below the attendance threshold."""
    term = term_id or await current_term_id(db)
    department_id = await _scope_department(db, user)
    return {
        "count": await svc.shortfall_count(db, term, department_id, min_pct)
    }
