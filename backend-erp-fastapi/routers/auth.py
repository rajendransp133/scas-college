from __future__ import annotations

import secrets
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

import services.users as users_svc
from database.connection import get_db
from deps import get_current_user
from enums.UserRole import UserRoleEnum
from models import User
from rate_limit import limiter
from services.scope import hod_department_id
from schemas.Auth import (
    ChangePasswordRequest,
    LoginRequest,
    MeResponse,
    TokenResponse,
)
from schemas.User import UserResponse
from security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    """A real bcrypt hash of nothing anyone knows — verified against when the
    email matches no account, so that path costs the same as a real check."""
    return hash_password(secrets.token_urlsafe(16))


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(
    request: Request, payload: LoginRequest, db: AsyncSession = Depends(get_db)
):
    user = await users_svc.get_user_by_email(db, payload.email)
    # bcrypt is CPU-bound (~100-300ms) — off the event loop so one login
    # burst can't stall every other concurrent request in this worker. It runs
    # for unknown and disabled accounts too (against a dummy hash), so response
    # time doesn't reveal which accounts exist or are switched off.
    password_ok = await run_in_threadpool(
        verify_password,
        payload.password,
        user.password_hash if user is not None else _dummy_hash(),
    )
    if user is None or not user.is_active or not password_ok:
        # A disabled account fails identically to a bad password — the caller
        # learns nothing about which accounts exist or are switched off.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    token = create_access_token(user.id, user.token_epoch)
    return TokenResponse(
        access_token=token, user=UserResponse.model_validate(user)
    )


@router.post("/change-password", response_model=TokenResponse)
@limiter.limit("5/minute")
async def change_password(
    request: Request,
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """See `services.users.change_password`. The current device stays signed
    in on the fresh token returned here, while every other session is cut off."""
    user = await users_svc.change_password(
        db, user, payload.current_password, payload.new_password
    )
    token = create_access_token(user.id, user.token_epoch)
    return TokenResponse(
        access_token=token, user=UserResponse.model_validate(user)
    )


@router.post("/logout")
async def logout(_: User = Depends(get_current_user)):
    # Stateless JWT: nothing to invalidate server-side.
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
async def me(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    department_id = None
    class_program_id = None
    class_semester = None
    if user.role == UserRoleEnum.HOD:
        department_id = await hod_department_id(db, user)
    if user.role == UserRoleEnum.STUDENT_REP:
        class_program_id = user.program_id
        class_semester = user.class_semester
    return MeResponse(
        user=UserResponse.model_validate(user),
        department_id=department_id,
        class_program_id=class_program_id,
        class_semester=class_semester,
    )
