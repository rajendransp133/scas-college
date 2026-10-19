"""Disabling an account and rotating a password actually cut off access.

A stateless JWT is valid until it expires — up to 12h — so "disable this
login" and "reset this password" are empty gestures unless something in the
request path rejects the tokens they were meant to kill. `User.token_epoch`
(stamped into every JWT, checked in `deps.get_current_user`) and the
`is_active` gate are that something.

Written from the holder's side: take a real token, change the account out from
under it, and assert the old token stops working.
"""

from __future__ import annotations

import httpx

PW = "lifecycle-pass-1"


async def _login(client: httpx.AsyncClient, email: str, password: str) -> str:
    r = await client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["accessToken"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Disable
# ---------------------------------------------------------------------------


async def test_disabling_an_account_revokes_its_live_token(
    client, admin_headers, user_factory
):
    email = "life.disable@example.com"
    user = await user_factory("attendance-manager", password=PW, email=email)
    token = await _login(client, email, PW)
    assert (await client.get("/auth/me", headers=_auth(token))).status_code == 200

    r = await client.put(
        f"/users/{user['id']}", json={"isActive": False}, headers=admin_headers
    )
    assert r.status_code == 200, r.text

    # The token that worked a moment ago is now dead.
    assert (await client.get("/auth/me", headers=_auth(token))).status_code == 401


async def test_a_disabled_account_cannot_log_in(client, admin_headers, user_factory):
    email = "life.nologin@example.com"
    user = await user_factory("attendance-manager", password=PW, email=email)
    await client.put(
        f"/users/{user['id']}", json={"isActive": False}, headers=admin_headers
    )
    r = await client.post("/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 401, r.text


async def test_re_enabling_restores_login(client, admin_headers, user_factory):
    email = "life.reenable@example.com"
    user = await user_factory("attendance-manager", password=PW, email=email)
    await client.put(
        f"/users/{user['id']}", json={"isActive": False}, headers=admin_headers
    )
    await client.put(
        f"/users/{user['id']}", json={"isActive": True}, headers=admin_headers
    )
    # A fresh login works and carries the current (bumped) epoch.
    token = await _login(client, email, PW)
    assert (await client.get("/auth/me", headers=_auth(token))).status_code == 200


async def test_admin_cannot_disable_its_own_account(client, admin_headers):
    me = (await client.get("/auth/me", headers=admin_headers)).json()["user"]
    r = await client.put(
        f"/users/{me['id']}", json={"isActive": False}, headers=admin_headers
    )
    assert r.status_code == 400, r.text
    # And it is still usable.
    assert (await client.get("/auth/me", headers=admin_headers)).status_code == 200


# ---------------------------------------------------------------------------
# Password rotation
# ---------------------------------------------------------------------------


async def test_changing_password_revokes_other_sessions_but_keeps_this_one(
    client, user_factory
):
    email = "life.changepw@example.com"
    await user_factory("attendance-manager", password=PW, email=email)
    # Two devices, two tokens, same epoch.
    token_a = await _login(client, email, PW)
    token_b = await _login(client, email, PW)

    r = await client.post(
        "/auth/change-password",
        json={"currentPassword": PW, "newPassword": "new-pass-9876"},
        headers=_auth(token_a),
    )
    assert r.status_code == 200, r.text
    fresh = r.json()["accessToken"]

    # The other device's token is revoked; the fresh token works.
    assert (await client.get("/auth/me", headers=_auth(token_b))).status_code == 401
    assert (await client.get("/auth/me", headers=_auth(fresh))).status_code == 200


async def test_admin_password_reset_revokes_the_targets_token(
    client, admin_headers, user_factory
):
    email = "life.reset@example.com"
    user = await user_factory("attendance-manager", password=PW, email=email)
    token = await _login(client, email, PW)

    r = await client.put(
        f"/users/{user['id']}",
        json={"password": "admin-set-pass-1"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text

    assert (await client.get("/auth/me", headers=_auth(token))).status_code == 401
    # The new password is what works now.
    new_token = await _login(client, email, "admin-set-pass-1")
    assert (await client.get("/auth/me", headers=_auth(new_token))).status_code == 200


async def test_a_token_from_before_a_disable_stays_dead_after_re_enable(
    client, admin_headers, user_factory
):
    """Re-enabling restores the *account*, not the sessions disabling killed."""
    email = "life.stale@example.com"
    user = await user_factory("attendance-manager", password=PW, email=email)
    stale = await _login(client, email, PW)
    for active in (False, True):
        r = await client.put(
            f"/users/{user['id']}", json={"isActive": active}, headers=admin_headers
        )
        assert r.status_code == 200, r.text
    assert (await client.get("/auth/me", headers=_auth(stale))).status_code == 401


async def test_a_principal_cannot_disable_an_admin(
    client, user_factory, login_as
):
    target = await user_factory("admin", password=PW, email="life.target@example.com")
    principal = await user_factory(
        "principal", password=PW, email="life.principal@example.com"
    )
    headers = await login_as(client, principal["email"], PW)
    r = await client.put(
        f"/users/{target['id']}", json={"isActive": False}, headers=headers
    )
    assert r.status_code == 403, r.text
    # And the admin can still sign in.
    await _login(client, target["email"], PW)


async def test_a_disabled_token_is_refused_on_every_endpoint_not_just_me(
    client, admin_headers, user_factory
):
    email = "life.everywhere@example.com"
    user = await user_factory("attendance-manager", password=PW, email=email)
    token = await _login(client, email, PW)
    await client.put(
        f"/users/{user['id']}", json={"isActive": False}, headers=admin_headers
    )
    assert (await client.get("/settings", headers=_auth(token))).status_code == 401


async def test_unknown_email_and_wrong_password_fail_identically(client, user_factory):
    email = "life.same@example.com"
    await user_factory("attendance-manager", password=PW, email=email)
    wrong = await client.post("/auth/login", json={"email": email, "password": "nope-nope"})
    unknown = await client.post(
        "/auth/login", json={"email": "nobody@example.com", "password": "nope-nope"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
