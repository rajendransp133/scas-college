from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

import services.users as svc
from database.connection import get_db
from deps import get_current_user, require_capability
from enums.UserRole import UserRoleEnum
from models import User
from schemas.Page import Page
from schemas.User import (
    UserCreate,
    UserDirectoryEntry,
    UserResponse,
    UserUpdate,
)
from services.pagination import PageParams, page_params

router = APIRouter(prefix="/users", tags=["users"])
_manage = require_capability("manage_users")


@router.get("", response_model=Page[UserResponse])
async def list_users(
    search: Optional[str] = Query(None, description="Name or email substring"),
    role: Optional[UserRoleEnum] = Query(None),
    sort_by: Optional[str] = Query(None, alias="sortBy"),
    sort_dir: Optional[str] = Query(None, alias="sortDir", pattern="^(asc|desc)$"),
    params: PageParams = Depends(page_params),
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(_manage),
):
    items, total = await svc.list_users(
        db,
        viewer,
        params,
        search=search,
        role=role,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    return Page.of(
        [UserResponse.model_validate(u) for u in items],
        total,
        params.page,
        params.page_size,
    )


@router.get("/directory", response_model=list[UserDirectoryEntry])
async def user_directory(
    db: AsyncSession = Depends(get_db), viewer: User = Depends(get_current_user)
):
    # id→name only; any authenticated user (name resolution across the app).
    return await svc.list_directory(db, viewer)


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(_manage),
):
    return await svc.create_user(db, data, actor)


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(_manage),
):
    return await svc.update_user(db, user_id, data, actor)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(_manage),
):
    await svc.delete_user(db, user_id, actor)
