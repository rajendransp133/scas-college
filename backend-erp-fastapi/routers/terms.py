from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

import services.terms as svc
from database.connection import get_db
from deps import get_current_user, require_capability
from models import User
from schemas.Term import SetCurrentTermPayload, TermCreate, TermResponse

router = APIRouter(prefix="/terms", tags=["terms"])
_academics = require_capability("manage_academics")


@router.get("", response_model=list[TermResponse])
async def list_terms(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    return await svc.list_terms(db)


@router.post("", response_model=TermResponse, status_code=status.HTTP_201_CREATED)
async def add_term(
    data: TermCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    return await svc.add_term(db, data)


@router.put("/current", response_model=TermResponse)
async def set_current_term(
    payload: SetCurrentTermPayload,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    return await svc.set_current_term(db, payload.term_id)
