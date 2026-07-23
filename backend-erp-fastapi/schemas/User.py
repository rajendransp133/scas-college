from __future__ import annotations

from typing import Optional

from pydantic import EmailStr, Field

from enums.UserRole import UserRoleEnum
from schemas.base import CamelModel


class UserBase(CamelModel):
    name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    role: UserRoleEnum
    teacher_id: Optional[str] = None
    program_id: Optional[str] = None
    class_semester: Optional[int] = Field(None, ge=1, le=12)


class UserCreate(UserBase):
    password: str = Field(..., min_length=1, max_length=128)


class UserUpdate(CamelModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    email: Optional[EmailStr] = None
    password: Optional[str] = Field(None, min_length=1, max_length=128)
    role: Optional[UserRoleEnum] = None
    teacher_id: Optional[str] = None
    program_id: Optional[str] = None
    class_semester: Optional[int] = Field(None, ge=1, le=12)


class UserResponse(UserBase):
    id: str


class UserDirectoryEntry(CamelModel):
    """Minimal id→name lookup, readable by any authenticated user (for
    resolving marked-by / editor / audit-actor names across the app)."""

    id: str
    name: str
