# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**SCAS ERP** — a management system for a college (arts & science): Departments, Programs,
Students, Teachers, plus a tamper-evident **Attendance** workflow and a **Study Materials**
module, all gated by role-based login. It is a **monorepo of two subprojects** that model the
same domain:

| Subproject | Stack | Role | Has its own guide |
|---|---|---|---|
| `frontend-erp-react/` | Next.js 16 (App Router) + React 19 + TS + Tailwind v4 + shadcn/Base UI + TanStack Query | **Wired to the backend** — per-domain React Query hooks (`lib/queries/`) over a JWT fetch client (`lib/api.ts`); requires the API running. The old `localStorage` store is gone. | ✅ `frontend-erp-react/CLAUDE.md` (detailed) + `AGENTS.md` |
| `backend-erp-fastapi/` | FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL + Alembic | **Real backend, implemented** — mirrors the frontend rules 1:1 (JWT auth, all entities/endpoints, a production seed of the real college). The source of truth. | ✅ `backend-erp-fastapi/CLAUDE.md` |

**Read the subproject's own CLAUDE.md before working in it** — this root file is only the map.

## How the two fit together

The backend **owns the data and enforces every rule server-side** (cascades, single-HOD, attendance
correction/audit/lock, uniqueness) — string ids matching the frontend, camelCase JSON, and a
production seed (`seed_production.py`) that installs the real college structure **and its 583 real
students**, read from a gitignored `students.csv` that `tools/build_students_csv.py` generates from
the college's attendance spreadsheets. That CSV is also directly loadable through the Students
page's bulk-upload dialog — one schema, two ways in. The demo seeds
(`seed.py`/`seed_large.py`) were **deleted**. The frontend now **consumes that API**: its
old `localStorage` store (`lib/store.tsx`) is deleted; each domain has React Query hooks in
`lib/queries/` over a JWT fetch client (`lib/api.ts`), the JWT session lives in
`lib/auth-provider.tsx`, and `useAuth()` reads from `GET /auth/me`. Run **both** together — start the
API (`uvicorn` on :8000) then `npm run dev` (:3000); the frontend needs `NEXT_PUBLIC_API_URL`
(`.env.local`).

The blueprint for this migration — schema, endpoint map, permission port, phased schedule — is
**`frontend-erp-react/FASTAPI-BACKEND-PLAN.md`**. The **source of truth for the domain rules is now
the backend**; the pure frontend helpers `lib/types.ts` (shared shapes the API already matches),
`lib/permissions.ts` (capability matrix) and `lib/attendance.ts` (%/tally math) remain canonical for
the client. `lib/store.tsx` / `lib/data.ts` are gone / unused (the backend seed owns the data).

## Shared domain model (canonical: `frontend-erp-react/lib/types.ts`)

Department → Program → Semester → Course; Student and Teacher belong to a Department/Program;
AcademicTerm (year + odd/even parity) scopes the whole app; CourseAssignment links a Teacher to a
Course for a term; AttendanceSession (one class hour) holds AttendanceRecords; AuditEntry is an
append-only log; StudyMaterial is per-course file sharing; User is a login account with a role.

Load-bearing invariants (identical on both sides): **cascading deletes** (department → programs →
semesters → courses → assignments → attendance → materials), **at most one HOD per department**,
**attendance is tamper-evident** (corrections preserve `originalStatus`, every mutation is
audited and never pruned, and an **attendance lock** freezes past dates for all but
`overrideLock` roles), and a set of **uniqueness constraints** (roll number, employee id, term
parity, assignment triple, one student-rep account per class). Six roles: `admin`, `principal`,
`teacher`, `attendance-manager`, `hod`, `student-rep`.

Two invariants that are enforced **server-side only** — the client mirrors them for the UI, and
mistaking the mirror for the guard is how both were broken at once:

- **Read scoping** (`backend-erp-fastapi/services/scope.py`, capability `view_scope`). Who may
  *read* which class, as distinct from who may write attendance (`mark_scope`) or share materials
  (`material_scope`). admin/principal/attendance-manager → the college; hod → their department;
  teacher → courses assigned this term; student-rep → their one `(program, semester)`. Until this
  module existed, `lib/permissions.ts`'s route table was the only thing scoping anything, and a
  class-rep login — one password shared by a whole class — could read any other class's register,
  any roster (addresses, dates of birth, guardian phone numbers) and the college-wide summary by
  changing a query parameter.
