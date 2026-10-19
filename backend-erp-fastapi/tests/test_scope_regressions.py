"""Scope holes and 500s found by the code-quality audit, pinned from the caller's side.

* An HOD's *read* scope (own courses ∪ department) was unioned in place into
  the cached set of their *own* courses, so after any read an HOD could mark
  attendance for every course in the department — `mark_scope="own"` broken by
  a cache, with no test reading-then-writing to notice.
* `/stats/*` narrowed only HODs; a teacher or a class-rep login got the
  college-wide counters.
* `/attendance/summary/breakdown` checked the *student* was visible and then
  returned every course the student sits, including ones the caller doesn't
  teach.
* A handful of malformed attendance writes reached a database constraint and
  came back as 500s.
"""

from __future__ import annotations

import pytest_asyncio

PW = "regress-pass-1"
DAY = "2024-03-01"


@pytest_asyncio.fixture
async def dept_with_two_courses(
    client,
    admin_headers,
    dept_factory,
    program_factory,
    semesters_of,
    course_factory,
    student_factory,
    teacher_factory,
    term_factory,
    assignment_factory,
    user_factory,
    login_as,
):
    """One department, one class, two courses. The HOD and the teacher are each
    assigned `taught` only; `other` is in the department but not theirs."""
    term = await term_factory()
    r = await client.put(
        "/terms/current", json={"termId": term["id"]}, headers=admin_headers
    )
    assert r.status_code == 200, r.text

    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)
    semester = (await semesters_of(program["id"]))[0]
    taught = await course_factory(semester_id=semester["id"])
    other = await course_factory(semester_id=semester["id"])
    student = await student_factory(department_id=dept["id"], program_id=program["id"])

    hod_teacher = await teacher_factory(department_id=dept["id"], is_hod=True)
    plain_teacher = await teacher_factory(department_id=dept["id"])
    for t in (hod_teacher, plain_teacher):
        await assignment_factory(taught["id"], t["id"], term["id"])

    await user_factory("hod", password=PW, email="r.hod@example.com", teacher_id=hod_teacher["id"])
    await user_factory(
        "teacher", password=PW, email="r.teacher@example.com", teacher_id=plain_teacher["id"]
    )
    await user_factory(
        "student-rep",
        password=PW,
        email="r.rep@example.com",
        program_id=program["id"],
        class_semester=1,
    )

    # Marks in both courses, so a breakdown leak returns a real row.
    for course in (taught, other):
        r = await client.post(
            "/attendance",
            json={
                "courseId": course["id"],
                "date": DAY,
                "period": 1,
                "termId": term["id"],
                "records": [{"studentId": student["id"], "status": "present"}],
            },
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text

    return {
        "term": term,
        "dept": dept,
        "program": program,
        "taught": taught,
        "other": other,
        "student": student,
        "hod": await login_as(client, "r.hod@example.com", PW),
        "teacher": await login_as(client, "r.teacher@example.com", PW),
        "rep": await login_as(client, "r.rep@example.com", PW),
    }


def _mark(course_id: str, term_id: str, student_id: str, date: str = "2024-03-02"):
    return {
        "courseId": course_id,
        "date": date,
        "period": 2,
        "termId": term_id,
        "records": [{"studentId": student_id, "status": "present"}],
    }


# ---------------------------------------------------------------------------
# Write scope can't be widened by a read
# ---------------------------------------------------------------------------


async def test_hod_cannot_mark_a_department_course_they_dont_teach_after_reading(
    client, dept_with_two_courses
):
    d = dept_with_two_courses
    # The read that used to poison the cached own-course set.
    r = await client.get(
        "/attendance/summary", params={"termId": d["term"]["id"]}, headers=d["hod"]
    )
    assert r.status_code == 200, r.text

    r = await client.post(
        "/attendance",
        json=_mark(d["other"]["id"], d["term"]["id"], d["student"]["id"]),
        headers=d["hod"],
    )
    assert r.status_code == 403, r.text


async def test_hod_can_still_mark_their_own_course(client, dept_with_two_courses):
    d = dept_with_two_courses
    r = await client.post(
        "/attendance",
        json=_mark(d["taught"]["id"], d["term"]["id"], d["student"]["id"]),
        headers=d["hod"],
    )
    assert r.status_code == 200, r.text


async def test_hod_cannot_share_materials_to_a_course_they_dont_teach_after_reading(
    client, dept_with_two_courses
):
    d = dept_with_two_courses
    await client.get("/materials", headers=d["hod"])
    r = await client.post(
        "/materials",
        json={
            "courseId": d["other"]["id"],
            "termId": d["term"]["id"],
            "title": "Notes",
            "url": "https://example.com/notes",
        },
        headers=d["hod"],
    )
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# /stats/* is scoped by view_scope
# ---------------------------------------------------------------------------


async def test_narrow_roles_get_no_college_wide_stats(client, dept_with_two_courses):
    d = dept_with_two_courses
    for role in ("teacher", "rep"):
        for path in ("/stats/dashboard", "/stats/shortfall-count"):
            r = await client.get(path, headers=d[role])
            assert r.status_code == 403, (role, path, r.text)


async def test_unstaffed_courses_needs_manage_academics(client, dept_with_two_courses):
    d = dept_with_two_courses
    r = await client.get("/stats/unstaffed-courses", headers=d["hod"])
    assert r.status_code == 403, r.text


async def test_hod_dashboard_counts_only_their_department(
    client,
    admin_headers,
    dept_with_two_courses,
    dept_factory,
    program_factory,
    semesters_of,
    course_factory,
    student_factory,
):
    d = dept_with_two_courses
    # A second department with its own student and a correction this week.
    other_dept = await dept_factory()
    program = await program_factory(department_id=other_dept["id"], semester_count=1)
    course = await course_factory(semester_id=(await semesters_of(program["id"]))[0]["id"])
    outsider = await student_factory(department_id=other_dept["id"], program_id=program["id"])
    body = _mark(course["id"], d["term"]["id"], outsider["id"], date=DAY)
    assert (await client.post("/attendance", json=body, headers=admin_headers)).status_code == 200
    body["records"][0]["status"] = "absent"
    assert (await client.post("/attendance", json=body, headers=admin_headers)).status_code == 200

    hod = (await client.get("/stats/dashboard", headers=d["hod"])).json()
    admin = (await client.get("/stats/dashboard", headers=admin_headers)).json()
    assert hod["students"] == 1
    assert admin["students"] == 2
    # The correction happened in the other department.
    assert admin["correctionsThisWeek"] == 1
    assert hod["correctionsThisWeek"] == 0


# ---------------------------------------------------------------------------
# Breakdown is bounded by course scope, not just student visibility
# ---------------------------------------------------------------------------


async def test_teacher_breakdown_shows_only_courses_they_teach(
    client, admin_headers, dept_with_two_courses
):
    d = dept_with_two_courses
    params = {"studentId": d["student"]["id"], "termId": d["term"]["id"]}

    r = await client.get("/attendance/summary/breakdown", params=params, headers=d["teacher"])
    assert r.status_code == 200, r.text
    assert {row["courseId"] for row in r.json()} == {d["taught"]["id"]}

    r = await client.get("/attendance/summary/breakdown", params=params, headers=admin_headers)
    assert {row["courseId"] for row in r.json()} == {d["taught"]["id"], d["other"]["id"]}


# ---------------------------------------------------------------------------
# Malformed writes are 4xx, not 500
# ---------------------------------------------------------------------------


async def test_duplicate_student_in_one_payload_is_422(
    client, admin_headers, dept_with_two_courses
):
    d = dept_with_two_courses
    body = _mark(d["taught"]["id"], d["term"]["id"], d["student"]["id"])
    body["records"].append({"studentId": d["student"]["id"], "status": "absent"})
    r = await client.post("/attendance", json=body, headers=admin_headers)
    assert r.status_code == 422, r.text


async def test_unknown_student_is_422(client, admin_headers, dept_with_two_courses):
    d = dept_with_two_courses
    body = _mark(d["taught"]["id"], d["term"]["id"], "stu-does-not-exist")
    r = await client.post("/attendance", json=body, headers=admin_headers)
    assert r.status_code == 422, r.text


async def test_impossible_and_future_dates_are_422(
    client, admin_headers, dept_with_two_courses
):
    d = dept_with_two_courses
    for date in ("2024-02-31", "2999-01-01"):
        body = _mark(d["taught"]["id"], d["term"]["id"], d["student"]["id"], date=date)
        r = await client.post("/attendance", json=body, headers=admin_headers)
        assert r.status_code == 422, (date, r.text)


async def test_month_filter_returns_that_month_only(
    client, admin_headers, dept_with_two_courses
):
    d = dept_with_two_courses
    body = _mark(d["taught"]["id"], d["term"]["id"], d["student"]["id"], date="2024-04-01")
    assert (await client.post("/attendance", json=body, headers=admin_headers)).status_code == 200

    r = await client.get(
        "/attendance/register",
        params={"courseId": d["taught"]["id"], "termId": d["term"]["id"], "month": "2024-03"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert [s["date"] for s in r.json()] == [DAY]
