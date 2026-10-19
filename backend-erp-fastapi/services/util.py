from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Mapping, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from ids import new_id  # re-export  # noqa: F401


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_local() -> date:
    """Today's date where the college is, not where the server is.

    The container clock is UTC, so `date.today()` is *yesterday* for an IST
    college between 00:00 and 05:30 — exactly when nothing looks wrong. Every
    "today" an end user sees (sessions marked today, the no-future-dates rule)
    goes through here.
    """
    return datetime.now(ZoneInfo(settings.college_timezone)).date()


def apply_updates(obj, data) -> None:
    """Apply a Pydantic *Update model's set fields onto an ORM object."""
    for key, value in data.model_dump(exclude_unset=True, by_alias=False).items():
        setattr(obj, key, value)


def not_found(detail: str = "Not found") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def unprocessable(detail: str) -> HTTPException:
    # Literal: Starlette renamed the constant (…_ENTITY → …_CONTENT).
    return HTTPException(status_code=422, detail=detail)


# --- IntegrityError → HTTP --------------------------------------------------
#
# The database is the last line for every uniqueness/FK rule: a check-then-insert
# in a service only narrows the race, it never closes it. So every write commits
# through `commit_or_raise`, which turns the constraint the database actually
# rejected into the status the API contract promises (duplicate → 409,
# reference to something that doesn't exist → 422) instead of a 500.
#
# Keyed by *constraint name*, not by "any IntegrityError means a duplicate":
# that assumption is how a bad departmentId used to come back as "Roll number
# already exists".

_UNIQUE = "23505"
_FOREIGN_KEY = "23503"
_NOT_NULL = "23502"
_CHECK = "23514"


def _pg_error(exc: IntegrityError) -> tuple[Optional[str], Optional[str]]:
    """(sqlstate, constraint_name) from the driver error under SQLAlchemy's."""
    orig = exc.orig
    for candidate in (orig, getattr(orig, "__cause__", None)):
        if candidate is None:
            continue
        sqlstate = getattr(candidate, "sqlstate", None) or getattr(
            candidate, "pgcode", None
        )
        constraint = getattr(candidate, "constraint_name", None)
        if sqlstate or constraint:
            return sqlstate, constraint
    return None, None


def integrity_http_error(
    exc: IntegrityError, messages: Mapping[str, str] | None = None
) -> HTTPException:
    sqlstate, constraint = _pg_error(exc)
    message = (messages or {}).get(constraint or "")
    if sqlstate == _FOREIGN_KEY:
        return unprocessable(message or "A referenced record does not exist")
    if sqlstate in (_NOT_NULL, _CHECK):
        return unprocessable(message or "A field has an invalid or missing value")
    return conflict(message or "This conflicts with an existing record")


async def commit_or_raise(
    db: AsyncSession, messages: Mapping[str, str] | None = None
) -> None:
    """Commit; on a constraint violation roll back and raise the mapped HTTP error.

    `messages` maps constraint names to the human message for that rule.
    """
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise integrity_http_error(exc, messages) from None


async def flush_or_raise(
    db: AsyncSession, messages: Mapping[str, str] | None = None
) -> None:
    """`commit_or_raise` for a flush mid-transaction (e.g. before an audit write
    that must only happen if the row went in)."""
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise integrity_http_error(exc, messages) from None
