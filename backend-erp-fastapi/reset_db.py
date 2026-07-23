"""Wipe every table and install a single administrator account.

The counterpart to `seed_production.py`: that installs the real college
structure into an empty database; this empties the database back down to the
one account needed to log in and start over. Dev-only.

Run:  python reset_db.py

Destructive and irreversible — it deletes every row in every table. Guarded by
`assert_not_production()` for the same reason the seeds are: pointing it at a
live college database would delete the real records.

The admin password is read from ADMIN_PASSWORD if set, so a real deployment
never has to hardcode one in the shell history or in this file.
"""

from __future__ import annotations

import asyncio
import os

from sqlalchemy import delete

from config import assert_not_production
from database.connection import async_session, engine
from enums.UserRole import UserRoleEnum
from models import (
    AcademicTerm,
    AppSettings,
    AttendanceRecord,
    AttendanceSession,
    AuditEntry,
    Course,
    CourseAssignment,
    Department,
    Program,
    Semester,
    Student,
    StudyMaterial,
    Teacher,
    User,
)
from models.AppSettings import SETTINGS_ID
from security import hash_password

ADMIN_ID = "usr-admin"
ADMIN_NAME = "Administrator"
ADMIN_EMAIL = "admin@scascollege.ac.in"
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "12345678")

# Children before parents. The FK cascades would handle most of this, but
# being explicit keeps the script correct even if a cascade is ever relaxed.
_DELETE_ORDER = [
    AuditEntry, AttendanceRecord, AttendanceSession, StudyMaterial,
    CourseAssignment, User, AppSettings, Student, Course, Semester,
    Teacher, Program, AcademicTerm, Department,
]


async def run() -> None:
    async with async_session() as db:
        for model in _DELETE_ORDER:
            await db.execute(delete(model))

        db.add(
            User(
                id=ADMIN_ID,
                name=ADMIN_NAME,
                email=ADMIN_EMAIL,
                password_hash=hash_password(ADMIN_PASSWORD),
                role=UserRoleEnum.ADMIN,
            )
        )
        # The singleton is created lazily by services/integrity.py, but seeding
        # it here means the first /settings read is a plain hit, not a write.
        # No current term: there are no terms yet for it to point at.
        db.add(AppSettings(id=SETTINGS_ID, current_term_id=None, lock_date=None))
        await db.commit()

    await engine.dispose()
    print(f"Database emptied. Admin account: {ADMIN_EMAIL}")


if __name__ == "__main__":
    assert_not_production("reset_db.py")
    asyncio.run(run())
