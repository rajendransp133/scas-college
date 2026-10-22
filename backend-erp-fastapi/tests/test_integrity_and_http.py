"""Database-level integrity, validation at the boundary, and HTTP plumbing.

Each test pins something that used to fail *quietly* — a race the service-level
check lost, a malformed write that came back as a 500, a cascade that erased
attendance with nothing in the log, a header the error handler dropped.
"""

from __future__ import annotations

import asyncio

from main import app

PW = "integrity-pass-1"


# ---------------------------------------------------------------------------
# One rep per class holds under concurrency
# ---------------------------------------------------------------------------


async def test_concurrent_rep_creates_for_one_class_yield_exactly_one(
    client, admin_headers, dept_factory, program_factory
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)

    def payload(n: int) -> dict:
        return {
            "name": f"Rep {n}",
            "email": f"race.rep{n}@example.com",
            "role": "student-rep",
            "password": PW,
            "programId": program["id"],
            "classSemester": 1,
        }

    results = await asyncio.gather(
        *(client.post("/users", json=payload(n), headers=admin_headers) for n in range(4))
    )
    codes = sorted(r.status_code for r in results)
    assert codes == [201, 409, 409, 409], [r.text for r in results]


async def test_a_rep_without_a_class_is_rejected(client, admin_headers):
    r = await client.post(
        "/users",
        json={"name": "Rep", "email": "noclass@example.com", "role": "student-rep", "password": PW},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text


async def test_a_role_change_drops_the_old_roles_class_pin(
    client, admin_headers, dept_factory, program_factory, user_factory
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)
    rep = await user_factory("student-rep", program_id=program["id"], class_semester=1)
    r = await client.put(
        f"/users/{rep['id']}", json={"role": "attendance-manager"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["programId"] is None and r.json()["classSemester"] is None


async def test_short_admin_set_password_is_rejected(client, admin_headers, user_factory):
    user = await user_factory("attendance-manager")
    r = await client.put(f"/users/{user['id']}", json={"password": "abc"}, headers=admin_headers)
    assert r.status_code == 422, r.text


# ---------------------------------------------------------------------------
# Malformed writes are 4xx, never 500
# ---------------------------------------------------------------------------


async def test_explicit_null_for_a_required_field_is_422(
    client, admin_headers, dept_factory, program_factory, student_factory, user_factory
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"])
    student = await student_factory(department_id=dept["id"], program_id=program["id"])
    user = await user_factory("attendance-manager")

    for path, body in (
        (f"/students/{student['id']}", {"name": None}),
        (f"/students/{student['id']}", {"programId": None}),
        (f"/users/{user['id']}", {"isActive": None}),
        (f"/users/{user['id']}", {"email": None}),
    ):
        r = await client.put(path, json=body, headers=admin_headers)
        assert r.status_code == 422, (path, body, r.text)


async def test_a_bad_reference_is_422_not_a_misleading_duplicate(
    client, admin_headers, dept_factory, program_factory
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"])
    r = await client.post(
        "/students",
        json={
            "rollNumber": "BADREF1",
            "name": "Nobody",
            "departmentId": "dept-missing",
            "programId": program["id"],
            "currentSemester": 1,
        },
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text
    assert "roll number" not in r.json()["detail"].lower()


async def test_student_program_must_belong_to_their_department(
    client, admin_headers, dept_factory, program_factory
):
    dept_a, dept_b = await dept_factory(), await dept_factory()
    program_b = await program_factory(department_id=dept_b["id"])
    r = await client.post(
        "/students",
        json={
            "rollNumber": "MISMATCH1",
            "name": "Mismatch",
            "departmentId": dept_a["id"],
            "programId": program_b["id"],
            "currentSemester": 1,
        },
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text


async def test_promotion_stops_at_the_final_semester(
    client, admin_headers, dept_factory, program_factory, student_factory
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=2)
    student = await student_factory(
        department_id=dept["id"], program_id=program["id"], current_semester=2
    )
    r = await client.post(
        "/students/promote", json={"ids": [student["id"]]}, headers=admin_headers
    )
    assert r.status_code == 422, r.text


async def test_search_wildcards_match_literally(
    client, admin_headers, dept_factory, program_factory, student_factory
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"])
    await student_factory(department_id=dept["id"], program_id=program["id"], name="Plain Name")
    r = await client.get("/students", params={"search": "_"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 0


# ---------------------------------------------------------------------------
# Cascades that reach attendance are audited and lock-guarded
# ---------------------------------------------------------------------------


async def _class_with_marks(client, admin_headers, dept_factory, program_factory,
                            semesters_of, course_factory, student_factory, term_factory):
    term = await term_factory()
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)
    course = await course_factory(semester_id=(await semesters_of(program["id"]))[0]["id"])
    student = await student_factory(department_id=dept["id"], program_id=program["id"])
    r = await client.post(
        "/attendance",
        json={
            "courseId": course["id"],
            "date": "2024-03-01",
            "period": 1,
            "termId": term["id"],
            "records": [{"studentId": student["id"], "status": "absent"}],
        },
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    return dept, program, course, student


async def test_deleting_a_student_with_marks_is_audited(
    client, admin_headers, dept_factory, program_factory, semesters_of,
    course_factory, student_factory, term_factory,
):
    *_, student = await _class_with_marks(
        client, admin_headers, dept_factory, program_factory, semesters_of,
        course_factory, student_factory, term_factory,
    )
    assert (await client.delete(f"/students/{student['id']}", headers=admin_headers)).status_code == 204

    log = (await client.get("/audit", params={"action": "remove-record"}, headers=admin_headers)).json()
    assert any(
        e["studentId"] == student["id"] and "deleted" in (e["note"] or "") for e in log["items"]
    ), log


async def test_deleting_a_department_with_locked_marks_is_refused_without_override(
    client, admin_headers, dept_factory, program_factory, semesters_of,
    course_factory, student_factory, term_factory, user_factory, login_as,
):
    dept, *_ = await _class_with_marks(
        client, admin_headers, dept_factory, program_factory, semesters_of,
        course_factory, student_factory, term_factory,
    )
    assert (await client.put("/lock-date", json={"date": "2024-06-30"}, headers=admin_headers)).status_code == 200
    principal = await user_factory("principal", password=PW, email="del.principal@example.com")
    headers = await login_as(client, principal["email"], PW)

    r = await client.delete(f"/departments/{dept['id']}", headers=headers)
    assert r.status_code == 403, r.text
    # The admin (override_lock) still can, and it is logged.
    assert (await client.delete(f"/departments/{dept['id']}", headers=admin_headers)).status_code == 204
    log = (await client.get("/audit", params={"action": "delete-session"}, headers=admin_headers)).json()
    assert any("Department" in (e["note"] or "") for e in log["items"]), log


# ---------------------------------------------------------------------------
# HTTP plumbing
# ---------------------------------------------------------------------------


async def test_repeat_get_with_matching_etag_is_304(client, admin_headers):
    first = await client.get("/settings", headers=admin_headers)
    assert first.status_code == 200 and first.headers.get("etag")
    again = await client.get(
        "/settings", headers={**admin_headers, "If-None-Match": first.headers["etag"]}
    )
    assert again.status_code == 304, again.text
    assert again.content == b""


async def test_401_keeps_its_www_authenticate_header(client):
    r = await client.get("/auth/me")
    assert r.status_code == 401
    assert r.headers.get("www-authenticate") == "Bearer"


async def test_an_unhandled_error_is_a_json_500_with_cors_headers(client):
    async def boom():
        raise RuntimeError("kaboom")

    app.add_api_route("/__test_boom", boom, methods=["GET"])
    try:
        r = await client.get("/__test_boom", headers={"Origin": "http://localhost:3000"})
    finally:
        app.router.routes[:] = [
            rt for rt in app.router.routes if getattr(rt, "path", None) != "/__test_boom"
        ]
    assert r.status_code == 500
    assert r.json() == {"detail": "Internal server error"}
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"


async def test_audit_term_filter_keeps_college_wide_entries_and_drops_other_terms(
    client, admin_headers, dept_factory, program_factory, semesters_of,
    course_factory, student_factory, term_factory,
):
    _, _, course, student = await _class_with_marks(
        client, admin_headers, dept_factory, program_factory, semesters_of,
        course_factory, student_factory, term_factory,
    )
    other_term = await term_factory()
    await client.post(
        "/attendance",
        json={
            "courseId": course["id"], "date": "2024-03-02", "period": 1,
            "termId": other_term["id"],
            "records": [{"studentId": student["id"], "status": "present"}],
        },
        headers=admin_headers,
    )
    await client.put("/lock-date", json={"date": "2024-01-01"}, headers=admin_headers)

    page = (
        await client.get(
            "/audit",
            params={"termId": other_term["id"], "pageSize": 200},
            headers=admin_headers,
        )
    ).json()
    # Arranging the class also logged its administrative creates (department,
    # program, course, students, terms) — college-wide, so they show in every
    # term too. This test is about the attendance entries.
    attendance = [
        e for e in page["items"] if e["action"] in ("mark", "edit", "lock", "unlock")
    ]
    actions = sorted(e["action"] for e in attendance)
    assert actions == ["lock", "mark"], page
    # Newest first across both branches of the union.
    assert page["items"][0]["action"] == "lock"
