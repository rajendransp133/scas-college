from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

import services.analytics as svc
from database.connection import get_db
from deps import current_term_id, get_current_user, require_capability
from models import User
from services.scope import aggregate_department_scope

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/dashboard")
async def dashboard(
    term_id: Optional[str] = Query(None, alias="termId"),
    min_pct: float = Query(75.0, alias="minPct", ge=0, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every dashboard counter in one round trip, computed in SQL.

    The dashboard previously derived these client-side from `useAttendance({})`
    — i.e. by downloading every session in the database. Scoped by
    `view_scope`: the college, an HOD's department, or 403.
    """
    department_id = await aggregate_department_scope(db, user)
    term = term_id or await current_term_id(db)
    return await svc.dashboard_stats(db, term, department_id, min_pct)


@router.get("/unstaffed-courses")
async def unstaffed_courses(
    term_id: Optional[str] = Query(None, alias="termId"),
    semesters: Optional[list[int]] = Query(
        None,
        description="Semester numbers in session for the term's parity (e.g. 1,3,5)",
    ),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_capability("manage_academics")),
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
    department_id = await aggregate_department_scope(db, user)
    term = term_id or await current_term_id(db)
    return {
        "count": await svc.shortfall_count(db, term, department_id, min_pct)
    }
