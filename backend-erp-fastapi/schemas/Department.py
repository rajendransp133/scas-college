from __future__ import annotations

from typing import Optional

from pydantic import Field

from schemas.base import CamelModel


class DepartmentBase(CamelModel):
    name: str = Field(..., min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=20)


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(CamelModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    code: Optional[str] = Field(None, min_length=1, max_length=20)


class DepartmentResponse(DepartmentBase):
    id: str


class DepartmentDetailResponse(DepartmentResponse):
    programs: list["ProgramResponse"] = []
    teachers: list["TeacherResponse"] = []


from schemas.Program import ProgramResponse  # noqa: E402
from schemas.Teacher import TeacherResponse  # noqa: E402

DepartmentDetailResponse.model_rebuild()
