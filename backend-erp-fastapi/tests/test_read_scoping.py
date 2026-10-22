"""Read scoping is enforced by the server, not by the client's router.

`lib/permissions.ts` once kept a student-rep on two pages and presets an HOD's
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
# The student-rep: Study Materials only
# ---------------------------------------------------------------------------


def _rep_reads(two_classes) -> list[tuple[str, dict]]:
    """Every attendance and student read, against the rep's own class *and*
    another — the rep gets neither."""
    term_id = two_classes["term"]["id"]
    reads: list[tuple[str, dict]] = [
        ("/attendance", {}),
        ("/attendance/summary", {}),
        ("/students", {}),
    ]
    for key in ("mine", "theirs"):
        course_id = two_classes[key]["course"]["id"]
        student_id = two_classes[key]["student"]["id"]
        reads += [
            ("/attendance/register", {"courseId": course_id, "termId": term_id}),
            ("/attendance/roster", {"courseId": course_id}),
            ("/attendance/class-roster", {"courseId": course_id}),
            ("/attendance/months", {"courseId": course_id}),
            ("/attendance/summary", {"courseIds": [course_id]}),
            ("/attendance/summary/breakdown", {"studentId": student_id}),
            ("/students/lookup", {"ids": [student_id]}),
            (f"/students/{student_id}", {}),
        ]
    return reads


async def test_a_rep_cannot_read_any_attendance_or_students(
    client, rep_headers, two_classes
):
    """The login is shared by a whole class: not even its own register."""
    for path, params in _rep_reads(two_classes):
        r = await client.get(path, params=params, headers=rep_headers)
        assert r.status_code == 403, f"{path} {params}: {r.status_code} {r.text}"


async def test_a_rep_still_reads_its_own_classs_materials(
    client, admin_headers, rep_headers, two_classes
):
    for key in ("mine", "theirs"):
        r = await client.post(
            "/materials",
            json={
                "courseId": two_classes[key]["course"]["id"],
                "termId": two_classes["term"]["id"],
                "title": f"Notes {key}",
                "url": "https://example.com/notes.pdf",
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text

    r = await client.get("/materials", headers=rep_headers)
    assert r.status_code == 200, r.text
    assert [m["title"] for m in r.json()["items"]] == ["Notes mine"]


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


# ---------------------------------------------------------------------------
# Personal fields (address, DOB, guardian phone) are blanked for readers
# without `view_student_pii` — a roster is roll + name + status, not a
# classmate's home address. The narrow role is *in scope* here (its own class),
# so this is a second gate behind read scoping, not the same one.
# ---------------------------------------------------------------------------

_PII_KEYS = ("email", "phone", "address", "dateOfBirth", "guardianName", "guardianPhone")


def _assert_redacted(student: dict) -> None:
    # Identity + placement survive; personal fields are nulled.
    assert student["rollNumber"]
    assert student["name"]
    for key in _PII_KEYS:
        assert student[key] is None, f"{key} leaked: {student[key]!r}"


def _assert_full(student: dict) -> None:
    assert student["address"] == "123 Test Street"
    assert student["guardianPhone"] == "7000000000"
    assert student["dateOfBirth"] == "2002-01-01"


async def test_a_teacher_sees_its_roster_without_pii(
    client, teacher_headers, two_classes
):
    r = await client.get(
        "/attendance/roster",
        params={"courseId": two_classes["mine"]["course"]["id"]},
        headers=teacher_headers,
    )
    assert r.status_code == 200, r.text
    rows = r.json()
    assert rows
    for student in rows:
        _assert_redacted(student)


async def test_an_hod_sees_full_pii_for_its_department(
    client, hod_headers, two_classes
):
    r = await client.get("/students", headers=hod_headers)
    assert r.status_code == 200, r.text
    rows = r.json()["items"]
    assert rows
    _assert_full(rows[0])


async def test_an_admin_sees_full_pii_on_student_detail(
    client, admin_headers, two_classes
):
    r = await client.get(
        f"/students/{two_classes['theirs']['student']['id']}", headers=admin_headers
    )
    assert r.status_code == 200, r.text
    _assert_full(r.json())


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
