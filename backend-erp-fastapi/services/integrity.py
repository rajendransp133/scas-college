from __future__ import annotations

from typing import Optional

from sqlalchemy import select, union_all
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

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
    await invalidate(cache_keys.SETTINGS)
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
    filters = []
    if action:
        filters.append(AuditEntry.action == action)
    if user_id:
        filters.append(AuditEntry.user_id == user_id)
    if student_id:
        filters.append(AuditEntry.student_id == student_id)
    if course_id:
        filters.append(AuditEntry.course_id == course_id)

    if not term_id:
        stmt = select(AuditEntry).where(*filters).order_by(AuditEntry.at.desc())
    else:
        # Entries with no termId (lock/unlock, cascade deletes) concern the
        # whole college and stay visible in every term. Written as UNION ALL
        # rather than `term_id = X OR term_id IS NULL`: each branch is an
        # ordered scan of ix_audit_term_at, which Postgres can merge and stop
        # at the page limit; the OR form bitmap-scans the term and sorts it.
        branches = union_all(
            select(AuditEntry).where(AuditEntry.term_id == term_id, *filters),
            select(AuditEntry).where(AuditEntry.term_id.is_(None), *filters),
        ).subquery()
        entry = aliased(AuditEntry, branches)
        stmt = select(entry).order_by(entry.at.desc())
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
