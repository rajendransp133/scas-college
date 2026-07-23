from __future__ import annotations

from sqlalchemy import Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from enums.TermParity import TermParityEnum
from models.base import Base, str_enum
from models.Repr import Repr


class AcademicTerm(Base, Repr):
    __tablename__ = "academic_term"
    __table_args__ = (
        UniqueConstraint("start_year", "parity", name="uq_term_year_parity"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    start_year: Mapped[int] = mapped_column(Integer, nullable=False)
    end_year: Mapped[int] = mapped_column(Integer, nullable=False)
    parity: Mapped[TermParityEnum] = mapped_column(
        str_enum(TermParityEnum, "term_parity_enum"), nullable=False
    )
