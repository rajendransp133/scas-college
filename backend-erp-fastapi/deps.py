"""FastAPI dependencies: current-user resolution + capability / scope guards."""

from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.connection import get_db
from models import CourseAssignment, User
from permissions import Capabilities, role_capabilities
from security import decode_token

import services.cache as cache_keys
from services.cache import cached

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    cred: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if cred is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    decoded = decode_token(cred.credentials)
    if decoded is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    sub, epoch = decoded
    user = await db.get(User, sub)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    # A disabled account keeps no access, even with a still-valid token.
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is disabled"
        )
    # Reject a token minted at any other epoch than the account's current one —
    # this is what makes a password change / disable cut off outstanding tokens.
    if epoch != user.token_epoch:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked"
        )
    # Stashed for the request-logging middleware in main.py.
    request.state.user_id = user.id
    return user


def caps_of(user: User) -> Capabilities:
    return role_capabilities(user.role)


def require_capability(flag: str):
    """Dependency factory: 403 unless the current user's capability `flag` is truthy."""

    async def _dep(user: User = Depends(get_current_user)) -> User:
        if not getattr(caps_of(user), flag):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing capability: {flag}",
            )
        return user

    return _dep


async def current_term_id(db: AsyncSession) -> Optional[str]:
    from services.integrity import get_settings

    return (await get_settings(db))["currentTermId"]


async def own_course_ids(db: AsyncSession, user: User, term_id: str) -> set[str]:
    """The caller's assigned courses for a term.

    Resolved on nearly every request from any account with a linked teacher
    record, and only changes when someone is assigned/unassigned — so it is
    cached per (teacher, term) and invalidated by the assignment writes.
    """
    if not user.teacher_id:
        return set()

    async def load() -> list[str]:
        rows = await db.execute(
            select(CourseAssignment.course_id).where(
                CourseAssignment.teacher_id == user.teacher_id,
                CourseAssignment.term_id == term_id,
            )
        )
        return sorted(r[0] for r in rows.all())

    # A fresh set per call: the cached value is shared, and callers union into
    # what they get back (an HOD's scope adds the department's courses).
    return set(
        await cached(f"{cache_keys.ASSIGNMENTS}:own:{user.teacher_id}:{term_id}", load)
    )


async def ensure_can_mark(
    db: AsyncSession, user: User, course_id: str, term_id: str
) -> None:
    """Mirror the frontend markScope check: all → ok; own → must be assigned to
    the course in this term; none → forbidden."""
    scope = caps_of(user).mark_scope
    if scope == "all":
        return
    if scope == "own":
        if course_id in await own_course_ids(db, user, term_id):
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only mark attendance for your own assigned courses",
        )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You are not allowed to mark attendance",
    )
