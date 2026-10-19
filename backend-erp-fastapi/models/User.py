from __future__ import annotations

from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from enums.UserRole import UserRoleEnum
from models.base import Base, str_enum
from models.Repr import Repr


class User(Base, Repr):
    __tablename__ = "app_user"
    __table_args__ = (
        # Login matches on lower(email); the plain unique index can't serve it.
        Index("ix_user_email_lower", text("lower(email)"), unique=True),
        # One student-rep account per (program, semester), enforced by the
        # database — the service-level check alone lost the race to two
        # concurrent creates (alembic a7d2c4e9f1b3).
        Index(
            "uq_user_rep_class",
            "program_id",
            "class_semester",
            unique=True,
            postgresql_where=text("role = 'student-rep'"),
        ),
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
    # Soft-disable: a departing/suspended account is deactivated, not deleted, so
    # its audit-actor links survive. `get_current_user` rejects inactive logins.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), default=True
    )
    # Token generation counter. Every JWT carries the epoch it was minted at;
    # `get_current_user` rejects a token whose epoch is behind the account's
    # current value. Bumped on password change and on disable, which is what
    # makes those actions actually cut off an outstanding token (a stateless
    # JWT is otherwise valid until it expires — up to 12h).
    token_epoch: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