- **Every mutation of a saved attendance session is audited.** The correction path always was; the
  three branches beside it — dropping a student from a re-save payload, adding one, and re-posting
  with a different `termId` — were not, and each rewrote a register with nothing in the log.
  Removal is the sharpest: it takes the record *and* its `originalStatus`, which is what the
  oversight page compares against, so it beat the tamper-evidence design outright. It now emits a
  `remove-record` audit entry carrying the status as originally marked; a term change is a 409.

Two more rules that are easy to get wrong when touching accounts or student intake:

- **Account management is admin + principal, but principals can't touch `admin`
  accounts.** Enforced server-side in `services/users.py::assert_may_manage` and
  mirrored for the UI in `lib/permissions.ts::canManageRole`. The guard is what makes
  the grant safe — an unrestricted principal could mint an admin login and reclaim the
  correction/oversight powers the matrix withholds from them. Alongside it,
  `assert_not_self_demotion` refuses any change to your **own** role: `delete_user` always
  blocked self-deletion, but `update_user` didn't, and the last admin demoting itself is a
  lockout no account left in the system can undo. **Self-service password
  change** (`POST /auth/change-password`) is open to every role *except* `student-rep`,
  whose logins are shared by a whole class.
- **A student needs only a roll number, a name, and a class placement**
  (department + program + semester). Every other field is nullable. Placement stays
  required because it decides roster membership — a student without it would be
  invisible to every attendance register.
- **Class-rep logins are retired when their class moves on.** A `student-rep`
  account is pinned to `(programId, classSemester)`, and that pair is the whole of
  what the rep can see — so leaving it behind at rollover eventually shows the
  outgoing rep the *next intake's* attendance. `POST /students/promote` and
  `/students/graduate` **delete** the login of any class that vacates its semester
  in whole (a partial promotion leaves it alone); the admin creates a fresh account
  for the new class, which also rotates the shared password each term. Full rules in
  the backend CLAUDE.md, "Class-rep logins are retired when their class moves on".
- **A teacher needs only an employee id, a name, and a department.** Same shape,
  same reason: the department is what makes HOD-ship and course assignment
  meaningful. `email` is UNIQUE but nullable (Postgres permits many NULLs under a
  unique index); `designation` defaults to Assistant Professor rather than being
  nullable. Both schemas normalise `""` → `NULL` on input, because an untouched
  HTML field posts an empty string and that has to mean "absent" — skipping that
  is what once made the seeded staff list 500 the whole `/teachers` endpoint.

## Performance contract between the two

The system is built for full-college scale — it was validated against a synthetic large dataset
(~4.8k students, 202k attendance sessions, **4M attendance records**, 224k audit entries; the
generator has since been removed along with the demo seeds). The dividing line is simple and
load-bearing:

> **The database answers questions; the client renders answers.** No page fetches a whole table.

- **Every list endpoint is paginated** and returns `Page<T>` (`{items, total, page, pageSize,
  totalPages}`); search/filter/sort are query params executed in SQL (trigram indexes back
  substring search, `sortBy` is whitelisted server-side).
- **Aggregates live in the backend** (`services/analytics.py` → `/attendance/summary`,
  `/attendance/red-flags`, `/stats/*`). `lib/attendance.ts` stays canonical for the client's own
  display maths, and the SQL mirrors it exactly (`held = status != "od"`,
  `attended ∈ {present, late}`, plus the same tally over `COALESCE(original_status, status)` — the
  "as marked" figure that makes tampering visible).
- **Indexes, deferred blobs and `lazy="raise"` relationships** keep the server honest; a narrow
  in-process TTL cache with **explicit invalidation** (never TTL-only) covers `/settings`, `/terms`,
  `/courses`, `/users/directory`. GZip + ETag/304 cover the wire.

Read each subproject's CLAUDE.md before changing any of this — the rules are stated there in full.

## Production / scaling architecture (~500 concurrent users)

A second pass beyond the query-level contract above, aimed at real deployment and horizontal
scale. Full detail lives in each subproject's own CLAUDE.md (backend: "Production / scaling
architecture"; frontend: same section name) — this is the map:

