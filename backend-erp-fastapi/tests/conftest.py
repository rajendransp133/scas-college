"""Shared pytest fixtures for the backend test suite.

Isolation strategy
-------------------
Test DB is a real **Postgres** container (`testcontainers.postgres`), not
SQLite — the schema leans on Postgres-only features (`pg_trgm` GIN indexes,
FK `ON DELETE CASCADE`/`SET NULL` semantics, integer-safe percentage compares
in `services/analytics.py`) that SQLite can't reproduce faithfully.

Between tests we **truncate every app table** (`TRUNCATE ... RESTART IDENTITY
CASCADE`) rather than wrapping each test in a rolled-back transaction. The
services call `db.commit()` directly (see `services/attendance.py`,
`services/users.py`, etc.) and the app's own `get_db()` hands out one
independent `AsyncSession` per request; making that survive inside a single
outer transaction would need SAVEPOINT-per-session plumbing that fights the
app's own session lifecycle for very little payoff at this data volume.
Truncate-between-tests is simpler to reason about and cheap enough for a
handful of rows per test.

The in-process cache (`services/cache.py`) and the login rate limiter
(`rate_limit.py`) are both **module-level singletons that outlive any single
test** — they must be reset every test too, or one test's cached `/settings`
read (or spent login quota) leaks into the next.
"""

from __future__ import annotations

import itertools
import sys
import uuid
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from testcontainers.postgres import PostgresContainer

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from database.connection import get_db  # noqa: E402
from enums.UserRole import UserRoleEnum  # noqa: E402
from ids import new_id  # noqa: E402
from main import app  # noqa: E402
from models import Base, User  # noqa: E402
from rate_limit import limiter  # noqa: E402
from security import hash_password  # noqa: E402
from services.cache import invalidate_all  # noqa: E402

# ---------------------------------------------------------------------------
# Container + schema (session-scoped: one Postgres for the whole test run)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def postgres_container():
    with PostgresContainer("postgres:16") as container:
        yield container


@pytest.fixture(scope="session")
def database_urls(postgres_container: PostgresContainer) -> dict[str, str]:
    sync_url = postgres_container.get_connection_url(driver="psycopg2")
    async_url = postgres_container.get_connection_url(driver="asyncpg")

    # alembic/env.py unconditionally does
    # `config.set_main_option("sqlalchemy.url", config.settings.sync_database_url)`
    # — it always re-derives the URL from the app's own settings, ignoring
    # whatever the *Alembic* Config object was given. So setting
    # `alembic_cfg.set_main_option("sqlalchemy.url", ...)` alone is not
    # enough; the app-level singleton has to point at the container too
    # before `command.upgrade` runs env.py. `config.settings` is already
    # imported (and cached) by the time this fixture runs — the app modules
    # this file imports at collection time (`main`, `database.connection`)
    # pull it in — so mutating the one shared instance here is what actually
    # reaches env.py, not a second independent Settings().
    from config import settings as app_settings

    app_settings.database_url = async_url

    alembic_cfg = Config(str(BASE_DIR / "alembic.ini"))
    alembic_cfg.set_main_option("sqlalchemy.url", sync_url)
    command.upgrade(alembic_cfg, "head")

    return {"sync": sync_url, "async": async_url}


@pytest_asyncio.fixture(scope="session")
async def async_engine(database_urls: dict[str, str]):
    engine = create_async_engine(database_urls["async"], poolclass=NullPool)
    yield engine
    await engine.dispose()


@pytest.fixture(scope="session")
def session_factory(async_engine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(async_engine, expire_on_commit=False, class_=AsyncSession)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _wire_db_override(session_factory: async_sessionmaker[AsyncSession]):
    """Point the app's `get_db` dependency at the container, FastAPI-style
    (`dependency_overrides`) instead of mutating global settings."""

    async def _override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)


