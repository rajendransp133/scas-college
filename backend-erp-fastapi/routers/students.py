from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

import services.scope as scope
import services.students as svc
from database.connection import get_db
from deps import caps_of, current_term_id, get_current_user, require_capability
from models import User
from schemas.Page import Page
from schemas.Student import (
    IdListPayload,
    StudentCreate,
    StudentResponse,
    StudentUpdate,
    redact_student,
    redact_students,
)
from services.pagination import MAX_PAGE_SIZE, PageParams, page_params

router = APIRouter(prefix="/students", tags=["students"])
_academics = require_capability("manage_academics")


@router.get("", response_model=Page[StudentResponse])
async def list_students(
    department_id: Optional[str] = Query(None, alias="departmentId"),
    program_id: Optional[str] = Query(None, alias="programId"),
    semester: Optional[int] = Query(None),
    search: Optional[str] = Query(None, description="Name or roll number substring"),
    status_filter: Optional[str] = Query(
        None,
        alias="status",
        pattern="^(active|inactive|graduated)$",
        description="Lifecycle filter",
    ),
    semesters: Optional[list[int]] = Query(
        None, description="Restrict to these semester numbers (set membership)"
    ),
    sort_by: Optional[str] = Query(None, alias="sortBy"),
    sort_dir: Optional[str] = Query(None, alias="sortDir", pattern="^(asc|desc)$"),
    params: PageParams = Depends(page_params),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Paginated + filtered server-side. Search, filters and sort all run in
    the database — the client never receives rows it isn't showing.

    Also scope-limited: a student record carries address, date of birth and
    guardian phone, so the caller's `view_scope` bounds the rows before any
    request filter is applied.
    """
    items, total = await svc.list_students(
        db,
        params,
        viewer=user,
        viewer_term_id=await current_term_id(db),
        department_id=department_id,
        program_id=program_id,
        semester=semester,
        search=search,
        status=status_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
        semesters=semesters,
    )
    return Page.of(
        redact_students(items, caps_of(user).view_student_pii),
        total,
        params.page,
        params.page_size,
    )


@router.get("/ids", response_model=list[str])
async def list_student_ids(
    department_id: Optional[str] = Query(None, alias="departmentId"),
    program_id: Optional[str] = Query(None, alias="programId"),
    semester: Optional[int] = Query(None),
    status_filter: Optional[str] = Query(
        None, alias="status", pattern="^(active|inactive|graduated)$"
    ),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    """Every matching student id — what the bulk promote/graduate actions need
    (a cohort, not a page) without transferring the full records."""
    return await svc.list_student_ids(
        db,
        department_id=department_id,
        program_id=program_id,
        semester=semester,
        status=status_filter,
    )


@router.get("/lookup")
async def lookup_students(
    # Capped like a page: the audit log resolves one page of ids at a time.
    ids: list[str] = Query(default_factory=list, max_length=MAX_PAGE_SIZE),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Resolve a specific set of student ids to name + roll number.

    Scoped like the list: ids outside the caller's reach are dropped silently
    rather than 403-ing, because a page legitimately asks about a mixed set
    (an audit log page holds ids from anywhere) and one stray id shouldn't fail
    the whole lookup.
    """
    return await svc.lookup_students(
        db, ids, viewer=user, viewer_term_id=await current_term_id(db)
    )


@router.get("/roll-numbers", response_model=list[str])
async def list_roll_numbers(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    """Existing roll numbers only — the bulk-upload dialog's duplicate check."""
    return await svc.list_roll_numbers(db)


@router.get("/{student_id}", response_model=StudentResponse)
async def get_student(
    student_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    student = await svc.get_student(db, student_id)
    await scope.assert_student_visible(
        db, user, student, await current_term_id(db)
    )
    return redact_student(student, caps_of(user).view_student_pii)


@router.post("", response_model=StudentResponse, status_code=status.HTTP_201_CREATED)
async def create_student(
    data: StudentCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(_academics),
):
    return await svc.create_student(db, data, actor)


@router.put("/{student_id}", response_model=StudentResponse)
async def update_student(
    student_id: str,
    data: StudentUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(_academics),
):
    return await svc.update_student(db, student_id, data, actor)


@router.delete("/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_student(
    student_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_academics),
):
    await svc.delete_student(db, user, student_id)


@router.post("/{student_id}/toggle-active", response_model=StudentResponse)
async def toggle_active(
    student_id: str,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(_academics),
):
    return await svc.toggle_active(db, student_id, actor)


@router.post("/promote")
async def promote(
    payload: IdListPayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(_academics),
):
    # repsRemoved: class-rep logins retired because their class moved out of
    # that semester in whole. Surfaced so the UI can prompt the admin to create
    # the replacement account for the class's new semester.
    n, reps_removed = await svc.promote_students(db, payload.ids, actor)
    return {"promoted": n, "repsRemoved": reps_removed}


@router.post("/graduate")
async def graduate(
    payload: IdListPayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(_academics),
):
    # repsRemoved: same rule as promotion — the class is gone, so its shared
    # login goes with it.
    n, reps_removed = await svc.graduate_students(db, payload.ids, actor)
    return {"graduated": n, "repsRemoved": reps_removed}
