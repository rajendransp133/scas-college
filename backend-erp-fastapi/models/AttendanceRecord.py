from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from enums.AttendanceStatus import AttendanceStatusEnum
from models.base import Base, str_enum
from models.Repr import Repr


class AttendanceRecord(Base, Repr):
    __tablename__ = "attendance_record"
    __table_args__ = (
        UniqueConstraint("session_id", "student_id", name="uq_record_session_student"),
        # Attendance aggregation (attended/held per student) reads only these
        # three columns — a covering index turns it into an index-only scan.
        Index(
            "ix_record_session_student_status", "session_id", "student_id", "status"
        ),
        Index("ix_record_student_status", "student_id", "status"),
        # Corrected-cell reporting: only a small fraction of rows qualify.
        Index(
            "ix_record_corrected",
            "session_id",
            "student_id",
            postgresql_where=text("original_status IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("attendance_session.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[str] = mapped_column(
        ForeignKey("student.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[AttendanceStatusEnum] = mapped_column(
        str_enum(AttendanceStatusEnum, "attendance_status_enum"), nullable=False
    )
    original_status: Mapped[AttendanceStatusEnum | None] = mapped_column(
        str_enum(AttendanceStatusEnum, "attendance_status_enum"), nullable=True
    )
    edited_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    session: Mapped["AttendanceSession"] = relationship(back_populates="records")