# ---------------------------------------------------------------------------
# Per-test isolation: truncate tables, clear the process cache, reset the
# login rate limiter's in-memory storage.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(autouse=True)
async def _isolate(async_engine):
    table_names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    async with async_engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE TABLE {table_names} RESTART IDENTITY CASCADE"))
    # services/cache.py's SETTINGS/TERMS/COURSES/DIRECTORY keys are fixed
    # strings shared by every test — without this a value cached by one test
    # (e.g. a lock date) leaks into the next, which reads a truncated DB but
    # a stale cache.
    invalidate_all()
    # slowapi's in-memory storage is a module-level singleton too: without a
    # reset, tests earlier in the session eat into every later test's
    # 10/minute `/auth/login` budget.
    limiter.reset()
    yield


@pytest_asyncio.fixture
async def client(_isolate):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Auth bootstrap. No seed script in the loop for tests: every test here
# needs at most a handful of rows, freshly made, so hand-built minimal
# fixtures are both faster and make each test's setup legible on its own.
# The one row that *can't* come from the API (nothing exists yet to grant
# `manage_users`) is bootstrapped with a direct insert; everything else goes
# through real endpoints so tests exercise the actual router/service/auth
# stack, not a shortcut around it.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def admin_creds(session_factory: async_sessionmaker[AsyncSession]) -> dict[str, str]:
    email = "admin@example.com"
    password = "admin123"
    async with session_factory() as session:
        session.add(
            User(
                id=new_id("usr"),
                name="Test Admin",
                email=email,
                password_hash=hash_password(password),
                role=UserRoleEnum.ADMIN,
            )
        )
        await session.commit()
    return {"email": email, "password": password}


async def _login(client: httpx.AsyncClient, email: str, password: str) -> str:
    r = await client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["accessToken"]


@pytest_asyncio.fixture
async def admin_headers(client: httpx.AsyncClient, admin_creds: dict[str, str]) -> dict[str, str]:
    token = await _login(client, admin_creds["email"], admin_creds["password"])
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def login_as():
    """Factory: `await login_as(client, email, password)` -> auth headers."""

    async def _do(client: httpx.AsyncClient, email: str, password: str) -> dict[str, str]:
        token = await _login(client, email, password)
        return {"Authorization": f"Bearer {token}"}

    return _do


# ---------------------------------------------------------------------------
# Domain factories, all going through the real HTTP API as an admin (who has
# every capability) so arranging a scenario also exercises the create paths.
# ---------------------------------------------------------------------------

_unique = itertools.count(1)
# Terms need a *bounded* sequence, not a monotonic one — see term_factory.
_term_years = itertools.count(1)


@pytest_asyncio.fixture
async def dept_factory(client: httpx.AsyncClient, admin_headers: dict[str, str]):
    async def _make(name: str | None = None, code: str | None = None) -> dict:
        n = next(_unique)
        payload = {"name": name or f"Department {n}", "code": code or f"D{n}"}
        r = await client.post("/departments", json=payload, headers=admin_headers)
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest_asyncio.fixture
async def program_factory(client: httpx.AsyncClient, admin_headers: dict[str, str]):
    async def _make(
        department_id: str,
        semester_count: int = 2,
        name: str | None = None,
        code: str | None = None,
        level: str = "UG",
    ) -> dict:
        n = next(_unique)
        payload = {
            "name": name or f"Program {n}",
            "code": code or f"P{n}",
            "level": level,
            "departmentId": department_id,
            "semesterCount": semester_count,
        }
        r = await client.post("/programs", json=payload, headers=admin_headers)
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest_asyncio.fixture
async def semesters_of(client: httpx.AsyncClient, admin_headers: dict[str, str]):
    async def _get(program_id: str) -> list[dict]:
        r = await client.get(
            "/semesters", params={"programId": program_id}, headers=admin_headers
        )
        assert r.status_code == 200, r.text
        return r.json()

    return _get


