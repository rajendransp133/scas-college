from __future__ import annotations

from typing import Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from enums.AuditAction import AuditActionEnum
from models import AppSettings, AuditEntry, User
from models.AppSettings import SETTINGS_ID
import services.cache as cache_keys
from services.audit import make_audit
from services.cache import cached, invalidate
from services.pagination import PageParams, paginate


async def _get_settings(db: AsyncSession) -> AppSettings:
    row = await db.get(AppSettings, SETTINGS_ID)
    if row is None:
        row = AppSettings(id=SETTINGS_ID)
        db.add(row)
    return row


async def get_lock_date(db: AsyncSession) -> Optional[str]:
    return (await get_settings(db))["lockDate"]


async def get_settings(db: AsyncSession) -> dict:
    """App-wide state the whole frontend is scoped by: the current term + lock
    date. Requested by every page on every load and written only by
    `set_lock_date` / `set_current_term`, both of which invalidate — so it is
    cached."""

    async def load() -> dict:
        row = await db.get(AppSettings, SETTINGS_ID)
        return {
            "currentTermId": row.current_term_id if row else None,
            "lockDate": row.lock_date if row else None,
        }

    return await cached(f"{cache_keys.SETTINGS}:global", load)


async def set_lock_date(
    db: AsyncSession, user: User, date: Optional[str]
) -> Optional[str]:
    settings_row = await _get_settings(db)
    settings_row.lock_date = date
    action = AuditActionEnum.LOCK if date else AuditActionEnum.UNLOCK
    note = f"Attendance locked up to {date}" if date else "Attendance unlocked"
    db.add(make_audit(user.id, action, note=note))
    await db.commit()
    # The lock guard reads this on every attendance write — drop the cached
    # copy immediately rather than waiting out the TTL.
    invalidate(cache_keys.SETTINGS)
    return date


async def list_audit(
    db: AsyncSession,
    params: PageParams,
    term_id: Optional[str] = None,
    action: Optional[AuditActionEnum] = None,
    user_id: Optional[str] = None,
    student_id: Optional[str] = None,
    course_id: Optional[str] = None,
) -> tuple[list[AuditEntry], int]:
    stmt = select(AuditEntry)
    if term_id:
        # Lock/unlock entries carry no termId and must stay visible in every
        # term — the freeze applies to the whole college, not one term.
        stmt = stmt.where(
            or_(AuditEntry.term_id == term_id, AuditEntry.term_id.is_(None))
        )
    if action:
        stmt = stmt.where(AuditEntry.action == action)
    if user_id:
        stmt = stmt.where(AuditEntry.user_id == user_id)
    if student_id:
        stmt = stmt.where(AuditEntry.student_id == student_id)
    if course_id:
        stmt = stmt.where(AuditEntry.course_id == course_id)
    stmt = stmt.order_by(AuditEntry.at.desc())
    items, total = await paginate(db, stmt, params)
    return list(items), total


async def list_lock_history(db: AsyncSession, limit: int = 50) -> list[AuditEntry]:
    """The lock/unlock timeline on the oversight page. These entries carry no
    termId, so they're fetched by action rather than through the term filter."""
    rows = await db.execute(
        select(AuditEntry)
        .where(
            AuditEntry.action.in_([AuditActionEnum.LOCK, AuditActionEnum.UNLOCK])
        )
        .order_by(AuditEntry.at.desc())
        .limit(limit)
    )
    return list(rows.scalars().all())
