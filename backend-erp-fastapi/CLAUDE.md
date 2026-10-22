# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# SCAS ERP — FastAPI Backend

The real backend for the SCAS ERP monorepo (see the root `CLAUDE.md` and the sibling
`frontend-erp-react/`). It is the **source of truth**, implementing the business rules that the
frontend currently keeps in `lib/store.tsx`. The design spec is
`../frontend-erp-react/FASTAPI-BACKEND-PLAN.md`; the frontend `lib/types.ts` / `lib/store.tsx` /
`lib/permissions.ts` / `lib/data.ts` are mirrored **1:1** (same fields, same rules, same seed ids).

Status: **fully implemented** — all 14 entities, JWT auth, the permission matrix, every endpoint
in the plan's map, and a production seed of the real college. Verified end-to-end (auth, cascades,
single-HOD, attendance correction/audit/lock, scope 403s, uniqueness, materials).

## Commands

```powershell
# Deps (venv has no pip; use uv, or pip once bootstrapped)
uv pip install --python attadance_system\Scripts\python.exe -r requirements.txt
attadance_system\Scripts\Activate.ps1

# DB is local Postgres `erp_scas` (see .env). Apply schema, then seed:
python -m alembic upgrade head
python seed_production.py  # real college structure into an EMPTY db (refuses otherwise)
python reset_db.py         # dev only: wipe everything, leave one admin account

# Run the API
python -m uvicorn main:app --reload --port 8000   # docs at http://localhost:8000/docs
```

- **Config** comes from `.env` via `config.py` (`Settings`): `DATABASE_URL` (asyncpg),
  `JWT_SECRET`, `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`. `.env` is gitignored; see
  `.env.example`.
- **Migrations:** `alembic/env.py` reads the **sync** URL from `config.settings.sync_database_url`
  (psycopg2); the app runtime uses **async** (asyncpg). Autogenerate: `python -m alembic revision
  --autogenerate -m "msg"`.
- **Windows:** run Python in **PowerShell**, not Git Bash. When running scripts by absolute path,
  set `PYTHONPATH` to the backend dir so top-level packages import.
- **Tests:** `python -m pytest` (153 tests). `tests/` uses pytest + testcontainers — a throwaway
  `postgres:16` per session, migrated with `alembic upgrade head`, truncated between tests. Docker
  must be running. Factories in `conftest.py` arrange scenarios through the real HTTP API.

## Architecture (layered, async)

Request flow: **router → service → model**, with schemas at the boundary.

- `config.py` — pydantic-settings. `database/connection.py` — async engine + `get_db()` dependency.
- `security.py` — bcrypt hashing + JWT (`create_access_token` / `decode_token`).
- `permissions.py` — the role → `Capabilities` matrix, ported from `lib/permissions.ts`.
- `deps.py` — `get_current_user` (Bearer JWT), `require_capability(flag)`, `ensure_can_mark`,
  `own_course_ids`, `current_term_id`.
- `enums/` — `str` enums whose **values are the frontend literals** (e.g. `"Associate Professor"`,
  `"attendance-manager"`). Stored via `models.base.str_enum` (plain VARCHAR, `native_enum=False`, **no** DB CHECK — values
  are validated by SQLAlchemy and Pydantic, which is what lets a new value ship without a migration).
- `models/` — SQLAlchemy 2.0, **string PKs** matching the frontend ids (`dept-cs`, `tch-1`). One
  class per file; register every model in `models/__init__.py` (Alembic autogenerate reads
  `Base.metadata`). `AppSettings` is a singleton row holding `current_term_id` + `lock_date`.
- `schemas/` — Pydantic v2. All inherit `schemas.base.CamelModel`: **snake_case in Python,
  camelCase in JSON** (`alias_generator=to_camel`, `from_attributes=True`). Audit `from`/`to` use
  `serialization_alias`. Per entity: `*Base` / `*Create` / `*Update` / `*Response`
  (+ `*DetailResponse` that nests).
- `services/` — the business logic. Cascades ride DB `ondelete` (dept → programs → semesters →
  courses → assignments → attendance → materials); teachers/students **orphan** (FK `SET NULL`, so
  their `departmentId`/`programId` may be null in responses). `services/attendance.py` is the heart
  — upsert on `(course_id, date, period)`, correction diffing (`original_status` set on first
  change only), audit stamping, and the lock guard (`is_locked_for`: `date <= lock_date` unless the
  role has `override_lock`). `services/audit.py::make_audit` mirrors the store's `auditedBy`.
  **Every branch of `save_attendance`'s re-save audits** — see below.
- `routers/` — one per entity group, wired in `main.py` (CORS allows the frontend origin). Query
  params use camelCase aliases (`?departmentId=`, `?termId=`).

## Conventions when extending

