"""A class-rep login is retired when its class moves on.

The rep account is a User row pinned to (program_id, class_semester), and that
pair is the whole of what the rep can see. Promotion used to move the students
and leave the account behind, pointing at a semester the class had left — which
goes quiet at first and then, once the next intake enrols into that semester,
starts showing the outgoing rep the new juniors' attendance.

So the account is deleted when the class vacates the semester in whole, and the
admin creates a fresh one for the new class. That keeps the invariant simple —
a rep account always describes a class actually sitting in that semester — and
rotates the shared password every term as a side effect.
"""

from __future__ import annotations

import httpx
import pytest


async def _users(client: httpx.AsyncClient, headers: dict[str, str]) -> list[dict]:
    r = await client.get("/users?pageSize=200", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["items"]


async def _exists(client: httpx.AsyncClient, headers: dict[str, str], user_id: str) -> bool:
    return any(u["id"] == user_id for u in await _users(client, headers))


@pytest.mark.asyncio
async def test_promoting_a_whole_class_retires_its_rep_login(
    client: httpx.AsyncClient,
    admin_headers,
    dept_factory,
    program_factory,
    student_factory,
    user_factory,
):
    dept = await dept_factory()
    program = await program_factory(dept["id"], semester_count=6)
    student = await student_factory(dept["id"], program["id"], current_semester=1)
    rep = await user_factory(
        "student-rep",
        email="rep.demo.sem1@example.com",
        program_id=program["id"],
        class_semester=1,
    )

    r = await client.post(
        "/students/promote", json={"ids": [student["id"]]}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"promoted": 1, "repsRemoved": 1}
    assert not await _exists(client, admin_headers, rep["id"])


@pytest.mark.asyncio
async def test_the_retired_login_can_no_longer_sign_in(
    client: httpx.AsyncClient,
    admin_headers,
    dept_factory,
    program_factory,
    student_factory,
    user_factory,
):
    """The point of deleting rather than renumbering: the old shared password
    stops working the moment the class moves."""
    dept = await dept_factory()
    program = await program_factory(dept["id"], semester_count=6)
    student = await student_factory(dept["id"], program["id"], current_semester=1)
    await user_factory(
        "student-rep",
        password="rep-secret-1",
        email="rep.pw.sem1@example.com",
        program_id=program["id"],
        class_semester=1,
    )

    await client.post(
        "/students/promote", json={"ids": [student["id"]]}, headers=admin_headers
    )

    login = await client.post(
        "/auth/login",
        json={"email": "rep.pw.sem1@example.com", "password": "rep-secret-1"},
    )
    assert login.status_code == 401, login.text


@pytest.mark.asyncio
async def test_the_freed_class_can_take_a_new_rep_account(
    client: httpx.AsyncClient,
    admin_headers,
    dept_factory,
    program_factory,
    student_factory,
    user_factory,
):
    """One rep per class is enforced, so retiring the old account is what makes
    the follow-up create possible at all."""
    dept = await dept_factory()
    program = await program_factory(dept["id"], semester_count=6)
    student = await student_factory(dept["id"], program["id"], current_semester=1)
    await user_factory(
        "student-rep",
        email="rep.new.sem1@example.com",
        program_id=program["id"],
        class_semester=1,
    )

    await client.post(
        "/students/promote", json={"ids": [student["id"]]}, headers=admin_headers
    )

    fresh = await user_factory(
        "student-rep",
        email="rep.new.sem2@example.com",
        program_id=program["id"],
        class_semester=2,
    )
    assert fresh["classSemester"] == 2


@pytest.mark.asyncio
async def test_a_partial_promotion_leaves_the_rep_alone(
    client: httpx.AsyncClient,
    admin_headers,
    dept_factory,
    program_factory,
    student_factory,
    user_factory,
):
    """Promoting three students out of a cohort is not the class moving — only
    the active students leaving in whole retires the login."""
    dept = await dept_factory()
    program = await program_factory(dept["id"], semester_count=6)
    mover = await student_factory(dept["id"], program["id"], current_semester=1)
    await student_factory(dept["id"], program["id"], current_semester=1)  # stays
    rep = await user_factory(
        "student-rep",
        email="rep.partial.sem1@example.com",
        program_id=program["id"],
        class_semester=1,
    )

    r = await client.post(
        "/students/promote", json={"ids": [mover["id"]]}, headers=admin_headers
    )
    assert r.json() == {"promoted": 1, "repsRemoved": 0}
    assert await _exists(client, admin_headers, rep["id"])


@pytest.mark.asyncio
async def test_an_inactive_student_does_not_hold_the_class_open(
    client: httpx.AsyncClient,
    admin_headers,
    dept_factory,
    program_factory,
    student_factory,
    user_factory,
):
    """Only *active* students count towards the roster — a dropped-out student
    left behind in sem 1 must not block the retirement forever."""
    dept = await dept_factory()
    program = await program_factory(dept["id"], semester_count=6)
    active = await student_factory(dept["id"], program["id"], current_semester=1)
    await student_factory(
        dept["id"], program["id"], current_semester=1, is_active=False
    )
    rep = await user_factory(
        "student-rep",
        email="rep.inactive.sem1@example.com",
        program_id=program["id"],
        class_semester=1,
    )

    r = await client.post(
        "/students/promote", json={"ids": [active["id"]]}, headers=admin_headers
    )
    assert r.json() == {"promoted": 1, "repsRemoved": 1}
    assert not await _exists(client, admin_headers, rep["id"])


@pytest.mark.asyncio
async def test_a_whole_cohort_retires_every_rep_it_vacates(
    client: httpx.AsyncClient,
    admin_headers,
    dept_factory,
    program_factory,
    student_factory,
    user_factory,
):
    """An end-of-year roll promotes several years at once. Each vacated
    semester's login goes, including the ones immediately refilled by the class
    below — which is why the vacancy test runs before the increment, not after.
    """
    dept = await dept_factory()
    program = await program_factory(dept["id"], semester_count=6)

    students, reps = [], {}
    for sem in (1, 2, 3):
        students.append(
            await student_factory(dept["id"], program["id"], current_semester=sem)
        )
        reps[sem] = await user_factory(
            "student-rep",
            email=f"rep.cohort.sem{sem}@example.com",
            program_id=program["id"],
            class_semester=sem,
        )

    r = await client.post(
        "/students/promote",
        json={"ids": [s["id"] for s in students]},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"promoted": 3, "repsRemoved": 3}

    for sem in (1, 2, 3):
        assert not await _exists(client, admin_headers, reps[sem]["id"])


@pytest.mark.asyncio
async def test_a_class_with_no_rep_account_promotes_fine(
    client: httpx.AsyncClient,
    admin_headers,
    dept_factory,
    program_factory,
    student_factory,
):
    dept = await dept_factory()
    program = await program_factory(dept["id"], semester_count=6)
    student = await student_factory(dept["id"], program["id"], current_semester=1)

    r = await client.post(
        "/students/promote", json={"ids": [student["id"]]}, headers=admin_headers
    )
    assert r.json() == {"promoted": 1, "repsRemoved": 0}


@pytest.mark.asyncio
async def test_graduating_a_class_retires_its_rep(
    client: httpx.AsyncClient,
    admin_headers,
    dept_factory,
    program_factory,
    student_factory,
    user_factory,
):
    """Same rule at the end of the programme — the class is gone, so is its
    shared login."""
    dept = await dept_factory()
    program = await program_factory(dept["id"], semester_count=6)
    student = await student_factory(dept["id"], program["id"], current_semester=6)
    rep = await user_factory(
        "student-rep",
        email="rep.final.sem6@example.com",
        program_id=program["id"],
        class_semester=6,
    )

    r = await client.post(
        "/students/graduate", json={"ids": [student["id"]]}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"graduated": 1, "repsRemoved": 1}
    assert not await _exists(client, admin_headers, rep["id"])
