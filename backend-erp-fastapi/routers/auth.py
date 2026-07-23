from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

import services.users as users_svc
from database.connection import get_db
from deps import get_current_user
from models import Teacher, User
from rate_limit import limiter
from enums.UserRole import UserRoleEnum
from schemas.Auth import (
    ChangePasswordRequest,
    LoginRequest,
    MeResponse,
    TokenResponse,
)
from schemas.User import UserResponse
from security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(
    request: Request, payload: LoginRequest, db: AsyncSession = Depends(get_db)
):
    user = await users_svc.get_user_by_email(db, payload.email)
    # bcrypt is CPU-bound (~100-300ms) — off the event loop so one login
    # burst can't stall every other concurrent request in this worker.
    if user is None or not await run_in_threadpool(
        verify_password, payload.password, user.password_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token, user=UserResponse.model_validate(user)
    )


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
async def change_password(
    request: Request,
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Self-service password change for every role except the class rep.

    Rep logins are one shared account per class, not a person's — letting any
    student holding it rotate the password would lock out the rest of the
    class. Those stay admin/principal-reset only, via `PUT /users/{id}`.
    """
    if user.role == UserRoleEnum.STUDENT_REP:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Class representative accounts are shared — ask an "
                "administrator to reset the password"
            ),
        )
    # Same threadpool treatment as login: two bcrypt calls back to back would
    # otherwise stall this worker's event loop for ~half a second.
    if not await run_in_threadpool(
        verify_password, payload.current_password, user.password_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from the current one",
        )
    user.password_hash = await run_in_threadpool(hash_password, payload.new_password)
    await db.commit()


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
    if user.role.value == "hod" and user.teacher_id:
        teacher = await db.get(Teacher, user.teacher_id)
        department_id = teacher.department_id if teacher else None
    if user.role.value == "student-rep":
        class_program_id = user.program_id
        class_semester = user.class_semester
    return MeResponse(
        user=UserResponse.model_validate(user),
        department_id=department_id,
        class_program_id=class_program_id,
        class_semester=class_semester,
    )