1. New entity: add `enums/` value set (if any) → `models/<Entity>.py` (string PK, register in
   `models/__init__.py`) → `alembic revision --autogenerate` + `upgrade head` → `schemas/<Entity>.py`
   (extend `CamelModel`) → `services/<entity>.py` → `routers/<entity>.py` (include in `main.py`).
2. Enforce every invariant **server-side in the service**, not the router. Guard endpoints with
   `require_capability(...)` / `ensure_can_mark(...)` from `deps.py`; scope violations → 403,
   duplicates → 409, missing → 404.
3. Ids for API-created rows come from `ids.new_id(prefix)`; the seed uses fixed frontend ids.
4. Keep responses camelCase (inherit `CamelModel`) so the frontend wires up unchanged later.
5. **Study materials store no files.** `study_material` holds a `url` (absolute `http(s)`,
   validated by `services/materials.py::normalise_url`) — the `data`/`file_name`/`file_type`/
   `file_size` columns were dropped in `alembic/versions/c3d5e81a4f27_materials_are_links.py`,
   along with `GET /materials/{id}/download`. `POST /materials` takes a JSON `MaterialCreate`,
   not multipart. Don't reintroduce file upload without a decision to store blobs again.

## Account management & the admin-escalation guard

`manage_users` is held by **admin and principal**. That grant is deliberately
*partial*: `services/users.py::assert_may_manage` rejects (403) any write by a
non-admin that touches an `admin` account — creating one, promoting anyone into
the role, demoting an existing admin, or deleting one. Without it, giving
principals account management would hand back the correction/oversight powers
(`edit_attendance`, `override_lock`, `view_audit`, `lock_attendance`) that the
capability matrix deliberately withholds from them: mint an admin, log in as it.
`create_user`/`update_user`/`delete_user` all take the acting `User` for this
reason. The frontend mirrors the rule in `lib/permissions.ts::canManageRole` so
the UI doesn't offer a request the API will refuse. Tests:
`tests/test_account_management.py`.

A second guard sits beside it: **`assert_not_self_demotion` refuses any change
to your own role** (400). `delete_user` always refused self-deletion, but
`update_user` didn't, so one `PUT /users/<own id> {"role": "teacher"}` stripped
the caller's capabilities mid-request. For the *last* admin that is a one-way
door — `assert_may_manage` correctly stops a principal from minting a
replacement, so no account left in the system could create one and recovery
meant hand-editing the database. Handing the role over still works; the *other*
admin performs the demotion, which keeps at least one admin at every point.
Tests: `tests/test_admin_lockout.py`.

**`POST /auth/change-password`** is self-service for the signed-in account
(current + new password, `min_length=8`, rate-limited 5/min). Every role may use
it **except `student-rep`** (403): those are one shared login per class, so one
student rotating it would lock out the rest — admins/principals reset them via
`PUT /users/{id}` instead.

**Accounts disable rather than delete, and access can actually be revoked.**
`User.is_active` (default true) soft-disables a login: `get_current_user` rejects
an inactive account (401) and `/auth/login` refuses it (indistinguishable from a
bad password), so a departing/suspended member loses access while their
audit-actor links survive. `update_user` refuses to disable *your own* account
(the self-lockout guard beside `assert_not_self_demotion`). Because a JWT is
stateless and valid up to 12h, disabling — and password changes — would
otherwise leave outstanding tokens working; `User.token_epoch` closes that. Every
JWT carries the epoch it was minted at (`security.create_access_token`), and
`get_current_user` rejects any token whose epoch is behind the account's current
value. The epoch is bumped on disable and on any password change
(`change_password` and an admin reset via `update_user`); `change_password`
returns a fresh token so the current device stays signed in while every other
session is cut off. Tests: `test_account_lifecycle.py`.

## Student intake: only identity + class placement are required

`rollNumber`, `name`, `departmentId`, `programId` and `currentSemester` are
mandatory. Everything else (email, phone, address, DOB, gender, admission year,
all three guardian fields) is **nullable** — see
`alembic/versions/d4e6f92b1a83_student_optional_fields.py`. Program and semester
stay required on purpose: they decide which class roster a student appears in,
so a student without them would exist but be invisible to every attendance
register. `schemas/Student.py::BlankToNull` normalises `""` → `None` (an
untouched HTML input submits an empty string, not null, and `""` would
otherwise fail `EmailStr` validation outright).

## Teacher intake: only identity + department are required

The same shape as student intake. `employeeId`, `name` and `departmentId` are
mandatory; `email`, `phone`, `qualification` and `joiningDate` are **nullable**
— see `alembic/versions/e5a7c14d9b62_*.py`. Two deliberate asymmetries:

- **`email` is UNIQUE but nullable.** Postgres allows any number of NULLs under
  a unique index, so arbitrarily many teachers can exist with no email on file
  without colliding.
