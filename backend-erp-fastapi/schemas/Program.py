from __future__ import annotations

from typing import Optional

from pydantic import Field

from enums.Level import LevelEnum
from schemas.base import CamelModel


class ProgramBase(CamelModel):
    name: str = Field(..., min_length=1, max_length=120)
    code: str = Field(..., min_length=1, max_length=20)
    level: LevelEnum
    department_id: str


class ProgramCreate(ProgramBase):
    # Number of semesters to auto-generate on create (1..N).
    semester_count: int = Field(..., ge=1, le=12)


class ProgramUpdate(CamelModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    code: Optional[str] = Field(None, min_length=1, max_length=20)
    level: Optional[LevelEnum] = None
    department_id: Optional[str] = None


class ProgramResponse(ProgramBase):
    id: str


class ProgramDetailResponse(ProgramResponse):
    semesters: list["SemesterResponse"] = []


from schemas.Semester import SemesterResponse  # noqa: E402

ProgramDetailResponse.model_rebuild()
