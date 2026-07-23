from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

import services.materials as svc
from database.connection import get_db
from deps import current_term_id, get_current_user
from models import User
from schemas.Material import MaterialCreate, MaterialResponse
from schemas.Page import Page
from services.pagination import PageParams, page_params

router = APIRouter(prefix="/materials", tags=["materials"])


@router.get("", response_model=Page[MaterialResponse])
async def list_materials(
    program_id: Optional[str] = Query(None, alias="programId"),
    semester: Optional[int] = Query(None),
    course_id: Optional[str] = Query(None, alias="courseId"),
    search: Optional[str] = Query(None, description="Title or link substring"),
    params: PageParams = Depends(page_params),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Role-scoped and paginated."""
    term = await current_term_id(db)
    items, total = await svc.list_materials(
        db,
        user,
        term,
        params,
        program_id=program_id,
        semester=semester,
        course_id=course_id,
        search=search,
    )
    return Page.of(
        [MaterialResponse.model_validate(m) for m in items],
        total,
        params.page,
        params.page_size,
    )


@router.post("", response_model=MaterialResponse, status_code=status.HTTP_201_CREATED)
async def create_material(
    payload: MaterialCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Share a link with a class. Nothing is uploaded — there is no file store."""
    await svc.ensure_can_upload(db, user, payload.course_id, payload.term_id)
    return await svc.create_material(
        db,
        user,
        course_id=payload.course_id,
        term_id=payload.term_id,
        title=payload.title,
        description=payload.description,
        url=payload.url,
    )


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(
    material_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await svc.delete_material(db, user, material_id)