- **Deploy target: a VPS running Docker Compose.** `docker-compose.yml` (this dir) wires
  `postgres` + `redis` + one-shot `migrate` and `seed` services + `api` + `web` + `caddy` (the
  only internet-facing service — TLS + reverse proxy + the security headers deferred from the
  backend). Runbook: `DEPLOY.md`.
- **Local: the whole stack runs in Docker Desktop**, host-dependency-free —
  `docker compose -f docker-compose.local.yml up -d --build` → http://localhost:8080. Same
  images and same path-based routing as production; the differences are confined to the edge
  (`Caddyfile.local`: plain HTTP on :8080, no ACME) and a `bootstrap` service that folds
  migrate+seed into `up` and is safe to re-run. Zero config — every variable defaults inside
  the compose file, so no `.env` is required.
- **Backend runs multi-worker** (gunicorn + uvicorn workers, `backend-erp-fastapi/Dockerfile`),
  backed by **Redis** for the shared cache (`services/cache.py`) and rate limiting
  (`rate_limit.py`) — both fall back to single-process in-memory implementations when
  `REDIS_URL` is unset, so local dev needs no new moving part.
  Fixed en route: the blocking-bcrypt bug (`security.py` calls now run in a threadpool), no
  logging/exception handling at all (now structured JSON + global handlers, `logging_config.py`),
  no rate limiting (`slowapi` on `/auth/login`), a silently-accepted insecure JWT secret default
  (now fails fast in `ENVIRONMENT=production`).
- **Frontend adds error boundaries** (`app/error.tsx`, `app/global-error.tsx`) and **Sentry** on
  both sides (`NEXT_PUBLIC_SENTRY_DSN` — empty disables it), plus `output: "standalone"` for the
  Docker image.
- **Tests + CI**: `backend-erp-fastapi/tests/` (pytest + testcontainers, a real ephemeral
  Postgres per run, 102 tests) covers auth, cascades, single-HOD, attendance correction/audit/lock,
  uniqueness, per-role read scoping, and the self-demotion lockout.
  `frontend-erp-react/lib/*.test.ts` (Vitest + Testing Library, 46 tests) covers the attendance
  tally/pct math and the permission matrix. `.github/workflows/ci.yml` (repo root) runs both, plus
  lint/typecheck/build, on every push/PR.
- **Load validation**: `k6/` has scripts against the four hot paths (login, student search,
  attendance summary, attendance marking) with a concrete pass bar — see `k6/README.md`.

## Commands (quick reference)

```bash
# Frontend (run in PowerShell, not Git Bash — see note below)
cd frontend-erp-react
npm install
npm run dev            # http://localhost:3000
npx tsc --noEmit       # fast typecheck; npm run build also typechecks

# Backend
cd backend-erp-fastapi
# deps live in the checked-in venv (no requirements.txt yet — see backend CLAUDE.md)
attadance_system\Scripts\Activate.ps1
uvicorn main:app --reload    # or: fastapi dev main.py
alembic upgrade head
```

## Repo conventions

- **Windows / PowerShell:** run `node`/`npm`/`next` and Python commands in **PowerShell**, not
  Git Bash — on this machine `node` is a shim Git Bash mis-parses.
- **Git state:** the default branch for PRs is `main`; current work is on `master`. **One
  repository at the root**, covering both subprojects plus `k6/`, `tools/` and the Compose/Caddy
  files. `frontend-erp-react/` used to be a *separate* git repo, which made the root see it as a
  submodule pointer rather than 130 source files — its `.git` was removed. Nothing is committed
  yet, so there is no commit convention to match.
- **Ignore files:** the root `.gitignore` is deliberately self-sufficient (it covers both
  subprojects on its own) while the two nested ones stay as framework-idiomatic backups. Note a
  nested `.gitignore` *overrides* the root for files in its directory — that is why
  `frontend-erp-react/.gitignore` needs its own `!.env.example`, since its blanket `.env*` beats
  the root's negation. The `.dockerignore` files are **not** copies of the `.gitignore`s: build
  contexts are still per-subproject, `students.csv` is gitignored but must ship (the seed reads
  it), and `tests/`/docs are tracked but must not ship.
- Each subproject owns its own tooling, dependencies and lint/test setup; there is no root-level
  build, workspace, or shared package manager.
