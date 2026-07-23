"""Student intake requires only identity + class placement.

Roll number, name, department, program and semester are mandatory; the rest is
nullable and back-fillable. The class-placement trio stays required because it
decides which attendance roster the student appears in — a student without it
would exist but be invisible to every register.
"""

from __future__ import annotations

import httpx
import pytest

_OPTIONAL_FIELDS = [
    "email",
    "phone",
    "address",
    "dateOfBirth",
    "gender",
    "admissionYear",
    "guardianName",
    "guardianRelation",
    "guardianPhone",
]


@pytest.mark.asyncio
async def test_create_student_with_only_the_required_fields(
    client: httpx.AsyncClient, dept_factory, program_factory, admin_headers
):
    dept = await dept_factory()
    program = await program_factory(dept["id"])

    r = await client.post(
        "/students",
        json={
            "rollNumber": "MINIMAL1",
            "name": "Minimal Student",
            "departmentId": dept["id"],
            "programId": program["id"],
            "currentSemester": 1,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["rollNumber"] == "MINIMAL1"
    for field in _OPTIONAL_FIELDS:
        assert body[field] is None, f"{field} should come back null, got {body[field]!r}"


@pytest.mark.asyncio
async def test_blank_strings_are_stored_as_null(
    client: httpx.AsyncClient, dept_factory, program_factory, admin_headers
):
    """An untouched HTML input submits "", not null — both must mean absent.

    Without the normalisation, "" would fail EmailStr validation outright and
    the other columns would fill up with empty strings that read as present.
    """
    dept = await dept_factory()
    program = await program_factory(dept["id"])

    r = await client.post(
        "/students",
        json={
            "rollNumber": "BLANK1",
            "name": "Blank Fields",
            "departmentId": dept["id"],
            "programId": program["id"],
            "currentSemester": 1,
            "email": "",
            "phone": "",
            "address": "",
            "dateOfBirth": "",
            "gender": "",
            "guardianName": "",
            "guardianRelation": "",
            "guardianPhone": "",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    for field in ["email", "phone", "address", "dateOfBirth", "gender"]:
        assert body[field] is None, f"{field} should be null, got {body[field]!r}"


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["rollNumber", "name", "programId", "currentSemester"])
async def test_required_fields_are_still_required(
    client: httpx.AsyncClient, dept_factory, program_factory, admin_headers, missing
):
    dept = await dept_factory()
    program = await program_factory(dept["id"])
    payload = {
        "rollNumber": f"REQ-{missing}",
        "name": "Required Check",
        "departmentId": dept["id"],
        "programId": program["id"],
        "currentSemester": 1,
    }
    del payload[missing]

    r = await client.post("/students", json=payload, headers=admin_headers)
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_an_optional_field_can_be_cleared_on_update(
    client: httpx.AsyncClient, dept_factory, program_factory, student_factory, admin_headers
):
    dept = await dept_factory()
    program = await program_factory(dept["id"])
    student = await student_factory(dept["id"], program["id"])
    assert student["phone"] is not None

    r = await client.put(
        f"/students/{student['id']}", json={"phone": None}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["phone"] is None


@pytest.mark.asyncio
async def test_a_minimal_student_still_appears_in_the_class_roster(
    client: httpx.AsyncClient, dept_factory, program_factory, admin_headers
):
    """The point of keeping program + semester required: attendance still works."""
    dept = await dept_factory()
    program = await program_factory(dept["id"])
    r = await client.post(
        "/students",
        json={
            "rollNumber": "ROSTER1",
            "name": "Roster Student",
            "departmentId": dept["id"],
            "programId": program["id"],
            "currentSemester": 1,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text

    listed = await client.get(
        "/students",
        params={"programId": program["id"], "semester": 1, "status": "active"},
        headers=admin_headers,
    )
    assert listed.status_code == 200, listed.text
    assert any(s["rollNumber"] == "ROSTER1" for s in listed.json()["items"])
