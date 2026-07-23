"""The core of the suite: `services/attendance.py`.

- Session upsert keyed on (course_id, date, period) — POST /attendance twice
  for the same key updates in place, never duplicates.
- Correction diffing — `original_status` is stamped on the *first* change to
  a record only; a second correction must not clobber it.
- Every mutation kind (mark / edit / delete-session / lock / unlock) leaves
  an AuditEntry.
- The lock guard: a date at/before the configured lock date is blocked for
  ordinary roles (`mark_scope="own"`, no `override_lock`) but allowed for
  roles with `override_lock` (admin, attendance-manager).
"""

from __future__ import annotations

import pytest_asyncio


@pytest_asyncio.fixture
async def course_and_student(dept_factory, program_factory, semesters_of, course_factory, student_factory):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)
    semesters = await semesters_of(program["id"])
    course = await course_factory(semester_id=semesters[0]["id"])
    student = await student_factory(department_id=dept["id"], program_id=program["id"])
    return {"dept": dept, "program": program, "course": course, "student": student}


async def _mark(client, headers, course_id, term_id, date, period, records):
    r = await client.post(
        "/attendance",
        json={
            "courseId": course_id,
            "date": date,
            "period": period,
            "termId": term_id,
            "records": records,
        },
        headers=headers,
    )
    return r


# ---------------------------------------------------------------------------
# Upsert on (course_id, date, period)
# ---------------------------------------------------------------------------


async def test_saving_twice_for_the_same_key_updates_not_duplicates(
    client, admin_headers, term_factory, course_and_student
):
    term = await term_factory()
    course = course_and_student["course"]
    student = course_and_student["student"]

    r1 = await _mark(
        client, admin_headers, course["id"], term["id"], "2024-03-01", 1,
        [{"studentId": student["id"], "status": "present"}],
    )
    assert r1.status_code == 200, r1.text
    session_id_1 = r1.json()["id"]

    r2 = await _mark(
        client, admin_headers, course["id"], term["id"], "2024-03-01", 1,
        [{"studentId": student["id"], "status": "absent"}],
    )
    assert r2.status_code == 200, r2.text
    session_id_2 = r2.json()["id"]

    assert session_id_1 == session_id_2

    listing = await client.get(
        "/attendance",
        params={"courseId": course["id"], "termId": term["id"], "date": "2024-03-01"},
        headers=admin_headers,
    )
    assert listing.json()["total"] == 1
    session = listing.json()["items"][0]
    assert session["records"][0]["status"] == "absent"


# ---------------------------------------------------------------------------
# Correction diffing: original_status stamped once
# ---------------------------------------------------------------------------


async def test_original_status_set_on_first_change_only(
    client, admin_headers, term_factory, course_and_student
):
    term = await term_factory()
    course = course_and_student["course"]
    student = course_and_student["student"]

    await _mark(
        client, admin_headers, course["id"], term["id"], "2024-03-05", 1,
        [{"studentId": student["id"], "status": "present"}],
    )

    r2 = await _mark(
        client, admin_headers, course["id"], term["id"], "2024-03-05", 1,
        [{"studentId": student["id"], "status": "absent"}],
    )
    rec2 = r2.json()["records"][0]
    assert rec2["status"] == "absent"
    assert rec2["originalStatus"] == "present"

    r3 = await _mark(
        client, admin_headers, course["id"], term["id"], "2024-03-05", 1,
        [{"studentId": student["id"], "status": "late"}],
    )
    rec3 = r3.json()["records"][0]
    assert rec3["status"] == "late"
    # Still "present" — the *second* correction must not overwrite it.
    assert rec3["originalStatus"] == "present"


async def test_set_status_endpoint_also_preserves_original_status_once(
    client, admin_headers, term_factory, course_and_student
):
    term = await term_factory()
    course = course_and_student["course"]
    student = course_and_student["student"]

    r1 = await _mark(
        client, admin_headers, course["id"], term["id"], "2024-03-06", 1,
        [{"studentId": student["id"], "status": "present"}],
    )
    session_id = r1.json()["id"]

    r2 = await client.patch(
        f"/attendance/{session_id}/records/{student['id']}",
        json={"status": "od"},
        headers=admin_headers,
    )
    assert r2.status_code == 200
    rec2 = next(r for r in r2.json()["records"] if r["studentId"] == student["id"])
    assert rec2["status"] == "od"
    assert rec2["originalStatus"] == "present"

    r3 = await client.patch(
        f"/attendance/{session_id}/records/{student['id']}",
        json={"status": "late"},
        headers=admin_headers,
    )
    rec3 = next(r for r in r3.json()["records"] if r["studentId"] == student["id"])
    assert rec3["status"] == "late"
    assert rec3["originalStatus"] == "present"