- **`designation` stays NOT NULL** and defaults to `Assistant Professor` in
  `schemas/Teacher.py` instead, so a caller still never has to supply it.

`departmentId` is required at the API layer while the *column* stays nullable —
that nullability exists so deleting a department orphans its teachers
(`ON DELETE SET NULL`) rather than deleting them, which is why `TeacherResponse`
alone re-declares it optional.

The blank-string normalisation matters more here than anywhere: the real staff
list carried no phone numbers, so the seed wrote `""` into a NOT NULL column
while `TeacherResponse.phone` demanded `min_length=1` — `GET /teachers` returned
500 for every caller and the teachers page rendered empty. Regression coverage:
`tests/test_teacher_optional_fields.py`.

## Every re-save mutation is audited (not just corrections)

Re-posting `POST /attendance` for an existing `(course, date, period)` is the
correction path, and the status-change branch was always audited. Three
neighbouring branches were not, and each let someone change what a register says
with nothing in the log:

- **Dropping a student from the payload** deleted the record — status,
  `original_status` provenance and row. Strictly *better* cover than a
  correction, because `correction_red_flags` compares `original_status` against
  `status` on rows that still exist; a deleted row is invisible to it. Now emits
  an `AuditActionEnum.REMOVE_RECORD` ("remove-record") entry carrying
  `from_status = original_status or status` — the value **as originally marked**,
  so correcting-then-removing can't launder it.
- **Adding a student to a saved session** wrote an unstamped record,
  indistinguishable from an original mark. Now stamped (`edited_by`/`edited_at`)
  and logged as an EDIT with `from_status = None`.
- **Sending a different `termId`** silently moved the session out of the term
  whose summary reports it — an erasure with nothing deleted. Now **409**; a
  session's term follows from its date, and re-saving is not how you change it.

`remove-record` is a new `AuditActionEnum` value. It needed **no migration**:
`str_enum` is `native_enum=False` with `create_constraint` defaulting off, so
the column is a bare VARCHAR with no CHECK. (It was `VARCHAR(14)`, sized to the
longest value at creation; migration `a9c3e7f25d10` widened it to 32 for the
administrative actions below, and the model pins `length=32`, so any new value
up to 32 chars still needs no migration.) Mirrored in `lib/types.ts` (`AUDIT_ACTIONS`, `AUDIT_ACTION_LABELS`) and
the log page's `ACTION_BADGE`, all of which are exhaustive `Record<AuditAction,…>`
maps, so TypeScript flags the ones you forget. Tests:
`tests/test_attendance_record_integrity.py`.

## Administrative changes are audited too

The log used to cover attendance only — an account could be created, promoted
to admin, have its password reset and be deleted with no trace. Every
administrative write now adds one `AuditEntry` **in the same transaction**
(`db.add(make_audit(...))` before the commit), so a refused write leaves no
entry and an accepted one can't lose it:

| area | actions |
|---|---|
| accounts (`services/users.py`) | `create-user`, `update-user` (incl. admin password reset, role change, disable), `delete-user`, `change-password` (self-service) |
| students | `create-student`, `update-student` (incl. activate/deactivate), `delete-student`, `promote-students`, `graduate-students` (one entry per batch, with per-class counts) |
| teachers | `create-teacher`, `update-teacher` (incl. HOD changes), `delete-teacher` |
| curriculum | `create/update/delete-department`, `create/update/delete-program`, `create/delete-semester`, `create/delete-course` |
| staffing & terms | `assign-course` / `unassign-course` (carry `courseId` + `termId`), `create-term`, `set-current-term` |

Rules: the entity is named in `note` with its id (a deleted row can't be
resolved later, so the note is the only record left); `student_id`/`course_id`
are filled where the entity is one. **Updates list *which* fields changed,
never their values** — `services/audit.py::changed_fields` — because a student
update can carry an address or a guardian's phone and the log is kept forever;
passwords never appear. No-op updates write nothing. Except assignments, these
entries have no `termId`, so the term-filtered log shows them in every term.
Services take the acting `User` for this; routers pass it. Oversight's
correction counts (`CORRECTION_ACTIONS`) are unaffected. Tests:
`tests/test_admin_audit.py`.

**The attendance-manager holds `lock_attendance`** (not `view_audit`): it runs
the registers, so it may freeze them, but the red flags and the log watch the
people who correct attendance — itself included. `GET /audit/lock-history`
takes `require_capability("view_audit", "lock_attendance")` (any-of) so the
freeze card can show its timeline; `/audit` and `/attendance/red-flags` stay
`view_audit`-only.

## Read scoping is server-side (`services/scope.py`)

`view_scope` in `permissions.py` says how much of the college an account may
**read** — separate from `mark_scope` (who may write attendance) and
`material_scope`, because the three genuinely differ: an attendance-manager
writes everywhere, a student-rep writes nowhere and still has to read something.

