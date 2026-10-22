"""Administrative changes are audited, and the attendance-manager may freeze
records without reading the log.

The audit log used to cover attendance only: an account could be created,
promoted to admin, have its password reset and be deleted with no trace, and
the same went for every student, teacher and curriculum edit. These pin one
entry per change, written in the same transaction, naming the entity — and
naming *which* fields changed, never their values (a student update can carry
an address or a guardian's phone, and the log is kept forever).
"""

from __future__ import annotations

import httpx
import pytest


async def _entries(
    client: httpx.AsyncClient, headers: dict[str, str], action: str
) -> list[dict]:
    r = await client.get("/audit", params={"action": action}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["items"]


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_account_lifecycle_is_audited(
    client: httpx.AsyncClient, admin_headers, user_factory
):
    user = await user_factory("teacher", name="Audit Target")
    [created] = await _entries(client, admin_headers, "create-user")
    assert "Audit Target" in created["note"]
    assert user["id"] in created["note"]

    r = await client.put(
        f"/users/{user['id']}",
        json={"role": "attendance-manager", "password": "brandnew123"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    [updated] = await _entries(client, admin_headers, "update-user")
    assert "role teacher → attendance-manager" in updated["note"]
    assert "password reset" in updated["note"]
    assert "brandnew123" not in updated["note"]

    r = await client.delete(f"/users/{user['id']}", headers=admin_headers)
    assert r.status_code == 204, r.text
    [deleted] = await _entries(client, admin_headers, "delete-user")
    # The directory can't resolve the id any more — the note must name it.
    assert "Audit Target" in deleted["note"]


@pytest.mark.asyncio
async def test_disabling_an_account_is_spelled_out(
    client: httpx.AsyncClient, admin_headers, user_factory
):
    user = await user_factory("teacher")
    r = await client.put(
        f"/users/{user['id']}", json={"isActive": False}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    [entry] = await _entries(client, admin_headers, "update-user")
    assert "disabled" in entry["note"]


@pytest.mark.asyncio
async def test_a_no_op_update_writes_no_entry(
    client: httpx.AsyncClient, admin_headers, user_factory
):
    user = await user_factory("teacher")
    r = await client.put(
        f"/users/{user['id']}", json={"name": user["name"]}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert await _entries(client, admin_headers, "update-user") == []


@pytest.mark.asyncio
async def test_self_service_password_change_is_audited_against_the_account(
    client: httpx.AsyncClient, admin_headers, user_factory, login_as
):
    user = await user_factory("teacher", password="oldpass123")
    headers = await login_as(client, user["email"], "oldpass123")
    r = await client.post(
        "/auth/change-password",
        json={"currentPassword": "oldpass123", "newPassword": "newpass456"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    [entry] = await _entries(client, admin_headers, "change-password")
    assert entry["userId"] == user["id"]


# ---------------------------------------------------------------------------
# Students
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_student_changes_are_audited_without_personal_values(
    client: httpx.AsyncClient, admin_headers, dept_factory, program_factory, student_factory
):
    dept = await dept_factory()
    prog = await program_factory(dept["id"])
    st = await student_factory(dept["id"], prog["id"])

    [created] = await _entries(client, admin_headers, "create-student")
    assert created["studentId"] == st["id"]

    r = await client.put(
        f"/students/{st['id']}",
        json={"address": "42 Secret Lane", "guardianPhone": "7111111111"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    [updated] = await _entries(client, admin_headers, "update-student")
    assert updated["studentId"] == st["id"]
    assert "address" in updated["note"] and "guardianPhone" in updated["note"]
    assert "42 Secret Lane" not in updated["note"]
    assert "7111111111" not in updated["note"]

    r = await client.post(f"/students/{st['id']}/toggle-active", headers=admin_headers)
    assert r.status_code == 200, r.text
    toggled = await _entries(client, admin_headers, "update-student")
    assert "Deactivated" in toggled[0]["note"]

    r = await client.delete(f"/students/{st['id']}", headers=admin_headers)
    assert r.status_code == 204, r.text
    [deleted] = await _entries(client, admin_headers, "delete-student")
    assert st["rollNumber"] in deleted["note"]


@pytest.mark.asyncio
async def test_promotion_is_one_entry_for_the_batch(
    client: httpx.AsyncClient, admin_headers, dept_factory, program_factory, student_factory
):
    dept = await dept_factory()
    prog = await program_factory(dept["id"], semester_count=4)
    ids = [(await student_factory(dept["id"], prog["id"]))["id"] for _ in range(3)]

    r = await client.post("/students/promote", json={"ids": ids}, headers=admin_headers)
    assert r.status_code == 200, r.text
    [entry] = await _entries(client, admin_headers, "promote-students")
    assert "Promoted 3 student(s)" in entry["note"]


# ---------------------------------------------------------------------------
# Staff, curriculum, assignments, terms
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_staff_and_curriculum_changes_are_audited(
    client: httpx.AsyncClient,
    admin_headers,
    dept_factory,
    program_factory,
    semesters_of,
    course_factory,
    teacher_factory,
    term_factory,
    assignment_factory,
):
    dept = await dept_factory(code="AUDX")
    prog = await program_factory(dept["id"])
    [sem, _] = await semesters_of(prog["id"])
    course = await course_factory(sem["id"])
    teacher = await teacher_factory(dept["id"])
    term = await term_factory()
    await assignment_factory(course["id"], teacher["id"], term["id"])

    assert "AUDX" in (await _entries(client, admin_headers, "create-department"))[0]["note"]
    assert (await _entries(client, admin_headers, "create-program"))
    [course_entry] = await _entries(client, admin_headers, "create-course")
    assert course_entry["courseId"] == course["id"]
    assert (await _entries(client, admin_headers, "create-teacher"))
    assert (await _entries(client, admin_headers, "create-term"))
    [assigned] = await _entries(client, admin_headers, "assign-course")
    assert assigned["courseId"] == course["id"]
    assert assigned["termId"] == term["id"]

    r = await client.post(
        f"/teachers/{teacher['id']}/hod", json={"isHod": True}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    [hod] = await _entries(client, admin_headers, "update-teacher")
    assert "HOD" in hod["note"]

    r = await client.put("/terms/current", json={"termId": term["id"]}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert (await _entries(client, admin_headers, "set-current-term"))

    r = await client.delete(f"/departments/{dept['id']}", headers=admin_headers)
    assert r.status_code == 204, r.text
    [gone] = await _entries(client, admin_headers, "delete-department")
    assert "AUDX" in gone["note"]


# ---------------------------------------------------------------------------
# Attendance-manager: may lock, may not read the audit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_attendance_manager_can_lock_but_not_read_the_audit(
    client: httpx.AsyncClient, admin_headers, user_factory, login_as
):
    mgr = await user_factory("attendance-manager", password="manager123")
    headers = await login_as(client, mgr["email"], "manager123")

    r = await client.put("/lock-date", json={"date": "2024-06-30"}, headers=headers)
    assert r.status_code == 200, r.text
    assert (await client.get("/settings", headers=headers)).json()["lockDate"] == "2024-06-30"

    # The freeze card's timeline is open to it — lock/unlock entries only.
    r = await client.get("/audit/lock-history", headers=headers)
    assert r.status_code == 200, r.text
    assert [e["action"] for e in r.json()] == ["lock"]

    # The log and the warning signs are not.
    assert (await client.get("/audit", headers=headers)).status_code == 403
    assert (await client.get("/attendance/red-flags", headers=headers)).status_code == 403

    r = await client.put("/lock-date", json={"date": None}, headers=headers)
    assert r.status_code == 200, r.text
    actions = [e["action"] for e in await _entries(client, admin_headers, "unlock")]
    assert actions == ["unlock"]


@pytest.mark.asyncio
async def test_principal_still_cannot_lock(
    client: httpx.AsyncClient, user_factory, login_as
):
    principal = await user_factory("principal", password="principal123")
    headers = await login_as(client, principal["email"], "principal123")
    r = await client.put("/lock-date", json={"date": "2024-06-30"}, headers=headers)
    assert r.status_code == 403
    assert (await client.get("/audit/lock-history", headers=headers)).status_code == 403
