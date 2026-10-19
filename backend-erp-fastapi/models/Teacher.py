from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from enums.Designation import DesignationEnum
from models.base import Base, str_enum
from models.Repr import Repr


class Teacher(Base, Repr):
    __tablename__ = "teacher"
    __table_args__ = (
        # At most one HOD per department (partial unique index).
        Index(
            "uq_one_hod_per_department",
            "department_id",
            unique=True,
            postgresql_where=text("is_hod"),
        ),
        # List path: filter by department, always ordered by name.
        Index("ix_teacher_dept_name", "department_id", "name"),
        Index("ix_teacher_name", "name"),
        Index(
            "ix_teacher_name_trgm",
            text("lower(name) gin_trgm_ops"),
            postgresql_using="gin",
        ),
        Index(
            "ix_teacher_empid_trgm",
            text("lower(employee_id) gin_trgm_ops"),
            postgresql_using="gin",
        ),
    )

    # Only the identity pair (employee id + name) is mandatory here; the
    # department placement is required by the API layer rather than the column,
    # which stays nullable so deleting a department orphans teachers instead of
    # deleting them (see the FK below). Everything else is back-fillable — the
    # office rarely has a full staff record on the day someone is added.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    employee_id: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # Unique but nullable: Postgres allows many NULLs under a UNIQUE index, so
    # any number of teachers can exist without an email on file.
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Kept NOT NULL: unlike the others this has a sensible default the API
    # applies ("Assistant Professor"), so a caller never has to supply it.
    designation: Mapped[DesignationEnum] = mapped_column(
        str_enum(DesignationEnum, "designation_enum"), nullable=False
    )
    qualification: Mapped[str | None] = mapped_column(String(255), nullable=True)
    joining_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_hod: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Orphan (not delete) teachers when their department is removed.
    department_id: Mapped[str | None] = mapped_column(
        ForeignKey("department.id", ondelete="SET NULL"), nullable=True
    )

    department: Mapped["Department | None"] = relationship(back_populates="teachers")
