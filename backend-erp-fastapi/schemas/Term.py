from __future__ import annotations

from pydantic import Field

from enums.TermParity import TermParityEnum
from schemas.base import CamelModel


class TermCreate(CamelModel):
    start_year: int = Field(..., ge=2000, le=2100)
    parity: TermParityEnum


class TermResponse(CamelModel):
    id: str
    name: str
    start_year: int
    end_year: int
    parity: TermParityEnum


class SetCurrentTermPayload(CamelModel):
    term_id: str
