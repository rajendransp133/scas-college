from __future__ import annotations

from datetime import date
from typing import Annotated, Optional

from pydantic import BeforeValidator, EmailStr, Field

from enums.Designation import DesignationEnum
from schemas.base import CamelModel


def _blank_to_none(v: object) -> object:
    """Treat a whitespace-only string as "not supplied".

    HTML inputs post `""` for every field the user left alone, so without this
    an untouched Email or Joining date box would fail validation instead of
    simply staying empty. Applied to every optional field below.
    """
    if isinstance(v, str) and not v.strip():
        return None
    return v


Blankable = Annotated[Optional[str], BeforeValidator(_blank_to_none)]
BlankableDate = Annotated[Optional[date], BeforeValidator(_blank_to_none)]
BlankableEmail = Annotated[Optional[EmailStr], BeforeValidator(_blank_to_none)]


class TeacherBase(CamelModel):
    """Only identity (employee id + name) and the department are required.

    The department stays mandatory because it is what makes HOD-ship and
    course assignment meaningful — a teacher with no department belongs to no
    register. Everything else is optional and back-fillable; `designation`
    defaults rather than being nullable, so callers can omit it too.
    """

    employee_id: str = Field(..., min_length=1, max_length=40)
    name: str = Field(..., min_length=1, max_length=100)
    department_id: str = Field(..., min_length=1)
    email: BlankableEmail = None
    phone: Blankable = Field(None, max_length=30)
    designation: DesignationEnum = DesignationEnum.ASSISTANT_PROFESSOR
    qualification: Blankable = Field(None, max_length=255)
    joining_date: BlankableDate = None
    is_hod: bool = False


class TeacherCreate(TeacherBase):
    pass


class TeacherUpdate(CamelModel):
    employee_id: Optional[str] = Field(None, min_length=1, max_length=40)
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    department_id: Optional[str] = None
    email: BlankableEmail = None
    phone: Blankable = Field(None, max_length=30)
    designation: Optional[DesignationEnum] = None
    qualification: Blankable = Field(None, max_length=255)
    joining_date: BlankableDate = None
    is_hod: Optional[bool] = None


class TeacherResponse(TeacherBase):
    id: str
    # Orphaned when the department is deleted (FK SET NULL), so unlike on the
    # write schemas this one can come back empty.
    department_id: Optional[str] = None


class SetHodPayload(CamelModel):
    is_hod: bool
