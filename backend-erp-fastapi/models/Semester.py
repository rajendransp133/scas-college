from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base
from models.Repr import Repr


class Semester(Base, Repr):
    __tablename__ = "semester"
    __table_args__ = (
        UniqueConstraint("program_id", "number", name="uq_semester_program_number"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    program_id: Mapped[str] = mapped_column(
        ForeignKey("program.id", ondelete="CASCADE"), nullable=False, index=True
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)

    program: Mapped["Program"] = relationship(back_populates="semesters")
    # lazy="raise" — see Department.programs. Loaded explicitly by the
    # curriculum endpoints (GET /semesters, GET /programs/{id}).
    courses: Mapped[list["Course"]] = relationship(
        back_populates="semester",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="raise",
        order_by="Course.code",
    )
