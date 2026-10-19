from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import EmailStr, Field, model_validator

from enums.Gender import GenderEnum
from schemas.base import CamelModel, UpdateModel

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


class StudentUpdate(UpdateModel, BlankToNull):
    # Placement stays required on update for the same reason as on create: it
    # decides roster membership. Clearing it would hide the student from every
    # register (`null` here used to reach the DB, or worse, succeed).
    NOT_NULL = frozenset(
        {"name", "department_id", "program_id", "current_semester", "is_active", "graduated"}
    )

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


# Personal fields blanked out for readers without `view_student_pii`. Deliberately
# *not* roll number / name / class placement (those are what a roster is), and not
# the lifecycle flags (isActive/graduated drive the "Left"/"Graduated" tags every
# viewer sees) — only the contact/identity data a teacher or class-rep login has no
# business reading off a classmate.
_PII_FIELDS = (
    "email",
    "phone",
    "address",
    "date_of_birth",
    "guardian_name",
    "guardian_relation",
    "guardian_phone",
)


def redact_student(student, include_pii: bool) -> StudentResponse:
    """A student's API shape, with personal fields nulled unless `include_pii`.

    The response model is unchanged (every PII field is already `Optional`), so a
    redacted record is indistinguishable in shape from one where the registrar
    simply hasn't filled those fields in yet — the client renders both as `—`.
    """
    resp = StudentResponse.model_validate(student)
    if not include_pii:
        for field in _PII_FIELDS:
            setattr(resp, field, None)
    return resp


def redact_students(students, include_pii: bool) -> list[StudentResponse]:
    return [redact_student(s, include_pii) for s in students]
