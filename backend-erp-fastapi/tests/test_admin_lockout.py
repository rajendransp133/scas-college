"""An account cannot strip its own role.

`delete_user` has always refused self-deletion. `update_user` had no matching
guard, so `PUT /users/<own id> {"role": "teacher"}` succeeded and the caller
lost `manage_users` on the spot. For the last remaining admin that is a
one-way door: `assert_may_manage` (correctly) stops a principal from creating
an admin, so afterwards no account in the system can mint one and recovery
means editing the database by hand.
"""

from __future__ import annotations

PW = "lockout-pass-1"


async def test_an_admin_cannot_demote_itself(client, user_factory, login_as):
    email = "lockout.admin@example.com"
    admin = await user_factory("admin", password=PW, email=email)
    headers = await login_as(client, email, PW)

    r = await client.put(
        f"/users/{admin['id']}", json={"role": "teacher"}, headers=headers
    )
    assert r.status_code == 400, r.text
    assert "your own role" in r.json()["detail"]


async def test_the_would_be_demoted_admin_keeps_its_capabilities(
    client, user_factory, login_as
):
    email = "lockout.keeps@example.com"
    admin = await user_factory("admin", password=PW, email=email)
    headers = await login_as(client, email, PW)

    await client.put(f"/users/{admin['id']}", json={"role": "teacher"}, headers=headers)

    r = await client.get("/users", headers=headers)
    assert r.status_code == 200, r.text


async def test_an_admin_may_still_edit_its_own_other_fields(
    client, user_factory, login_as
):
    """The guard is on the role, not on self-edits — changing your own name or
    password has to keep working."""
    email = "lockout.rename@example.com"
    admin = await user_factory("admin", password=PW, email=email)
    headers = await login_as(client, email, PW)

    r = await client.put(
        f"/users/{admin['id']}", json={"name": "Renamed Admin"}, headers=headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Renamed Admin"


async def test_sending_the_same_role_is_not_treated_as_a_change(
    client, user_factory, login_as
):
    """A form that posts every field resubmits the unchanged role. Rejecting
    that would make the Users page unusable on your own account."""
    email = "lockout.same@example.com"
    admin = await user_factory("admin", password=PW, email=email)
    headers = await login_as(client, email, PW)

    r = await client.put(
        f"/users/{admin['id']}",
        json={"name": "Same Role", "role": "admin"},
        headers=headers,
    )
    assert r.status_code == 200, r.text


async def test_another_admin_can_still_perform_the_demotion(
    client, admin_headers, user_factory
):
    """Handing the role over stays possible — it just goes through someone
    else, which keeps at least one admin at every point."""
    target = await user_factory("admin", password=PW, email="lockout.target@example.com")

    r = await client.put(
        f"/users/{target['id']}", json={"role": "teacher"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "teacher"


async def test_the_guard_is_not_admin_specific(client, user_factory, login_as):
    """A principal is the only other role that can reach this endpoint
    (`manage_users`), and the reasoning is the same: an account that silently
    downgrades itself mid-session is a bug in every case, not just the one that
    happens to be unrecoverable."""
    email = "lockout.principal@example.com"
    principal = await user_factory("principal", password=PW, email=email)
    headers = await login_as(client, email, PW)

    r = await client.put(
        f"/users/{principal['id']}", json={"role": "teacher"}, headers=headers
    )
    assert r.status_code == 400, r.text
