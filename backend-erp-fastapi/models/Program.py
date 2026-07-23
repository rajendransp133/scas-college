from __future__ import annotations

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from enums.Level import LevelEnum
from models.base import Base, str_enum
from models.Repr import Repr


class Program(Base, Repr):
    __tablename__ = "program"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    level: Mapped[LevelEnum] = mapped_column(
        str_enum(LevelEnum, "level_enum"), nullable=False
    )
    department_id: Mapped[str] = mapped_column(
        ForeignKey("department.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    department: Mapped["Department"] = relationship(back_populates="programs")
    # lazy="raise" — see Department.programs. Loaded explicitly by
    # GET /programs/{id} only.
    semesters: Mapped[list["Semester"]] = relationship(
        back_populates="program",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="raise",
        order_by="Semester.number",
    )
