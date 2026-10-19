"""Login, JWT round-trip, `/auth/me` role-derived fields, and the login
rate limiter (10/minute, `main.py` + `rate_limit.py`)."""

from __future__ import annotations


from security import create_access_token, decode_token


# ---------------------------------------------------------------------------
# POST /auth/login
# ---------------------------------------------------------------------------


async def test_login_success_returns_token_and_user(client, admin_creds):
    r = await client.post(
        "/auth/login",
        json={"email": admin_creds["email"], "password": admin_creds["password"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["tokenType"] == "bearer"
    assert body["accessToken"]
    assert body["user"]["email"] == admin_creds["email"]
    assert body["user"]["role"] == "admin"
    # Password hash must never leak into the response.
    assert "password" not in body["user"]
    assert "passwordHash" not in body["user"]


async def test_login_wrong_password_is_401(client, admin_creds):
    r = await client.post(
        "/auth/login",
        json={"email": admin_creds["email"], "password": "not-the-password"},
    )
    assert r.status_code == 401


async def test_login_unknown_email_is_401(client):
    r = await client.post(
        "/auth/login",
        json={"email": "nobody@example.com", "password": "whatever"},
    )
    assert r.status_code == 401


async def test_login_email_is_case_insensitive(client, admin_creds):
    r = await client.post(
        "/auth/login",
        json={
            "email": admin_creds["email"].upper(),
            "password": admin_creds["password"],
        },
    )
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# JWT round-trip (security.py, no HTTP layer)
# ---------------------------------------------------------------------------


def test_jwt_round_trip():
    token = create_access_token("usr-123", epoch=0)
    assert decode_token(token) == ("usr-123", 0)


def test_jwt_carries_the_token_epoch():
    token = create_access_token("usr-123", epoch=7)
    assert decode_token(token) == ("usr-123", 7)


def test_jwt_garbage_token_decodes_to_none():
    assert decode_token("not-a-real-token") is None


def test_jwt_tampered_token_decodes_to_none():
    token = create_access_token("usr-123")
    # Flip a character in the middle of the signature segment rather than the
    # very last character of the token: base64url's final quantum can carry
    # spare zero-padding bits that a lenient decoder ignores, so mutating
    # exactly the last character can decode back to the *same* signature
    # bytes and not actually tamper anything.
    mid = len(token) // 2
    tampered = token[:mid] + ("A" if token[mid] != "A" else "B") + token[mid + 1 :]
    assert decode_token(tampered) is None


# ---------------------------------------------------------------------------
# GET /auth/me — role-derived scope fields
# ---------------------------------------------------------------------------


async def test_me_requires_auth(client):
    r = await client.get("/auth/me")
    assert r.status_code == 401


async def test_me_admin_has_no_derived_scope(client, admin_headers):
    r = await client.get("/auth/me", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "admin"
    assert body["departmentId"] is None
    assert body["classProgramId"] is None
    assert body["classSemester"] is None


async def test_me_hod_resolves_department_via_teacher(
    client, admin_headers, login_as, dept_factory, teacher_factory, user_factory
):
    dept = await dept_factory()
    teacher = await teacher_factory(department_id=dept["id"], is_hod=True)
    hod_user = await user_factory(role="hod", teacher_id=teacher["id"])

    headers = await login_as(client, hod_user["email"], hod_user["_password"])
    r = await client.get("/auth/me", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "hod"
    assert body["departmentId"] == dept["id"]


async def test_me_student_rep_exposes_class_scope(
    client, login_as, dept_factory, program_factory, user_factory
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"])

    rep_user = await user_factory(
        role="student-rep", program_id=program["id"], class_semester=3
    )
    headers = await login_as(client, rep_user["email"], rep_user["_password"])
    r = await client.get("/auth/me", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "student-rep"
    assert body["classProgramId"] == program["id"]
    assert body["classSemester"] == 3


# ---------------------------------------------------------------------------
# Rate limiting: 10/minute on /auth/login (slowapi, in-memory storage reset
# per test by the `_isolate` autouse fixture in conftest.py).
# ---------------------------------------------------------------------------


async def test_login_rate_limited_after_ten_attempts(client):
    payload = {"email": "nobody@example.com", "password": "wrong"}
    for _ in range(10):
        r = await client.post("/auth/login", json=payload)
        assert r.status_code == 401
    r = await client.post("/auth/login", json=payload)
    assert r.status_code == 429
