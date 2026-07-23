from __future__ import annotations

from typing import Optional

from sqlalchemy import ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from enums.UserRole import UserRoleEnum
from models.base import Base, str_enum
from models.Repr import Repr


class User(Base, Repr):
    __tablename__ = "app_user"
    __table_args__ = (
        # Login matches on lower(email); the plain unique index can't serve it.
        Index("ix_user_email_lower", text("lower(email)"), unique=True),
        # One student-rep account per (program, semester) — the uniqueness check
        # on every user write.
        Index("ix_user_rep_class", "program_id", "class_semester"),
        Index("ix_user_teacher_id", "teacher_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRoleEnum] = mapped_column(
        str_enum(UserRoleEnum, "user_role_enum"), nullable=False
    )
    # teacher/hod (required) or principal (optional); unlinked (SET NULL) when teacher deleted.
    teacher_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("teacher.id", ondelete="SET NULL"), nullable=True
    )
    # student-rep only.
    program_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("program.id", ondelete="SET NULL"), nullable=True
    )
    class_semester: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