| role | `view_scope` | reach |
|---|---|---|
| admin, principal, attendance-manager | `all` | the college |
| hod | `department` | own department + anything they personally teach |
| teacher | `own` | courses assigned to them **this term** |
| student-rep | `class` | the one `(program, semester)` the login is pinned to |

`services/scope.py` turns that into two shapes — `visible_course_ids` (attendance
lives on courses) and `visible_class_keys` (students live in a class) — where
**`None` means unrestricted** and an empty set means nothing. Endpoints either
`assert_course_visible` / `assert_student_visible` (403) or take the set as a
ceiling on the query (`allowed_course_ids`, `apply_student_scope`).

Two things to keep right when adding a read endpoint:

1. **The scope bounds the request filter; it never replaces it.** `course_ids`
   is what the *caller* asked for, `allowed_course_ids` is the ceiling. Applying
   only one of them means a narrower filter can widen the scope.
2. **An empty scope must produce `false()`, not `in_(set())`.** The second reads
   as "no constraint" if written by hand and returns everything — the precise
   failure this module exists to prevent.

This was client-side only until an audit found it: every attendance and student
read took the caller's `courseId` at face value, so a class-rep login — one
password shared by a whole class — could pull any other class's register, any
roster (addresses, dates of birth, guardian phone numbers) and the college-wide
summary. `lib/permissions.ts` still drives the UI; it is no longer the guard.
Tests: `tests/test_read_scoping.py`.

Personal fields are additionally gated by a **`view_student_pii`** capability
(admin/principal/hod), separate from `view_scope`. Readers without it — teacher,
attendance-manager, student-rep — get the roster (roll + name + placement +
lifecycle flags) with `email`/`phone`/`address`/`dateOfBirth`/`guardian*` nulled
by `schemas/Student.py::redact_student`, applied at every Student serialization
boundary (`/students`, `/students/{id}`, `/attendance/roster`,
`/attendance/class-roster`). The response model is unchanged (those fields are
already `Optional`), so a redacted record looks like one the registrar hasn't
filled in. Mirrored in `lib/permissions.ts` (`viewStudentPii`). Tests:
`test_read_scoping.py` (the PII assertions).

## Class-rep logins are retired when their class moves on

A `student-rep` User is pinned to `(program_id, class_semester)`, and that pair
is the **entire** scope of what the rep can see — now enforced by
`services/scope.py` (above), not just asserted here. `POST /students/promote` used
to move the cohort and leave the account behind — which goes quiet at first and
then, once the next intake enrols into that semester, starts showing the
outgoing rep the **new juniors' attendance**.

`services/students.py::_delete_rep_accounts` now **deletes** the login of every
class that vacates its semester, on both promote and graduate. The admin then
creates a fresh account for the class's new semester. Deleting rather than
renumbering was a deliberate choice: it keeps the invariant trivial (a rep
account always describes a class actually sitting in that semester), it needs
no ordering dance to satisfy one-rep-per-class, and the shared password rotates
every term as a side effect — worth having for a login a whole class knows.

Two rules are load-bearing:

1. **The class must move in whole.** `_fully_vacated` compares the batch
   against the roster. Promoting 3 of 40 students is not the class moving, and
   the login stays. Only *active, ungraduated* students count, so a dropped-out
   student left behind in sem 1 doesn't block retirement forever.
2. **The check must run *before* the semester numbers change.** Asking "is the
   semester empty now?" afterwards gives the wrong answer for a normal
   end-of-year roll: promoting sems 1-3 together immediately refills sem 2 with
   sem 1's class, so nothing below the top year would ever look empty. (This
   was caught by `test_a_whole_cohort_retires_every_rep_it_vacates`, not by
   inspection.)

Both endpoints report `repsRemoved` so the UI can prompt for the follow-up
create. Tests: `tests/test_rep_account_rollover.py`.

## Seeding & credentials (the demo seeds are gone)

`seed.py` / `seed_large.py` (deterministic demo data, well-known passwords) were
**deleted** — the app now runs on real college data. Two scripts remain:

