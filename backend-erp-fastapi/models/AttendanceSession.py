from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base
from models.Repr import Repr


class AttendanceSession(Base, Repr):
    __tablename__ = "attendance_session"
    __table_args__ = (
        UniqueConstraint(
            "course_id", "date", "period", name="uq_session_course_date_period"
        ),
        # Term-scoped listing, always ordered by (date, period) — this index
        # serves the filter and the sort together.
        Index("ix_session_term_date_period", "term_id", "date", "period"),
        # Register/summary path: one course within one term, by date.
        Index("ix_session_course_term_date", "course_id", "term_id", "date"),
        # "Sessions on this date" / date-range scans across all courses.
        Index("ix_session_date", "date"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    course_id: Mapped[str] = mapped_column(
        ForeignKey("course.id", ondelete="CASCADE"), nullable=False, index=True
    )
    term_id: Mapped[str] = mapped_column(
        ForeignKey("academic_term.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date: Mapped[str] = mapped_column(String(10), nullable=False)  # ISO yyyy-mm-dd
    period: Mapped[int] = mapped_column(Integer, nullable=False)
    marked_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    marked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    records: Mapped[list["AttendanceRecord"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )
