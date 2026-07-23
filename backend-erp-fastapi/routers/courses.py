from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

import services.semesters as svc
from database.connection import get_db
from deps import get_current_user
from models import User
from schemas.Course import CourseFlatResponse

router = APIRouter(prefix="/courses", tags=["courses"])


@router.get("", response_model=list[CourseFlatResponse])
async def list_courses(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    """Flat, global course list (name/code + resolved semesterNumber + programId).
    The frontend's cross-entity course lookup for every role."""
    return await svc.list_all_courses(db)
