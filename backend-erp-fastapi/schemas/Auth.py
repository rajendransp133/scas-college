from __future__ import annotations

from typing import Optional

from pydantic import Field

from schemas.base import CamelModel
from schemas.User import UserResponse


class LoginRequest(CamelModel):
    email: str
    password: str


class ChangePasswordRequest(CamelModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, max_length=128)


class TokenResponse(CamelModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class MeResponse(CamelModel):
    user: UserResponse
    # Derived scope, mirroring the frontend useAuth().
    department_id: Optional[str] = None
    class_program_id: Optional[str] = None
    class_semester: Optional[int] = None
