from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

import services.assignments as svc
from database.connection import get_db
from deps import current_term_id, get_current_user, require_capability
from models import User
from schemas.Assignment import AssignmentCreate, AssignmentResponse

router = APIRouter(prefix="/assignments", tags=["assignments"])
_academics = require_capability("manage_academics")


@router.get("", response_model=list[AssignmentResponse])
async def list_assignments(
    term_id: Optional[str] = Query(None, alias="termId"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """One term's assignments — the current term unless `termId` says otherwise.
    Unfiltered, this grew by a whole college's staffing every term."""
    return await svc.list_assignments(db, term_id or await current_term_id(db))


@router.post("", response_model=AssignmentResponse, status_code=status.HTTP_201_CREATED)
async def assign_teacher(
    data: AssignmentCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(_academics),
):
    return await svc.assign_teacher(db, data.course_id, data.teacher_id, data.term_id, actor)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_teacher(
    course_id: str = Query(..., alias="courseId"),
    teacher_id: str = Query(..., alias="teacherId"),
    term_id: str = Query(..., alias="termId"),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(_academics),
):
    await svc.unassign_teacher(db, course_id, teacher_id, term_id, actor)
