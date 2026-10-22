from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from enums.AttendanceStatus import AttendanceStatusEnum
from enums.AuditAction import AuditActionEnum
from models.base import Base, str_enum
from models.Repr import Repr


class AuditEntry(Base, Repr):
    """Append-only log. References are soft (plain strings, no FKs) so entries
    survive deletion of whatever they reference."""

    __tablename__ = "audit_entry"
    # The log is only ever read newest-first, optionally narrowed by one facet,
    # so every index leads with that facet and carries `at DESC` for the sort.
    __table_args__ = (
        Index("ix_audit_at", text("at DESC")),
        Index("ix_audit_term_at", "term_id", text("at DESC")),
        Index("ix_audit_user_at", "user_id", text("at DESC")),
        Index("ix_audit_action_at", "action", text("at DESC")),
        Index("ix_audit_student_at", "student_id", text("at DESC")),
        Index("ix_audit_course_at", "course_id", text("at DESC")),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    action: Mapped[AuditActionEnum] = mapped_column(
        str_enum(AuditActionEnum, "audit_action_enum", length=32), nullable=False
    )
    course_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    term_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    period: Mapped[int | None] = mapped_column(Integer, nullable=True)
    student_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    from_status: Mapped[AttendanceStatusEnum | None] = mapped_column(
        str_enum(AttendanceStatusEnum, "attendance_status_enum"), nullable=True
    )
    to_status: Mapped[AttendanceStatusEnum | None] = mapped_column(
        str_enum(AttendanceStatusEnum, "attendance_status_enum"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
