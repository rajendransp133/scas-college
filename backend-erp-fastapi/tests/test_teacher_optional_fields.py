"""Adding a teacher requires only identity + department.

Employee id, name and department are mandatory; the rest is nullable and
back-fillable. The department stays required because it decides HOD-ship and
course assignment — a teacher without one belongs to no register.

The regression these tests lock down is concrete: the production seed had no
phone numbers, so it wrote "" into a NOT NULL column, and `TeacherResponse`
demanded `min_length=1` on the way back out. `GET /teachers` returned 500 for
every caller and the teachers page rendered empty.
"""

from __future__ import annotations

import httpx
import pytest

_OPTIONAL_FIELDS = ["email", "phone", "qualification", "joiningDate"]


@pytest.mark.asyncio
async def test_create_teacher_with_only_the_required_fields(
    client: httpx.AsyncClient, dept_factory, admin_headers
):
    dept = await dept_factory()

    r = await client.post(
        "/teachers",
        json={
            "employeeId": "MIN-T1",
            "name": "Minimal Teacher",
            "departmentId": dept["id"],
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    for field in _OPTIONAL_FIELDS:
        assert body[field] is None, f"{field} should come back null, got {body[field]!r}"
    # Not nullable — it defaults instead, so the caller never has to send it.
    assert body["designation"] == "Assistant Professor"
    assert body["isHod"] is False


@pytest.mark.asyncio
async def test_blank_strings_are_stored_as_null(
    client: httpx.AsyncClient, dept_factory, admin_headers
):
    """An untouched HTML input submits "", not null — both must mean absent.

    Without the normalisation, "" would fail EmailStr/date validation outright.
    """
    dept = await dept_factory()

    r = await client.post(
        "/teachers",
        json={
            "employeeId": "BLANK-T1",
            "name": "Blank Fields",
            "departmentId": dept["id"],
            "email": "",
            "phone": "",
            "qualification": "",
            "joiningDate": "",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    for field in _OPTIONAL_FIELDS:
        assert body[field] is None, f"{field} should be null, got {body[field]!r}"


@pytest.mark.asyncio
async def test_many_teachers_may_have_no_email(
    client: httpx.AsyncClient, dept_factory, admin_headers
):
    """`email` is UNIQUE but nullable — Postgres allows any number of NULLs
    under a unique index, so "no email on file" must not collide."""
    dept = await dept_factory()
    for n in (1, 2):
        r = await client.post(
            "/teachers",
            json={
                "employeeId": f"NOEMAIL-{n}",
                "name": f"No Email {n}",
                "departmentId": dept["id"],
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["employeeId", "name", "departmentId"])
async def test_required_fields_are_still_required(
    client: httpx.AsyncClient, dept_factory, admin_headers, missing
):
    dept = await dept_factory()
    payload = {
        "employeeId": f"REQ-{missing}",
        "name": "Required Check",
        "departmentId": dept["id"],
    }
    del payload[missing]

    r = await client.post("/teachers", json=payload, headers=admin_headers)
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_a_minimal_teacher_can_be_made_hod(
    client: httpx.AsyncClient, dept_factory, admin_headers
):
    """The point of keeping the department required: HOD-ship still works on a
    teacher created with nothing else filled in."""
    dept = await dept_factory()
    created = await client.post(
        "/teachers",
        json={
            "employeeId": "MIN-HOD1",
            "name": "Minimal Hod",
            "departmentId": dept["id"],
            "isHod": True,
        },
        headers=admin_headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["isHod"] is True

    hods = await client.get("/teachers/hods", headers=admin_headers)
    assert any(t["employeeId"] == "MIN-HOD1" for t in hods.json())


@pytest.mark.asyncio
async def test_teacher_list_serialises_rows_with_null_optionals(
    client: httpx.AsyncClient, dept_factory, admin_headers
):
    """The actual 500 regression: one row with an absent phone must not break
    serialisation of the whole page."""
    dept = await dept_factory()
    await client.post(
        "/teachers",
        json={"employeeId": "LIST-T1", "name": "Listed", "departmentId": dept["id"]},
        headers=admin_headers,
    )

    r = await client.get(
        "/teachers", params={"departmentId": dept["id"]}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert any(t["employeeId"] == "LIST-T1" for t in r.json()["items"])


@pytest.mark.asyncio
async def test_an_optional_field_can_be_cleared_on_update(
    client: httpx.AsyncClient, dept_factory, teacher_factory, admin_headers
):
    dept = await dept_factory()
    teacher = await teacher_factory(department_id=dept["id"])
    assert teacher["phone"] is not None

    r = await client.put(
        f"/teachers/{teacher['id']}", json={"phone": None}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["phone"] is None
