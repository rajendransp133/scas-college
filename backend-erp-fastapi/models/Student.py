from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from enums.Gender import GenderEnum
from models.base import Base, str_enum
from models.Repr import Repr


class Student(Base, Repr):
    __tablename__ = "student"
    __table_args__ = (
        # List/filter path: department → program → semester.
        Index("ix_student_program_semester", "program_id", "current_semester"),
        Index("ix_student_dept_program", "department_id", "program_id"),
        # Roster lookup (the hottest attendance query): only enrolled students
        # are ever rostered, so a partial index keeps it tiny and selective.
        Index(
            "ix_student_roster",
            "program_id",
            "current_semester",
            postgresql_where=text("is_active AND NOT graduated"),
        ),
        # Substring search on name / roll number (ILIKE '%q%') — btree can't
        # serve those, so trigram GIN indexes do.
        Index(
            "ix_student_name_trgm",
            text("lower(name) gin_trgm_ops"),
            postgresql_using="gin",
        ),
        Index(
            "ix_student_roll_trgm",
            text("lower(roll_number) gin_trgm_ops"),
            postgresql_using="gin",
        ),
    )

    # Only roll number and name are mandatory at intake — admissions staff
    # often have nothing else on the day a student is enrolled. Program and
    # semester stay required because they decide which class roster the
    # student appears in for attendance; everything below them is nullable and
    # gets filled in later.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    roll_number: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[GenderEnum | None] = mapped_column(
        str_enum(GenderEnum, "gender_enum"), nullable=True
    )
    current_semester: Mapped[int] = mapped_column(Integer, nullable=False)
    admission_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    guardian_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    guardian_relation: Mapped[str | None] = mapped_column(String(40), nullable=True)
    guardian_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    graduated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Orphan (not delete) students when their department/program is removed.
    department_id: Mapped[str | None] = mapped_column(
        ForeignKey("department.id", ondelete="SET NULL"), nullable=True, index=True
    )
    program_id: Mapped[str | None] = mapped_column(
        ForeignKey("program.id", ondelete="SET NULL"), nullable=True, index=True
    )
