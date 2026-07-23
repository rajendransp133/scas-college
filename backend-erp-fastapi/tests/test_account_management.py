"""Principal account management, the admin-escalation guard, and the
self-service password change.

The escalation tests are the load-bearing ones: `manage_users` was widened to
include the principal, and the whole reason that is safe is that a principal
cannot reach an `admin` account by any route (create, promote, demote, delete).
"""

from __future__ import annotations

import httpx
import pytest


@pytest.mark.asyncio
async def test_principal_can_create_non_admin_accounts(
    client: httpx.AsyncClient, user_factory, login_as
):
    principal = await user_factory("principal", password="principal123")
    headers = await login_as(client, principal["email"], "principal123")

    r = await client.post(
        "/users",
        json={
            "name": "New Attendance Manager",
            "email": "attmgr@example.com",
            "role": "attendance-manager",
            "password": "pass1234",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "attendance-manager"


@pytest.mark.asyncio
async def test_principal_can_list_users(
    client: httpx.AsyncClient, user_factory, login_as
):
    principal = await user_factory("principal", password="principal123")
    headers = await login_as(client, principal["email"], "principal123")

    r = await client.get("/users", headers=headers)
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_principal_cannot_create_admin(
    client: httpx.AsyncClient, user_factory, login_as
):
    principal = await user_factory("principal", password="principal123")
    headers = await login_as(client, principal["email"], "principal123")

    r = await client.post(
        "/users",
        json={
            "name": "Backdoor",
            "email": "backdoor@example.com",
            "role": "admin",
            "password": "pass1234",
        },
        headers=headers,
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_principal_cannot_promote_anyone_to_admin(
    client: httpx.AsyncClient, user_factory, login_as
):
    principal = await user_factory("principal", password="principal123")
    victim = await user_factory("teacher")
    headers = await login_as(client, principal["email"], "principal123")

    r = await client.put(
        f"/users/{victim['id']}", json={"role": "admin"}, headers=headers
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_principal_cannot_edit_or_delete_an_admin(
    client: httpx.AsyncClient, user_factory, login_as, admin_creds
):
    principal = await user_factory("principal", password="principal123")
    other_admin = await user_factory("admin")
    headers = await login_as(client, principal["email"], "principal123")

    # Demoting an admin out of the way is the same escalation by another route.
    r = await client.put(
        f"/users/{other_admin['id']}", json={"role": "teacher"}, headers=headers
    )
    assert r.status_code == 403, r.text

    r = await client.delete(f"/users/{other_admin['id']}", headers=headers)
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_admin_can_still_manage_admins(
    client: httpx.AsyncClient, user_factory, admin_headers
):
    other_admin = await user_factory("admin")
    r = await client.put(
        f"/users/{other_admin['id']}", json={"name": "Renamed"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Renamed"


@pytest.mark.asyncio
async def test_teacher_cannot_manage_users(
    client: httpx.AsyncClient, user_factory, login_as
):
    teacher = await user_factory("teacher", password="teacher123")
    headers = await login_as(client, teacher["email"], "teacher123")

    r = await client.get("/users", headers=headers)
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Self-service password change
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_change_password_then_login_with_the_new_one(
    client: httpx.AsyncClient, user_factory, login_as
):
    teacher = await user_factory("teacher", password="oldpass123")
    headers = await login_as(client, teacher["email"], "oldpass123")

    r = await client.post(
        "/auth/change-password",
        json={"currentPassword": "oldpass123", "newPassword": "newpass456"},
        headers=headers,
    )
    assert r.status_code == 204, r.text

    old = await client.post(
        "/auth/login", json={"email": teacher["email"], "password": "oldpass123"}
    )
    assert old.status_code == 401

    new = await client.post(
        "/auth/login", json={"email": teacher["email"], "password": "newpass456"}
    )
    assert new.status_code == 200, new.text


@pytest.mark.asyncio
async def test_change_password_rejects_a_wrong_current_password(
    client: httpx.AsyncClient, user_factory, login_as
):
    teacher = await user_factory("teacher", password="oldpass123")
    headers = await login_as(client, teacher["email"], "oldpass123")

    r = await client.post(
        "/auth/change-password",
        json={"currentPassword": "notmypassword", "newPassword": "newpass456"},
        headers=headers,
    )
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_change_password_rejects_a_short_new_password(
    client: httpx.AsyncClient, user_factory, login_as
):
    teacher = await user_factory("teacher", password="oldpass123")
    headers = await login_as(client, teacher["email"], "oldpass123")

    r = await client.post(
        "/auth/change-password",
        json={"currentPassword": "oldpass123", "newPassword": "short"},
        headers=headers,
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_student_rep_cannot_change_the_shared_password(
    client: httpx.AsyncClient,
    dept_factory,
    program_factory,
    user_factory,
    login_as,
):
    dept = await dept_factory()
    program = await program_factory(dept["id"])
    rep = await user_factory(
        "student-rep",
        password="reppass123",
        program_id=program["id"],
        class_semester=1,
    )
    headers = await login_as(client, rep["email"], "reppass123")

    r = await client.post(
        "/auth/change-password",
        json={"currentPassword": "reppass123", "newPassword": "newpass456"},
        headers=headers,
    )
    assert r.status_code == 403, r.text
