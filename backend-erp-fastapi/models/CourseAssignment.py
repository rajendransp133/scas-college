from __future__ import annotations

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base
from models.Repr import Repr


class CourseAssignment(Base, Repr):
    __tablename__ = "course_assignment"
    __table_args__ = (
        UniqueConstraint(
            "course_id", "teacher_id", "term_id", name="uq_assignment_triple"
        ),
        # "My courses this term" — resolved on nearly every request for any
        # account with a linked teacher record.
        Index("ix_assignment_teacher_term", "teacher_id", "term_id"),
        # Staffing views: everything assigned in a term.
        Index("ix_assignment_term_course", "term_id", "course_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    course_id: Mapped[str] = mapped_column(
        ForeignKey("course.id", ondelete="CASCADE"), nullable=False
    )
    teacher_id: Mapped[str] = mapped_column(
        ForeignKey("teacher.id", ondelete="CASCADE"), nullable=False
    )
    term_id: Mapped[str] = mapped_column(
        ForeignKey("academic_term.id", ondelete="RESTRICT"), nullable=False
    )
