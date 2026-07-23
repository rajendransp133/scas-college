from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

import services.semesters as svc
from database.connection import get_db
from deps import get_current_user, require_capability
from models import User
from schemas.Course import CourseCreate, CourseResponse
from schemas.Semester import SemesterCreate, SemesterResponse

router = APIRouter(prefix="/semesters", tags=["semesters"])
_academics = require_capability("manage_academics")


@router.get("", response_model=list[SemesterResponse])
async def list_semesters(
    program_id: str = Query(..., alias="programId"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # Readable by any authenticated user: teachers/reps/attendance-managers need
    # curriculum structure to show course names. Mutations stay academics-gated.
    return await svc.list_semesters(db, program_id)


@router.post("", response_model=SemesterResponse, status_code=status.HTTP_201_CREATED)
async def add_semester(
    data: SemesterCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    return await svc.add_semester(db, data)


@router.delete("/{semester_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_semester(
    semester_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    await svc.delete_semester(db, semester_id)


@router.post(
    "/{semester_id}/courses",
    response_model=CourseResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_course(
    semester_id: str,
    data: CourseCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    return await svc.add_course(db, semester_id, data)


@router.delete(
    "/{semester_id}/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_course(
    semester_id: str,
    course_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_academics),
):
    await svc.delete_course(db, semester_id, course_id)