- **`seed_production.py`** — installs the real structure (13 departments,
  19 programs + semesters, 43 teachers with the 12 real HODs, term
  `2026-2027 (Odd)` set current) and creates login accounts for every teacher /
  HOD plus one class-rep account per class running the odd term. **Additive and
  production-safe**: never deletes, refuses to run unless the curriculum tables
  are empty, creates an admin only if none exists (`ADMIN_PASSWORD` env or
  random) and likewise a **`principal`** account (`principal@scascollege.ac.in`,
  `PRINCIPAL_PASSWORD` env or random) only when the database has no principal.
  The principal is seeded with **no `teacher_id`**: linking one is what marks a
  principal who also takes classes, and whether this one does is a per-college
  fact the office confirms — the admin adds the link in `/users` afterwards.
  All generated passwords go to `seed_credentials.csv` (gitignored;
  path overridable via `CREDENTIALS_FILE`) — distribute, then delete the file.
  In the Compose stack this runs as the one-shot `seed` service
  (`docker compose run --rm seed`, see `DEPLOY.md`).
  **Students come from `students.csv`** next to the script (`STUDENTS_FILE`
  overrides) — 583 real second/third-years, generated from the college's
  attendance spreadsheets by `../tools/build_students_csv.py`. A missing file is
  *not* an error: the seed prints a line and carries on, which is the fresh-clone
  path since the CSV is gitignored. Still no courses or attendance — the
  spreadsheets are class-level registers with no subject data.
- **`../tools/build_students_csv.py`** — converts `II/III YEAR ATTENDANCE
  SHEET.xlsx` into that CSV, in the **same 15-column schema the frontend's
  bulk-upload dialog already accepts** (`departmentCode`/`programCode`, not ids),
  so one artifact serves both the seed and the Students page. It reads .xlsx with
  **stdlib `zipfile` + `ElementTree`** — deliberately no openpyxl/pandas, which
  would otherwise land in `requirements.txt` and the production image for a
  one-off conversion. Two details are load-bearing: sheet names map to programs
  by **exact match** (prefix matching files all 64 `B.SC PHY.EDU` students under
  `B.SC PHY`, and totals survive the swap so nothing looks wrong), and it writes
  **plain utf-8, not utf-8-sig** (`lib/export.ts::parseCsv` does no BOM
  stripping, so a BOM makes the dialog reject a valid file).
- **`reset_db.py`** — dev-only counterpart (guarded by
  `config.assert_not_production()`): wipes every table, leaves a single admin.

Two things the roster deliberately does **not** contain. Five students (4 in II
YEAR `B.LIT`, 1 in III YEAR `B.COM CA`) have a name but no register number in the
source sheets; `roll_number` is required and unique, so they go to
`students-rejected.csv` for the office to chase. And the whole 2026 intake — 339
UG + 59 PG in `SASC ADMISSION LIST.xlsx` — is **not loaded at all**, because that
file has no register-number column and a roll number is immutable once created.
When the college issues them, add a source entry to the converter; the messy
branch spellings there (`BLIT TAMIL`, `B.SC(FT)`, `M,COM`) need a normalising map.

Note the semester mapping (II YEAR → 3, III YEAR → 5) is tied to term
`2026-2027 (Odd)`. Re-seeding for a later term without regenerating the CSV
leaves every student a year behind.