@pytest_asyncio.fixture
async def course_factory(client: httpx.AsyncClient, admin_headers: dict[str, str]):
    async def _make(
        semester_id: str,
        name: str | None = None,
        code: str | None = None,
        credits: int = 4,
    ) -> dict:
        n = next(_unique)
        payload = {
            "name": name or f"Course {n}",
            "code": code or f"C{n}",
            "credits": credits,
        }
        r = await client.post(
            f"/semesters/{semester_id}/courses", json=payload, headers=admin_headers
        )
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest_asyncio.fixture
async def teacher_factory(client: httpx.AsyncClient, admin_headers: dict[str, str]):
    async def _make(
        department_id: str,
        is_hod: bool = False,
        designation: str = "Assistant Professor",
        employee_id: str | None = None,
        name: str | None = None,
        email: str | None = None,
    ) -> dict:
        n = next(_unique)
        payload = {
            "employeeId": employee_id or f"EMP{n}",
            "name": name or f"Teacher {n}",
            "email": email or f"teacher{n}@example.com",
            "phone": "9000000000",
            "departmentId": department_id,
            "designation": designation,
            "qualification": "PhD",
            "joiningDate": "2020-01-01",
            "isHod": is_hod,
        }
        r = await client.post("/teachers", json=payload, headers=admin_headers)
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest_asyncio.fixture
async def student_factory(client: httpx.AsyncClient, admin_headers: dict[str, str]):
    async def _make(
        department_id: str,
        program_id: str,
        current_semester: int = 1,
        roll_number: str | None = None,
        name: str | None = None,
        email: str | None = None,
        is_active: bool = True,
        graduated: bool = False,
    ) -> dict:
        n = next(_unique)
        payload = {
            "rollNumber": roll_number or f"R{n}",
            "name": name or f"Student {n}",
            "email": email or f"student{n}@example.com",
            "phone": "8000000000",
            "address": "123 Test Street",
            "dateOfBirth": "2002-01-01",
            "gender": "male",
            "departmentId": department_id,
            "programId": program_id,
            "currentSemester": current_semester,
            "admissionYear": 2021,
            "guardianName": "Parent Name",
            "guardianRelation": "Father",
            "guardianPhone": "7000000000",
            "isActive": is_active,
            "graduated": graduated,
        }
        r = await client.post("/students", json=payload, headers=admin_headers)
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest_asyncio.fixture
async def term_factory(client: httpx.AsyncClient, admin_headers: dict[str, str]):
    async def _make(parity: str = "odd") -> dict:
        # Its own counter, wrapped into the schema's 1900-2100 window. Sharing
        # the global `_unique` meant the year grew with the size of the whole
        # suite — every test added anywhere eventually pushed startYear past
        # 2100 and failed validation here, far from the cause. Wrapping is safe
        # because `_isolate` truncates between tests, so years only have to be
        # distinct within a single test.
        year = 2000 + next(_term_years) % 100
        r = await client.post(
            "/terms",
            json={"startYear": year, "parity": parity},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest_asyncio.fixture
async def assignment_factory(client: httpx.AsyncClient, admin_headers: dict[str, str]):
    async def _make(course_id: str, teacher_id: str, term_id: str) -> dict:
        r = await client.post(
            "/assignments",
            json={"courseId": course_id, "teacherId": teacher_id, "termId": term_id},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest_asyncio.fixture
async def user_factory(client: httpx.AsyncClient, admin_headers: dict[str, str]):
    async def _make(
        role: str,
        password: str = "pass1234",
        email: str | None = None,
        name: str | None = None,
        teacher_id: str | None = None,
        program_id: str | None = None,
        class_semester: int | None = None,
    ) -> dict:
        n = next(_unique)
        payload = {
            "name": name or f"User {n}",
            "email": email or f"user{n}@example.com",
            "role": role,
            "password": password,
        }
        if teacher_id is not None:
            payload["teacherId"] = teacher_id
        if program_id is not None:
            payload["programId"] = program_id
        if class_semester is not None:
            payload["classSemester"] = class_semester
        r = await client.post("/users", json=payload, headers=admin_headers)
        assert r.status_code == 201, r.text
        data = r.json()
        data["_password"] = password
        return data

    return _make
