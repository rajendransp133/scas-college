from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

import services.cache as cache_keys
from enums.AuditAction import AuditActionEnum
from enums.TermParity import TermParityEnum
from ids import new_id
from models import AcademicTerm, AppSettings, User
from models.AppSettings import SETTINGS_ID
from schemas.Term import TermCreate, TermResponse
from services.audit import make_audit
from services.cache import cached, invalidate
from services.util import conflict, not_found


def term_label(start_year: int, parity: TermParityEnum) -> str:
    half = "Odd" if parity == TermParityEnum.ODD else "Even"
    return f"{start_year}-{str(start_year + 1)[2:]} ({half})"


async def list_terms(db: AsyncSession) -> list[dict]:
    """A dozen rows, read by the term switcher on every page, written twice a
    year — the clearest caching case in the app. Cached as plain dicts: ORM
    instances are bound to the session that loaded them."""

    async def load() -> list[dict]:
        rows = await db.execute(
            select(AcademicTerm).order_by(
                AcademicTerm.start_year, AcademicTerm.parity
            )
        )
        return [
            TermResponse.model_validate(t).model_dump(mode="json")
            for t in rows.scalars().all()
        ]

    return await cached(f"{cache_keys.TERMS}:all", load)


async def add_term(db: AsyncSession, data: TermCreate, actor: User) -> AcademicTerm:
    term = AcademicTerm(
        id=new_id("term"),
        name=term_label(data.start_year, data.parity),
        start_year=data.start_year,
        end_year=data.start_year + 1,
        parity=data.parity,
    )
    db.add(term)
    db.add(
        make_audit(
            actor.id,
            AuditActionEnum.CREATE_TERM,
            note=f"Created term {term.name} ({term.id})",
        )
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise conflict("A term with this year and parity already exists")
    await db.refresh(term)
    await invalidate(cache_keys.TERMS)
    return term


async def _get_settings(db: AsyncSession) -> AppSettings:
    row = await db.get(AppSettings, SETTINGS_ID)
    if row is None:
        row = AppSettings(id=SETTINGS_ID)
        db.add(row)
    return row


async def set_current_term(
    db: AsyncSession, term_id: str, actor: User
) -> AcademicTerm:
    term = await db.get(AcademicTerm, term_id)
    if term is None:
        raise not_found("Term not found")
    settings_row = await _get_settings(db)
    if settings_row.current_term_id != term_id:
        db.add(
            make_audit(
                actor.id,
                AuditActionEnum.SET_CURRENT_TERM,
                note=(
                    f"Current term changed from {settings_row.current_term_id or 'none'} "
                    f"to {term.name} ({term.id})"
                ),
            )
        )
    settings_row.current_term_id = term_id
    await db.commit()
    # The whole app is scoped by the current term — every cached view of it
    # must go, along with the per-teacher course sets keyed by term.
    await invalidate(cache_keys.SETTINGS, cache_keys.TERMS, cache_keys.ASSIGNMENTS)
    return term
