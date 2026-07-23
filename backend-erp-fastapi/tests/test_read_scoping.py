"""Read scoping is enforced by the server, not by the client's router.

`lib/permissions.ts` keeps a student-rep on two pages and presets an HOD's
department filter, and for a long time that was the *only* thing doing it: every
attendance and student read accepted whatever `courseId` the caller sent. A
class-rep login — one shared password per class — could ask for any other
class's register, any roster (addresses, dates of birth, guardian phone numbers)
and the college-wide summary.

The tests below are written from the attacker's side: log in as the narrow role,
then request something outside its class and assert the server refuses. A test
that only checks the happy path would have passed throughout the whole period
the hole was open.
"""

from __future__ import annotations

import pytest_asyncio

PW = "scope-pass-1"


@pytest_asyncio.fixture
async def two_classes(
    client,
    admin_headers,
    dept_factory,
    program_factory,
    semesters_of,
    course_factory,
    student_factory,
    term_factory,
):
    """Two departments, each with one program, course and student.

    `mine` is what the narrow roles below are entitled to; `theirs` is the one
    they must not reach.
    """
    term = await term_factory()
    r = await client.put(
        "/terms/current", json={"termId": term["id"]}, headers=admin_headers
    )
    assert r.status_code == 200, r.text

    built = {}
    for key in ("mine", "theirs"):
        dept = await dept_factory()
        program = await program_factory(department_id=dept["id"], semester_count=1)
        semesters = await semesters_of(program["id"])
        course = await course_factory(semester_id=semesters[0]["id"])
        student = await student_factory(
            department_id=dept["id"], program_id=program["id"]
        )
        built[key] = {
            "dept": dept,
            "program": program,
            "course": course,
            "student": student,
        }

    # Saved attendance in both, so a leak would return real rows rather than [].
    for key in ("mine", "theirs"):
        await client.post(
            "/attendance",
            json={
                "courseId": built[key]["course"]["id"],
                "date": "2024-03-01",
                "period": 1,
                "termId": term["id"],
                "records": [
                    {"studentId": built[key]["student"]["id"], "status": "absent"}
                ],
            },
            headers=admin_headers,
        )

    built["term"] = term
    return built


@pytest_asyncio.fixture
async def rep_headers(client, user_factory, login_as, two_classes):
    email = "scope.rep@example.com"
    await user_factory(
        "student-rep",
        password=PW,
        email=email,
        program_id=two_classes["mine"]["program"]["id"],
        class_semester=1,
    )
    return await login_as(client, email, PW)


@pytest_asyncio.fixture
async def teacher_headers(
    client, user_factory, teacher_factory, assignment_factory, login_as, two_classes
):
    teacher = await teacher_factory(department_id=two_classes["mine"]["dept"]["id"])
    await assignment_factory(
        two_classes["mine"]["course"]["id"], teacher["id"], two_classes["term"]["id"]
    )
    email = "scope.teacher@example.com"
    await user_factory("teacher", password=PW, email=email, teacher_id=teacher["id"])
    return await login_as(client, email, PW)


@pytest_asyncio.fixture
async def hod_headers(client, user_factory, teacher_factory, login_as, two_classes):
    teacher = await teacher_factory(
        department_id=two_classes["mine"]["dept"]["id"], is_hod=True
    )
    email = "scope.hod@example.com"
    await user_factory("hod", password=PW, email=email, teacher_id=teacher["id"])
    return await login_as(client, email, PW)


# ---------------------------------------------------------------------------
# The student-rep: pinned to one (program, semester)
# ---------------------------------------------------------------------------


async def test_a_rep_can_read_its_own_class_register(
    client, rep_headers, two_classes
):
    """The scope has to actually let the rep do their job — otherwise a test
    suite passes by locking everyone out of everything."""
    r = await client.get(
        "/attendance/register",
        params={
            "courseId": two_classes["mine"]["course"]["id"],
            "termId": two_classes["term"]["id"],
        },
        headers=rep_headers,
    )
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1


async def test_a_rep_cannot_read_another_classs_register(
    client, rep_headers, two_classes
):
    r = await client.get(
        "/attendance/register",
        params={
            "courseId": two_classes["theirs"]["course"]["id"],
            "termId": two_classes["term"]["id"],
        },
        headers=rep_headers,
    )
    assert r.status_code == 403, r.text


async def test_a_rep_cannot_read_another_classs_roster(
    client, rep_headers, two_classes
):
    """The roster carries address, date of birth and guardian phone."""
    for path in ("/attendance/roster", "/attendance/class-roster"):
        r = await client.get(
            path,
            params={"courseId": two_classes["theirs"]["course"]["id"]},
            headers=rep_headers,
        )
        assert r.status_code == 403, f"{path}: {r.text}"


async def test_a_rep_cannot_read_another_classs_session_months(
    client, rep_headers, two_classes
):
    r = await client.get(
        "/attendance/months",
        params={"courseId": two_classes["theirs"]["course"]["id"]},
        headers=rep_headers,
    )
    assert r.status_code == 403, r.text


async def test_an_unfiltered_summary_shows_a_rep_only_its_own_class(
    client, rep_headers, two_classes
):
    """No `courseId` at all used to mean "the whole college"."""
    r = await client.get("/attendance/summary", headers=rep_headers)
    assert r.status_code == 200, r.text
    ids = {row["studentId"] for row in r.json()["items"]}
    assert ids == {two_classes["mine"]["student"]["id"]}


