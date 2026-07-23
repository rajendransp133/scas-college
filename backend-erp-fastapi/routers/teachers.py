from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

import services.teachers as svc
from database.connection import get_db
from deps import get_current_user, require_capability
from models import User
from schemas.Page import Page
from schemas.Teacher import (
    SetHodPayload,
    TeacherCreate,
    TeacherResponse,
    TeacherUpdate,
)
from services.pagination import PageParams, page_params

router = APIRouter(prefix="/teachers", tags=["teachers"])
_academics = require_capability("manage_academics")


@router.get("", response_model=Page[TeacherResponse])
async def list_teachers(
    department_id: Optional[str] = Query(None, alias="departmentId"),
    search: Optional[str] = Query(None, description="Name or employee id substring"),
    is_hod: Optional[bool] = Query(None, alias="isHod"),
    sort_by: Optional[str] = Query(None, alias="sortBy"),
    sort_dir: Optional[str] = Query(None, alias="sortDir", pattern="^(asc|desc)$"),
    params: PageParams = Depends(page_params),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    items, total = await svc.list_teachers(
        db,
        params,
        department_id=department_id,
        search=search,
        is_hod=is_hod,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    return Page.of(
        [TeacherResponse.model_validate(t) for t in items],
        total,
        params.page,
        params.page_size,
    )


@router.get("/hods", response_model=list[TeacherResponse])
async def list_hods(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """The per-department HOD cards — one row per department, so unpaged."""
    return await svc.list_hods(db)


@router.get("/{teacher_id}", response_model=TeacherResponse)
async def get_teacher(
    teacher_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await svc.get_teacher(db, teacher_id)


@router.post("", response_model=TeacherResponse, status_code=status.HTTP_201_CREATED)
async def create_teacher(
    data: TeacherCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    return await svc.create_teacher(db, data)


@router.put("/{teacher_id}", response_model=TeacherResponse)
async def update_teacher(
    teacher_id: str,
    data: TeacherUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    return await svc.update_teacher(db, teacher_id, data)


@router.delete("/{teacher_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_teacher(
    teacher_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    await svc.delete_teacher(db, teacher_id)


@router.post("/{teacher_id}/hod", response_model=TeacherResponse)
async def set_hod(
    teacher_id: str,
    payload: SetHodPayload,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    return await svc.set_hod(db, teacher_id, payload.is_hod)
