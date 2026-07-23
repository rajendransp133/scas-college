from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from ids import new_id  # re-export  # noqa: F401


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def apply_updates(obj, data) -> None:
    """Apply a Pydantic *Update model's set fields onto an ORM object."""
    for key, value in data.model_dump(exclude_unset=True, by_alias=False).items():
        setattr(obj, key, value)


def not_found(detail: str = "Not found") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