async def test_a_rep_cannot_widen_the_summary_by_naming_a_course(
    client, rep_headers, two_classes
):
    """The request filter is bounded by the scope, never the other way round."""
    r = await client.get(
        "/attendance/summary",
        params={"courseIds": [two_classes["theirs"]["course"]["id"]]},
        headers=rep_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["items"] == []


async def test_an_unfiltered_session_list_shows_a_rep_only_its_own_class(
    client, rep_headers, two_classes
):
    r = await client.get("/attendance", headers=rep_headers)
    assert r.status_code == 200, r.text
    course_ids = {s["courseId"] for s in r.json()["items"]}
    assert course_ids <= {two_classes["mine"]["course"]["id"]}


async def test_a_rep_cannot_list_the_whole_student_directory(
    client, rep_headers, two_classes
):
    r = await client.get("/students", headers=rep_headers)
    assert r.status_code == 200, r.text
    ids = {s["id"] for s in r.json()["items"]}
    assert ids == {two_classes["mine"]["student"]["id"]}


async def test_a_rep_cannot_fetch_another_classs_student_by_id(
    client, rep_headers, two_classes
):
    r = await client.get(
        f"/students/{two_classes['theirs']['student']['id']}", headers=rep_headers
    )
    assert r.status_code == 403, r.text


async def test_a_rep_lookup_drops_ids_outside_its_class(
    client, rep_headers, two_classes
):
    """Lookup filters rather than 403s — a page can legitimately hold a mixed
    set of ids, and one stray must not fail the whole request."""
    r = await client.get(
        "/students/lookup",
        params={
            "ids": [
                two_classes["mine"]["student"]["id"],
                two_classes["theirs"]["student"]["id"],
            ]
        },
        headers=rep_headers,
    )
    assert r.status_code == 200, r.text
    assert [s["id"] for s in r.json()] == [two_classes["mine"]["student"]["id"]]


async def test_a_rep_cannot_read_another_students_breakdown(
    client, rep_headers, two_classes
):
    r = await client.get(
        "/attendance/summary/breakdown",
        params={"studentId": two_classes["theirs"]["student"]["id"]},
        headers=rep_headers,
    )
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# The teacher: only the courses they are assigned this term
# ---------------------------------------------------------------------------


async def test_a_teacher_reads_their_assigned_course(
    client, teacher_headers, two_classes
):
    r = await client.get(
        "/attendance/register",
        params={
            "courseId": two_classes["mine"]["course"]["id"],
            "termId": two_classes["term"]["id"],
        },
        headers=teacher_headers,
    )
    assert r.status_code == 200, r.text


async def test_a_teacher_cannot_read_a_course_they_do_not_teach(
    client, teacher_headers, two_classes
):
    r = await client.get(
        "/attendance/register",
        params={
            "courseId": two_classes["theirs"]["course"]["id"],
            "termId": two_classes["term"]["id"],
        },
        headers=teacher_headers,
    )
    assert r.status_code == 403, r.text


async def test_a_teachers_summary_covers_only_their_own_classes(
    client, teacher_headers, two_classes
):
    r = await client.get("/attendance/summary", headers=teacher_headers)
    assert r.status_code == 200, r.text
    ids = {row["studentId"] for row in r.json()["items"]}
    assert ids == {two_classes["mine"]["student"]["id"]}


# ---------------------------------------------------------------------------
# The HOD: their own department (plus anything they personally teach)
# ---------------------------------------------------------------------------


async def test_an_hod_reads_their_own_departments_course(
    client, hod_headers, two_classes
):
    """Department reach does not depend on holding an assignment — an HOD who
    teaches nothing this term still oversees the department."""
    r = await client.get(
        "/attendance/register",
        params={
            "courseId": two_classes["mine"]["course"]["id"],
            "termId": two_classes["term"]["id"],
        },
        headers=hod_headers,
    )
    assert r.status_code == 200, r.text


async def test_an_hod_cannot_read_another_department(
    client, hod_headers, two_classes
):
    r = await client.get(
        "/attendance/register",
        params={
            "courseId": two_classes["theirs"]["course"]["id"],
            "termId": two_classes["term"]["id"],
        },
        headers=hod_headers,
    )
    assert r.status_code == 403, r.text


async def test_an_hod_student_list_is_department_scoped(
    client, hod_headers, two_classes
):
    r = await client.get("/students", headers=hod_headers)
    assert r.status_code == 200, r.text
    ids = {s["id"] for s in r.json()["items"]}
    assert ids == {two_classes["mine"]["student"]["id"]}


async def test_an_hod_cannot_widen_by_naming_another_department(
    client, hod_headers, two_classes
):
    r = await client.get(
        "/students",
        params={"departmentId": two_classes["theirs"]["dept"]["id"]},
        headers=hod_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["items"] == []


# ---------------------------------------------------------------------------
# The wide roles keep their reach
# ---------------------------------------------------------------------------


async def test_an_admin_still_sees_everything(client, admin_headers, two_classes):
    r = await client.get("/students", headers=admin_headers)
    assert r.status_code == 200, r.text
    ids = {s["id"] for s in r.json()["items"]}
    assert {
        two_classes["mine"]["student"]["id"],
        two_classes["theirs"]["student"]["id"],
    } <= ids


async def test_an_attendance_manager_still_sees_every_class(
    client, user_factory, login_as, two_classes
):
    """Correcting attendance college-wide requires reading it college-wide —
    a scope keyed on assignments would have quietly broken this role."""
    email = "scope.attmgr@example.com"
    await user_factory("attendance-manager", password=PW, email=email)
    headers = await login_as(client, email, PW)
    for key in ("mine", "theirs"):
        r = await client.get(
            "/attendance/register",
            params={
                "courseId": two_classes[key]["course"]["id"],
                "termId": two_classes["term"]["id"],
            },
            headers=headers,
        )
        assert r.status_code == 200, f"{key}: {r.text}"
