from __future__ import annotations

from typing import Optional

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from enums.CourseType import CourseTypeEnum
from models.base import Base, str_enum
from models.Repr import Repr


class Course(Base, Repr):
    __tablename__ = "course"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(30), nullable=False)
    credits: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[Optional[CourseTypeEnum]] = mapped_column(
        str_enum(CourseTypeEnum, "course_type_enum"), nullable=True
    )
    semester_id: Mapped[str] = mapped_column(
        ForeignKey("semester.id", ondelete="CASCADE"), nullable=False, index=True
    )

    semester: Mapped["Semester"] = relationship(back_populates="courses")
