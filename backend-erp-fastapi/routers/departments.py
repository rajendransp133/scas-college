from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

import services.departments as svc
from database.connection import get_db
from deps import get_current_user, require_capability
from models import User
from schemas.Department import (
    DepartmentCreate,
    DepartmentDetailResponse,
    DepartmentResponse,
    DepartmentUpdate,
)

router = APIRouter(prefix="/departments", tags=["departments"])
_academics = require_capability("manage_academics")


@router.get("", response_model=list[DepartmentResponse])
async def list_departments(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    return await svc.list_departments(db)


@router.get("/{dept_id}", response_model=DepartmentDetailResponse)
async def get_department(
    dept_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await svc.get_department(db, dept_id)


@router.post(
    "", response_model=DepartmentResponse, status_code=status.HTTP_201_CREATED
)
async def create_department(
    data: DepartmentCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    return await svc.create_department(db, data)


@router.put("/{dept_id}", response_model=DepartmentResponse)
async def update_department(
    dept_id: str,
    data: DepartmentUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    return await svc.update_department(db, dept_id, data)


@router.delete("/{dept_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_department(
    dept_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    await svc.delete_department(db, dept_id)
