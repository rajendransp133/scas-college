from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import EmailStr, Field, model_validator

from enums.Gender import GenderEnum
from schemas.base import CamelModel

# Fields a client may legitimately leave blank. An HTML form submits "" for an
# untouched input, not null, so both spellings have to mean "not provided" —
# otherwise `""` fails EmailStr validation and empty strings pile up in columns
# that are supposed to read as absent.
_BLANKABLE = frozenset(
    {
        "email",
        "phone",
        "address",
        "dateOfBirth",
        "date_of_birth",
        "gender",
        "guardianName",
        "guardian_name",
        "guardianRelation",
        "guardian_relation",
        "guardianPhone",
        "guardian_phone",
    }
)


class BlankToNull(CamelModel):
    @model_validator(mode="before")
    @classmethod
    def _blank_to_null(cls, data):
        if not isinstance(data, dict):
            return data
        return {
            k: (None if k in _BLANKABLE and isinstance(v, str) and not v.strip() else v)
            for k, v in data.items()
        }


class StudentBase(BlankToNull):
    # Mandatory at intake: identity (roll number + name) and the class the
    # student belongs to (department/program/semester, which drive the
    # attendance roster). Every other field is optional and back-fillable.
    roll_number: str = Field(..., min_length=1, max_length=40)
    name: str = Field(..., min_length=1, max_length=100)
    department_id: str
    program_id: str
    current_semester: int = Field(..., ge=1, le=12)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=30)
    address: Optional[str] = Field(None, max_length=255)
    date_of_birth: Optional[date] = None
    gender: Optional[GenderEnum] = None
    admission_year: Optional[int] = Field(None, ge=1900, le=2100)
    guardian_name: Optional[str] = Field(None, max_length=100)
    guardian_relation: Optional[str] = Field(None, max_length=40)
    guardian_phone: Optional[str] = Field(None, max_length=30)
    is_active: bool = True
    graduated: bool = False


class StudentCreate(StudentBase):
    pass


class StudentUpdate(BlankToNull):
    # roll_number is locked once created — intentionally omitted.
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    # The optional fields carry no min_length: sending null (or "", which
    # `services/students.py` normalises to null) is how you clear one.
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=30)
    address: Optional[str] = Field(None, max_length=255)
    date_of_birth: Optional[date] = None
    gender: Optional[GenderEnum] = None
    department_id: Optional[str] = None
    program_id: Optional[str] = None
    current_semester: Optional[int] = Field(None, ge=1, le=12)
    admission_year: Optional[int] = Field(None, ge=1900, le=2100)
    guardian_name: Optional[str] = Field(None, max_length=100)
    guardian_relation: Optional[str] = Field(None, max_length=40)
    guardian_phone: Optional[str] = Field(None, max_length=30)
    is_active: Optional[bool] = None
    graduated: Optional[bool] = None


class StudentResponse(StudentBase):
    id: str
    # Orphaned when the department/program is deleted (FK SET NULL).
    department_id: Optional[str] = None
    program_id: Optional[str] = None


class IdListPayload(CamelModel):
    ids: list[str]
