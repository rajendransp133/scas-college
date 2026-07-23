from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

import services.integrity as svc
from database.connection import get_db
from deps import get_current_user, require_capability
from enums.AuditAction import AuditActionEnum
from models import User
from schemas.Audit import AuditResponse, LockDatePayload
from schemas.Page import Page
from services.pagination import PageParams, page_params

router = APIRouter(tags=["integrity"])


@router.get("/settings")
async def get_settings(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    """Current term + lock date — global state every page is scoped by."""
    return await svc.get_settings(db)


@router.get("/lock-date")
async def get_lock_date(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    return {"lockDate": await svc.get_lock_date(db)}


@router.put("/lock-date")
async def set_lock_date(
    payload: LockDatePayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_capability("lock_attendance")),
):
    date = await svc.set_lock_date(db, user, payload.date)
    return {"lockDate": date}


@router.get("/audit", response_model=Page[AuditResponse])
async def list_audit(
    term_id: Optional[str] = Query(None, alias="termId"),
    action: Optional[AuditActionEnum] = Query(None),
    user_id: Optional[str] = Query(None, alias="userId"),
    student_id: Optional[str] = Query(None, alias="studentId"),
    course_id: Optional[str] = Query(None, alias="courseId"),
    params: PageParams = Depends(page_params),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_capability("view_audit")),
):
    """Paginated newest-first. The log is append-only and already 224k rows —
    it is never returned in full."""
    items, total = await svc.list_audit(
        db,
        params,
        term_id=term_id,
        action=action,
        user_id=user_id,
        student_id=student_id,
        course_id=course_id,
    )
    return Page.of(
        [AuditResponse.model_validate(a) for a in items],
        total,
        params.page,
        params.page_size,
    )


@router.get("/audit/lock-history", response_model=list[AuditResponse])
async def lock_history(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_capability("view_audit")),
):
    """Lock/unlock events for the oversight page's freeze-history list."""
    return await svc.list_lock_history(db)
