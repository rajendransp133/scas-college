from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

import services.analytics as analytics
import services.attendance as svc
import services.scope as scope
import services.students as students_svc
from database.connection import get_db
from deps import caps_of, current_term_id, ensure_can_mark, get_current_user
from models import User
from schemas.Attendance import (
    AttendanceSessionResponse,
    SaveAttendancePayload,
    SetStatusPayload,
)
from schemas.Page import Page
from schemas.Student import StudentResponse
from services.pagination import PageParams, page_params

router = APIRouter(prefix="/attendance", tags=["attendance"])


async def _scope_term(db: AsyncSession, term_id: Optional[str]) -> Optional[str]:
    """Which term the caller's scope is evaluated in.

    Teacher and HOD scope comes from course assignments, which are per-term, so
    a request that names a term is scoped in *that* term — viewing last year's
    register requires having taught it last year. Falls back to the current term
    when the request doesn't say, which is what the unfiltered dashboards do.
    """
    return term_id or await current_term_id(db)


@router.get("", response_model=Page[AttendanceSessionResponse])
async def list_sessions(
    course_id: Optional[str] = Query(None, alias="courseId"),
    term_id: Optional[str] = Query(None, alias="termId"),
    date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="dateFrom"),
    date_to: Optional[str] = Query(None, alias="dateTo"),
    month: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$"),
    params: PageParams = Depends(page_params),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Paginated sessions, each with its records. There are 200k+ sessions, so
    this always narrows by course/term/date and returns one page."""
    allowed = await scope.visible_course_ids(db, user, await _scope_term(db, term_id))
    items, total = await svc.list_sessions(
        db,
        params,
        course_id=course_id,
        term_id=term_id,
        date=date,
        date_from=date_from,
        date_to=date_to,
        month=month,
        allowed_course_ids=allowed,
    )
    return Page.of(
        [AttendanceSessionResponse.model_validate(s) for s in items],
        total,
        params.page,
        params.page_size,
    )


@router.get("/register", response_model=list[AttendanceSessionResponse])
async def register(
    course_id: str = Query(..., alias="courseId"),
    term_id: Optional[str] = Query(None, alias="termId"),
    month: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The students × sessions matrix for one class — bounded by the course, so
    it is returned whole rather than paged."""
    await scope.assert_course_visible(
        db, user, course_id, await _scope_term(db, term_id)
    )
    return await svc.get_register(db, course_id, term_id, month)


@router.get("/months", response_model=list[str])
async def session_months(
    course_id: str = Query(..., alias="courseId"),
    term_id: Optional[str] = Query(None, alias="termId"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Distinct `YYYY-MM` values for the register's month picker, from SQL."""
    await scope.assert_course_visible(
        db, user, course_id, await _scope_term(db, term_id)
    )
    return await svc.list_session_months(db, course_id, term_id)


@router.get("/roster", response_model=list[StudentResponse])
async def roster(
    course_id: str = Query(..., alias="courseId"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Who to mark today: currently enrolled students only."""
    await scope.assert_course_visible(db, user, course_id, await _scope_term(db, None))
    return await svc.get_roster(db, course_id)


@router.get("/class-roster", response_model=list[StudentResponse])
async def class_roster(
    course_id: str = Query(..., alias="courseId"),
    term_id: Optional[str] = Query(None, alias="termId"),
    month: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The register's row set: current class members ∪ anyone with saved marks
    in scope, so students who left or graduated keep their history."""
    await scope.assert_course_visible(
        db, user, course_id, await _scope_term(db, term_id)
    )
    return await svc.get_class_roster(db, course_id, term_id, month)


@router.get("/summary")
async def summary(
    term_id: Optional[str] = Query(None, alias="termId"),
    program_id: Optional[str] = Query(None, alias="programId"),
    semester: Optional[int] = Query(None),
    course_id: Optional[str] = Query(None, alias="courseId"),
    course_ids: Optional[list[str]] = Query(None, alias="courseIds"),
    department_id: Optional[str] = Query(None, alias="departmentId"),
    search: Optional[str] = Query(None),
    min_pct: float = Query(75.0, alias="minPct", ge=0, le=100),
    defaulters_only: bool = Query(False, alias="defaultersOnly"),
    params: PageParams = Depends(page_params),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Per-student attendance %, aggregated in SQL — replaces the client-side
    pass over every session in the term. `totals` covers the whole filtered
    set, so the header counts don't depend on the page."""
    allowed = await scope.visible_course_ids(db, user, await _scope_term(db, term_id))
    items, total, totals = await analytics.student_summary(
        db,
        params,
        allowed_course_ids=allowed,
        term_id=term_id,
        program_id=program_id,
        semester=semester,
        course_id=course_id,
        course_ids=course_ids,
        department_id=department_id,
        search=search,
        min_pct=min_pct,
        defaulters_only=defaulters_only,
    )
    page = Page.of(items, total, params.page, params.page_size)
    return {**page.model_dump(by_alias=True), "totals": totals}


@router.get("/summary/breakdown")
async def summary_breakdown(
    student_id: str = Query(..., alias="studentId"),
    term_id: Optional[str] = Query(None, alias="termId"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Per-course tally for one student (summary expand row / student detail)."""
    term = await _scope_term(db, term_id)
    student = await students_svc.get_student(db, student_id)
    await scope.assert_student_visible(db, user, student, term)
    return await analytics.student_course_breakdown(db, student_id, term_id)


@router.get("/red-flags")
async def red_flags(
    term_id: Optional[str] = Query(None, alias="termId"),
    min_pct: float = Query(75.0, alias="minPct", ge=0, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Attendance-integrity warning signs for the oversight page."""
    if not caps_of(user).view_audit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing capability: view_audit",
        )
    term = term_id or await current_term_id(db)
    return await analytics.correction_red_flags(db, term, min_pct)


@router.post("", response_model=AttendanceSessionResponse)
async def save_attendance(
    payload: SaveAttendancePayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    existing = await svc._find_session(
        db, payload.course_id, payload.date, payload.period
    )
    if existing is not None:
        # Re-save = correction: requires edit capability (teachers are first-time only).
        if not caps_of(user).edit_attendance:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This session already exists and you cannot edit it",
            )
    else:
        await ensure_can_mark(db, user, payload.course_id, payload.term_id)
    return await svc.save_attendance(db, user, payload)


@router.patch(
    "/{session_id}/records/{student_id}",
    response_model=AttendanceSessionResponse,
)
async def set_status(
    session_id: str,
    student_id: str,
    payload: SetStatusPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not caps_of(user).edit_attendance:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing capability: edit_attendance",
        )
    return await svc.set_attendance_status(
        db, user, session_id, student_id, payload.status
    )


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not caps_of(user).delete_attendance:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing capability: delete_attendance",
        )
    await svc.delete_session(db, user, session_id)
