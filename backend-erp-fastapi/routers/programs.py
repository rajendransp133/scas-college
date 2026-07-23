from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

import services.programs as svc
from database.connection import get_db
from deps import get_current_user, require_capability
from models import User
from schemas.Program import (
    ProgramCreate,
    ProgramDetailResponse,
    ProgramResponse,
    ProgramUpdate,
)

router = APIRouter(prefix="/programs", tags=["programs"])
_academics = require_capability("manage_academics")


@router.get("", response_model=list[ProgramResponse])
async def list_programs(
    department_id: Optional[str] = Query(None, alias="departmentId"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await svc.list_programs(db, department_id)


@router.get("/{program_id}", response_model=ProgramDetailResponse)
async def get_program(
    program_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await svc.get_program(db, program_id)


@router.post("", response_model=ProgramResponse, status_code=status.HTTP_201_CREATED)
async def create_program(
    data: ProgramCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    return await svc.create_program(db, data)


@router.put("/{program_id}", response_model=ProgramResponse)
async def update_program(
    program_id: str,
    data: ProgramUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    return await svc.update_program(db, program_id, data)


@router.delete("/{program_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_program(
    program_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    await svc.delete_program(db, program_id)