Data notes baked into the script: Commerce and Commerce (C.A.) are **separate
departments** (Domani and Aparna each head their own, as the faculty list has
it); English arrived with no HOD; the site's Ph.D. Mathematics is deliberately
not seeded (research scholars don't run through class rosters/attendance).

## Frontend integration (done)

The React frontend is now wired to this API (TanStack Query; see the sibling
`frontend-erp-react/CLAUDE.md`). Three small read endpoints were added to make that possible:
- **`GET /settings`** → `{ currentTermId, lockDate }` (the frontend has no other way to *read* the
  current term; every page is term-scoped).
- **`GET /courses`** → flat list of every course with `semesterId` / `semesterNumber` / `programId`
  resolved — the frontend's global course lookup for roles that show course names but lack
  `manage_academics`.
- **`GET /users/directory`** → `[{ id, name }]`, any authenticated user — id→name resolution for
  marked-by / editor / audit-actor names (the full `GET /users` stays admin-only).

`GET /semesters` was also relaxed from `manage_academics` to any authenticated user (teachers /
reps / attendance-managers need to read the curriculum).

## Performance architecture

The API is built for full-college scale — it was validated against a synthetic large dataset
(4.8k students, 202k attendance sessions, **4M attendance records**, 224k audit entries; the
generator script has since been removed along with the demo seeds). Four rules hold it up:

1. **Every list endpoint is paginated.** `services/pagination.py` provides `page_params` (a
   `?page=&pageSize=` dependency, max 200) and `paginate()`; `schemas/Page.py` is the envelope
   (`{items, total, page, pageSize, totalPages}`). Paginated: `/students`, `/teachers`, `/audit`,
   `/materials`, `/attendance`, `/users` (`?search=` over name+email, `?role=`; no trigram index
   there — the account table is bounded by staff plus one rep per class, so the substring scan is
   cheap. `/users/directory` stays unpaged: it is id→name only and every page resolves names
   through it). **Search, filter and sort run in SQL, never on the client** —
   `?search=` is a trigram-indexed substring match, `?sortBy=` is whitelisted against a `SORTABLE`
   map so a client string can never reach the ORDER BY.
2. **Aggregates are computed in the database** (`services/analytics.py`). The attendance maths lives
   in one place (`_TALLY`) mirroring `lib/attendance.ts`: `held = status != "od"`,
   `attended = status in (present, late)`, plus the same tally over
   `COALESCE(original_status, status)` for the "as marked" comparison that makes tampering visible.
   Endpoints: `GET /attendance/summary` (per-student %, paginated, with whole-set `totals`),
   `/attendance/summary/breakdown` (per-course, one student), `/attendance/red-flags`,
   `/stats/dashboard`, `/stats/unstaffed-courses`, `/stats/shortfall-count`.
   Percentage *comparisons* stay integer-safe (`attended * 100 < min_pct * held`); the displayed
   percentage is rounded in Python because Postgres has no `round(double precision, int)`.
   **`_pct` rounds to 2dp and `lib/attendance.ts::pct` must match it exactly** — the same student's
   figure is computed here for `/attendance/summary` and on the client for the register and student
   detail. The client used to round to a whole number, so 74.6% displayed as "75%" in passing colour
   on the profile while the summary called the same student a defaulter. Rounding differences only
   show at the threshold, which is the only place anyone looks.
   Anything time-windowed reads **`AuditEntry.at`** (when the edit was made), never `AuditEntry.date`
   (which day's register it touched). `/stats/dashboard`'s `correctionsThisWeek` filtered on the
   latter and so reported nothing for the case the card exists to surface: a correction made today
   to a register from months ago. The two columns agree in the common case and diverge in exactly
   the suspicious one.
3. **Nothing is over-fetched.** Study materials are links, so there is no blob to defer or
   stream — a material row is small metadata plus a URL. The
   `Department.programs` / `Program.semesters` / `Semester.courses` relationships are
   **`lazy="raise"`**, so listing departments can't silently drag the whole curriculum behind it;
   the detail endpoints ask for what they need with `selectinload`. Deletes still cascade — the FKs
   are `ON DELETE CASCADE` and `passive_deletes=True` leaves that to the database.
4. **Indexes back every hot path** (`alembic/versions/b1f7a3c92e04_performance_indexes.py`,
   hand-written because expression/partial/GIN indexes don't round-trip through autogenerate).
   Composite indexes lead with the filter column and carry the sort (`audit_entry (term_id, at DESC)`,
   `attendance_session (term_id, date, period)`); `pg_trgm` GIN indexes on `lower(name)` /
   `lower(roll_number)` serve `ILIKE '%q%'`, which btree cannot; partial indexes cover the
   selective cases (roster = enrolled students only, corrected records only).

**Caching** (`services/cache.py`) is a deliberately narrow TTL cache over the small, hot,
near-static reads: `/settings` (read on every page), `/terms`, `/courses`, `/users/directory`,
`own_course_ids` per (teacher, term) and `dept_course_ids` per department (HOD scope). It is
**single-flight** — concurrent misses run the loader once — and driven by **explicit
invalidation**, not by the TTL: `set_lock_date` invalidates `SETTINGS` so the lock guard can never
authorise a write against a stale lock, curriculum edits call `invalidate_curriculum()` (which also
drops `ASSIGNMENTS` and `DEPT_COURSES`, because curriculum deletes cascade through
`course_assignment`), assignment writes and teacher deletes drop `ASSIGNMENTS`. Attendance,
students and audit are never cached. In-memory without `REDIS_URL`, Redis with it (section below).
Three rules every call site relies on:

1. **Cached values are plain JSON** (dicts/lists/scalars) — loaders convert ORM/Pydantic objects
   first, and Redis round-trips through `json`, never `pickle`. Callers wanting a set build a fresh
   one (`set(await cached(...))`). This is load-bearing: the in-memory backend once handed out its
   stored set, `visible_course_ids` unioned the department into it with `|=`, and every HOD gained
   mark/upload rights on their whole department after any read (`test_scope_regressions.py`).
2. **`await invalidate(...)`** — invalidation is async and awaited (it was fire-and-forget on
   Redis, so the delete landed after the response).
3. A load that started before an invalidation **doesn't write its result back** (generation counter
   per backend), so a slow read racing a write can't re-cache the stale value for a TTL.

`main.py` adds **GZip** (min 500 bytes) and an **ETag middleware** that hashes JSON GET bodies and
answers repeat requests with `304` (`/courses` drops from ~98 KB to 0 bytes). The ETag middleware is
registered *first* so it sits inside GZip and hashes the raw JSON; it reads `body_iterator` **or**
`body`, because error responses are plain `Response` objects and reading the wrong one breaks the
ASGI protocol instead of surfacing the error. CORS exposes `ETag` (it is not a safelisted header).

## Production / scaling architecture (500-concurrent-user pass)

A second pass beyond the query-level performance work above, aimed at real
deployment and horizontal scale:

1. **No blocking calls in async routes.** `bcrypt.hashpw`/`checkpw` are
   CPU-bound; both call sites (`routers/auth.py`'s login, `services/users.py`'s
   create/update) go through `starlette.concurrency.run_in_threadpool` so a
   login burst can't stall the whole event loop.
2. **Structured logging + global exception handling.** `logging_config.py`
   sets up JSON-to-stdout logging (`python-json-logger`) for the request path
   and for uvicorn/gunicorn's own loggers; `main.py` registers
   `@app.exception_handler(HTTPException)` and `@app.exception_handler(Exception)`
   so every response has a uniform `{"detail": ...}` body and every 500 is
   logged with a stack trace. A request-logging middleware (registered last,
   so it wraps everything else) logs method/path/status/duration/user id per
   request — `deps.py::get_current_user` stashes `request.state.user_id` for it.
   `SENTRY_DSN` (empty by default) turns on `sentry-sdk[fastapi]` when set.
3. **Fail-fast config.** `config.py::assert_production_ready` (called at
   import time in `main.py`) refuses to boot when `ENVIRONMENT=production`
   and `JWT_SECRET` is still unset/the dev default — dev/seed workflows are
   unaffected since this only triggers in production.
4. **Rate limiting.** `rate_limit.py`'s `slowapi` `Limiter` guards
   `/auth/login` (10/minute). Storage is Redis-backed when `REDIS_URL` is set,
   in-memory otherwise (only correct for one worker — see below). The key
   function is `get_ipaddr` (X-Forwarded-For-aware), not `get_remote_address`
   (which reads `request.client.host` directly) — required because the
   Compose deploy puts Caddy in front of `api`, so `request.client.host` would
   otherwise always be Caddy's own container IP. This is safe only because
   `api` is never published to the host (see `docker-compose.yml`) — nothing
   but Caddy can reach it to forge the header.
5. **CORS narrowed.** `allow_methods`/`allow_headers` list the app's actual
   verbs/headers instead of `["*"]`; `allow_origins` was already
   config-driven. Security headers (HSTS/CSP/X-Frame-Options) are set at the
   reverse proxy (`Caddyfile`), not here — that's static per-deployment
   policy, not request logic.
6. **`services/cache.py` is now dual-backend, same public interface either
   way** (`cached()`/`invalidate()`/`invalidate_curriculum()`/`invalidate_all()`).
   No `REDIS_URL` → the original single-process in-memory `TTLCache`
   (unchanged behavior, zero new moving parts for local dev). `REDIS_URL` set
   → `services/redis_client.py`'s async client backs it; invalidation becomes
   a Redis `SCAN`+`DEL` under a `cache:` namespace (kept separate from
   slowapi's own keys in the same Redis instance), single-flight is
   best-effort (`SET NX` lock, not a distributed queue — a small
   thundering-herd window on a cold key is an accepted trade-off given every
   cached value here is cheap to recompute). This is what makes cache
   invalidation correct once there's more than one worker/replica: a write on
   one worker actually invalidates what every other worker reads.
7. **Multi-worker via gunicorn**, not bare `uvicorn --workers`: gunicorn's
   master process supervises workers (auto-restart on crash), which
   bare-uvicorn multi-worker mode doesn't do. `Dockerfile`'s `CMD` runs
   `gunicorn -k uvicorn.workers.UvicornWorker -w ${WEB_CONCURRENCY:-2} -b
   0.0.0.0:8000 main:app` — **gunicorn only works on Linux** (uses `fcntl`),
   so it only ever runs inside the container, never on a Windows dev host.
8. **DB pool re-tuned per-worker.** `db_pool_size=8`/`db_max_overflow=4`
   (was 20/20, sized for one worker) — at `WEB_CONCURRENCY=2` (the 1 GB VPS
   default; each worker is ~90 MB) that's 24 max connections from `api`;
   `docker-compose.yml` sets Postgres' `max_connections=40` to match, and caps
   every container with `mem_limit`. Change one, re-check the other.
9. **Containerized**: `Dockerfile` (this dir) + `frontend-erp-react/Dockerfile`
   + repo-root `docker-compose.yml`/`Caddyfile`/`DEPLOY.md`. Migrations run as
   an explicit one-shot `docker compose run --rm migrate` deploy step, never
   baked into `api`'s own startup — baking it in would race multiple `api`
   replicas running `alembic upgrade head` concurrently. See the standing
   convention at the top of `alembic/env.py`: any future migration adding an
   index to `attendance_record` (4M rows) should use `CREATE INDEX
   CONCURRENTLY` via `op.get_context().autocommit_block()`, not a plain
   `CREATE INDEX`, to avoid locking writes for the full build duration.
10. **Load validation**: `../k6/` has scripts against the four documented hot
    paths (`/auth/login`, `/students` search, `/attendance/summary`, attendance
    marking) with a concrete pass bar (p95 <500ms reads / <800ms writes, error
    rate <0.1%) — see `../k6/README.md`.

## Integrity at the boundary (constraint errors, cascades, validation)

Rules added by the code-quality pass; follow them when writing a new endpoint.

- **Commit through `services/util.py::commit_or_raise(db, _CONFLICTS)`**, never a bare
  `db.commit()` on a write that can hit a constraint. It maps the constraint Postgres actually
  rejected — by *name*, from each service's `_CONFLICTS` dict — to the API contract: unique → 409,
  FK / NOT NULL / CHECK → 422, all with a human message. A service-level check-then-insert is a
  courtesy 409; the database constraint is the guard (two concurrent first saves of a class hour,
  two rep accounts for one class). Never map "any IntegrityError" to one message — that is how a
  bad `departmentId` came back as "Roll number already exists".
- **One student-rep per class is a partial UNIQUE index** (`uq_user_rep_class`, migration
  `a7d2c4e9f1b3`), not just `_assert_rep_class_free`. Term FKs are `ON DELETE RESTRICT`.
- **Deletes that cascade into `attendance_record`** (student, course, semester, program,
  department) call `services/audit.py::guard_attendance_cascade` first: refused (403) for a role
  without `override_lock` when any affected date is locked, and otherwise logged as one
  `remove-record` / `delete-session` entry naming what went. A cascade used to erase records and
  their `original_status` trail with nothing in the log — stronger cover than any correction.
  Oversight counts `edit`, `remove-record` and `delete-session` together (`CORRECTION_ACTIONS`).
- **Permission checks live in the service.** `save_attendance` decides mark-vs-edit itself
  (the router used to, via the private `_find_session`), and locks the session row
  (`FOR UPDATE`) so two concurrent corrections can't both diff against the same "before".
- **Validation at the schema**: `schemas/base.py::IsoDate` is a real calendar date (not just the
  regex); `UpdateModel.NOT_NULL` turns an explicit `null` for a NOT NULL column into a 422;
  passwords are ≥ 8 everywhere; attendance payloads reject duplicate students; no future
  attendance dates (`today_local()` — the college's zone, `COLLEGE_TIMEZONE`, not the UTC
  container clock); promotion stops at the program's final semester; a student's program must
  belong to their department; LIKE wildcards in `?search=` are escaped.
- **Aggregates are scoped like reads**: `/stats/*` goes through
  `scope.aggregate_department_scope` (college / HOD department / 403 for teacher and rep), and
  `/attendance/summary/breakdown` is bounded by `visible_course_ids`, not just student visibility.
  Unfiltered `/attendance/summary` and `/assignments` default to the current term.
- **HTTP plumbing is pure ASGI** (`middleware.py`): ETag/304, request logging and a
  `ServerErrorsMiddleware` that sits *inside* CORS, so a 500 still carries CORS headers (it used
  to surface in the browser as a CORS error). Connections carry `statement_timeout`,
  `lock_timeout` and `idle_in_transaction_session_timeout` (`config.py`); the engine is disposed
  on shutdown.

## Tests

`tests/` (pytest + testcontainers, 153 tests) covers auth, cascades, single-HOD,
attendance correction/audit/lock, uniqueness, account management + the
admin-escalation guard, and student *and* teacher optional-field intake.
`test_scope_regressions.py` (write scope after a read, `/stats` and breakdown
scoping, malformed attendance writes) and `test_integrity_and_http.py`
(concurrent rep creates, null/bad-FK writes → 4xx, audited cascade deletes, the
audit term filter, ETag/304, `WWW-Authenticate`, CORS on a 500) came out of the
code-quality pass described under "Integrity at the boundary" below.

Four files came out of an end-to-end audit for *silent* bugs — wrong answers and
missing guards rather than errors — and each pins behaviour that failed quietly
before it existed. They are written from the caller's side (log in as the narrow
role, then ask for something out of reach) because the happy path passed
throughout:

- `test_read_scoping.py` — every read endpoint honours `view_scope`.
- `test_attendance_record_integrity.py` — the three unaudited mutations.
- `test_admin_lockout.py` — no account can strip its own role.
- `test_corrections_window.py` — "this week" means when the edit was made.

One fixture gotcha worth knowing: `conftest.py`'s `_unique` counter is shared by
every factory, so it grows with the size of the whole suite. Anything deriving a
*bounded* value from it will eventually break as tests are added — `term_factory`
did exactly that (`startYear = 2000 + next(_unique)` blew past the schema's 2100
ceiling once the suite passed ~100 factory calls) and now uses its own wrapped
counter, `_term_years`. Don't derive a range-constrained value from `_unique`.