# ---------------------------------------------------------------------------
# Audit stamping — every mutation kind produces an AuditEntry.
# ---------------------------------------------------------------------------


async def test_mark_edit_delete_produce_audit_entries(
    client, admin_headers, term_factory, course_and_student
):
    term = await term_factory()
    course = course_and_student["course"]
    student = course_and_student["student"]

    r1 = await _mark(
        client, admin_headers, course["id"], term["id"], "2024-03-10", 1,
        [{"studentId": student["id"], "status": "present"}],
    )
    session_id = r1.json()["id"]

    await _mark(
        client, admin_headers, course["id"], term["id"], "2024-03-10", 1,
        [{"studentId": student["id"], "status": "absent"}],
    )

    del_r = await client.delete(f"/attendance/{session_id}", headers=admin_headers)
    assert del_r.status_code == 204

    audit = await client.get(
        "/audit", params={"courseId": course["id"]}, headers=admin_headers
    )
    actions = [a["action"] for a in audit.json()["items"]]
    assert "mark" in actions
    assert "edit" in actions
    assert "delete-session" in actions


async def test_lock_and_unlock_produce_audit_entries(client, admin_headers):
    lock_r = await client.put(
        "/lock-date", json={"date": "2024-01-01"}, headers=admin_headers
    )
    assert lock_r.status_code == 200

    unlock_r = await client.put("/lock-date", json={"date": None}, headers=admin_headers)
    assert unlock_r.status_code == 200

    audit = await client.get(
        "/audit", params={"action": "lock"}, headers=admin_headers
    )
    assert audit.json()["total"] >= 1

    audit_unlock = await client.get(
        "/audit", params={"action": "unlock"}, headers=admin_headers
    )
    assert audit_unlock.json()["total"] >= 1


# ---------------------------------------------------------------------------
# Lock guard: dates at/before lock_date are frozen for ordinary roles, but
# roles with override_lock (admin, attendance-manager) can still write.
# ---------------------------------------------------------------------------


async def test_locked_date_blocks_ordinary_role_but_allows_override(
    client,
    admin_headers,
    login_as,
    term_factory,
    course_and_student,
    teacher_factory,
    assignment_factory,
    user_factory,
):
    term = await term_factory()
    course = course_and_student["course"]
    student = course_and_student["student"]
    dept = course_and_student["dept"]

    teacher = await teacher_factory(department_id=dept["id"])
    await assignment_factory(course_id=course["id"], teacher_id=teacher["id"], term_id=term["id"])
    teacher_login = await user_factory(role="teacher", teacher_id=teacher["id"])
    teacher_headers = await login_as(client, teacher_login["email"], teacher_login["_password"])

    # Lock everything up to and including 2024-04-01.
    lock_r = await client.put(
        "/lock-date", json={"date": "2024-04-01"}, headers=admin_headers
    )
    assert lock_r.status_code == 200

    # Ordinary teacher (mark_scope="own", no override_lock) is blocked for a
    # date at the lock boundary.
    blocked = await _mark(
        client, teacher_headers, course["id"], term["id"], "2024-04-01", 1,
        [{"studentId": student["id"], "status": "present"}],
    )
    assert blocked.status_code == 403

    # A date after the lock boundary is fine for the same teacher.
    allowed = await _mark(
        client, teacher_headers, course["id"], term["id"], "2024-04-02", 1,
        [{"studentId": student["id"], "status": "present"}],
    )
    assert allowed.status_code == 200

    # admin has override_lock=True — can still write on/before the lock date.
    admin_allowed = await _mark(
        client, admin_headers, course["id"], term["id"], "2024-04-01", 2,
        [{"studentId": student["id"], "status": "present"}],
    )
    assert admin_allowed.status_code == 200
