# SCAS ERP — Codebase Summary

A college (arts & science) management system: Departments, Programs, Students, Teachers, a
tamper-evident **Attendance** workflow and a **Study Materials** module, all behind role-based
login. Monorepo, one git repo (`master`, PRs target `main`).

```
scas-erp/
├── backend-erp-fastapi/   FastAPI + SQLAlchemy 2 (async) + PostgreSQL + Alembic  ← source of truth
├── frontend-erp-react/    Next.js 16 + React 19 + TS + Tailwind v4 + TanStack Query
├── docker-compose.yml         VPS / production stack
├── docker-compose.local.yml   Docker Desktop stack (zero config, http://localhost:8080)
├── Caddyfile / Caddyfile.local  Reverse proxy (TLS in prod, plain HTTP locally)
├── k6/                    Load tests (login, student search, attendance summary, mark attendance)
├── tools/build_students_csv.py  Builds students.csv (583 real students) from the attendance xlsx files
├── .github/workflows/     ci.yml (lint/typecheck/tests/build), e2e.yml (Playwright)
└── DEPLOY.md, CLAUDE.md   Runbook and developer guidance
```

Request path: **Browser → Caddy → (`/api/*` → FastAPI, everything else → Next.js) → Postgres / Redis**.

---

## 1. Domain model and rules

Department → Program → Semester → Course. Student and Teacher belong to a Department/Program.
`AcademicTerm` (year + odd/even parity) scopes the app. `CourseAssignment` links Teacher ↔ Course
per term. `AttendanceSession` (one class hour) holds `AttendanceRecord`s. `AuditEntry` is an
append-only log. `StudyMaterial` is a per-course link. `User` is a login account with one of six
roles: `admin`, `principal`, `teacher`, `attendance-manager`, `hod`, `student-rep`.

Invariants enforced server-side (the frontend only mirrors them):

- **Cascading deletes**: department → programs → semesters → courses → assignments → attendance → materials.
- **At most one HOD per department.**
- **Attendance is tamper-evident**: corrections keep `original_status`; every mutation (including
  removing/adding a record or changing term) writes an audit entry that is never pruned; an
  **attendance lock date** freezes past dates for everyone except roles with `override_lock`.
- **Uniqueness**: roll number, employee id, term (year+parity), assignment triple
  (course, teacher, term), session (course/term/date/period), record (session+student), one
  student-rep account per class.
- **Read scoping** (`services/scope.py`): admin/principal/attendance-manager → whole college; hod →
  own department; teacher → courses assigned this term; student-rep → their one (program, semester).
  Student PII (address, DOB, guardian) is visible only to admin/principal/hod.
- **Accounts**: admin + principal manage users, but a principal can't touch `admin` accounts;
  nobody can change their own role; password self-change is open to all roles except `student-rep`.
  Class-rep logins are deleted when their class is promoted/graduated.
- **Minimal required fields**: a student needs roll number, name and placement (dept+program+semester);
  a teacher needs employee id, name and department. Empty strings normalise to NULL.

---

## 2. Backend (`backend-erp-fastapi/`)

**Stack**: FastAPI, SQLAlchemy 2.0 async (asyncpg), Alembic (psycopg2 for migrations), pydantic-settings,
bcrypt + python-jose (JWT), slowapi (rate limit), Redis (optional), Sentry (optional), gunicorn + uvicorn workers.

**Layout**

| Dir / file | Purpose |
|---|---|
| `main.py` | App factory: logging, Sentry, exception handlers, **ETag/304 middleware**, GZip, CORS, request logging, `/health/*` |
| `config.py` | Settings from env/.env; refuses boot if `ENVIRONMENT=production` with the default JWT secret |
| `routers/` | 14 routers, ~71 endpoints (thin: validate → call service) |
| `services/` | Business logic: `attendance`, `analytics` (SQL aggregates), `scope` (read scoping), `users`, `students`, `cache`, `pagination`, `audit`, … |
| `models/` | SQLAlchemy models (string ids, `lazy="raise"` relationships) |
| `schemas/` | Pydantic request/response models, camelCase JSON |
| `permissions.py` | Role → capability matrix (`manage_users`, `view_scope`, `mark_scope`, `edit_attendance`, `override_lock`, `view_audit`, …) |
| `security.py` | bcrypt hashing (run in threadpool) and JWT with a `token_epoch` claim |
| `rate_limit.py` | `/auth/login` limited to 10/min per client IP (Redis-backed, X-Forwarded-For aware) |
| `alembic/versions/` | 6 migrations: initial schema, perf indexes, materials-as-links, optional student fields, optional teacher fields, user `is_active` + `token_epoch` |
| `seed_production.py` | Installs the real college, teachers/HODs, the 583 students (from gitignored `students.csv`) and all accounts; writes passwords to `seed_credentials.csv`. Guarded: refuses if DB already has data |
| `reset_db.py` | Dev-only table wipe; refuses in production |
| `tests/` | 14 test modules (pytest + testcontainers, real ephemeral Postgres) |

**API surface (by router)**: `/auth` (login, change-password, logout, me) · `/users` · `/departments` ·
`/programs` · `/semesters` · `/courses` · `/terms` (+ `PUT /current`) · `/teachers` (+ `/hods`, `/{id}/hod`) ·
`/students` (+ `/ids`, `/lookup`, `/roll-numbers`, `/promote`, `/graduate`, `/{id}/toggle-active`) ·
`/assignments` · `/attendance` (list, `/register`, `/months`, `/roster`, `/class-roster`, `/summary`,
`/summary/breakdown`, `/red-flags`, POST save, PATCH correct, DELETE) · `/materials` · `/stats/*`
(dashboard, unstaffed-courses, shortfall-count) · `/settings`, `/lock-date`, `/audit`, `/audit/lock-history`.

**Performance design**: every list endpoint is paginated (`Page<T>`); search/filter/sort run in SQL
(trigram indexes, whitelisted `sortBy`); aggregates live in `services/analytics.py` and mirror the
frontend maths (`held = status != od`, `attended ∈ {present, late}`); a small cache for
settings/terms/courses/directory with explicit invalidation (Redis, or in-memory fallback);
DB pool 8 + 4 overflow per worker.

---

## 3. Database (PostgreSQL 16)

Tables: `department`, `program`, `semester`, `course`, `student`, `teacher`, `course_assignment`,
`academic_term`, `attendance_session`, `attendance_record`, `audit_entry`, `study_material`,
`user`, `app_settings` (singleton: current term + lock date).

| Aspect | Detail |
|---|---|
| Keys | String(64) primary keys (matching frontend ids) |
| Cascade | `ON DELETE CASCADE` down the curriculum chain; `SET NULL` for student/teacher/user → department/program/teacher links |
| Key constraints | `uq_semester_program_number`, `uq_term_year_parity`, `uq_record_session_student`, unique `roll_number`, `employee_id`, `department.name/code`; case-insensitive unique index on `lower(user.email)` |
| Indexes | Composite indexes for the hot paths (student by program+semester, session by term/date/period, record by student+status); descending `at` indexes on `audit_entry`; partial/trigram indexes for search |
| Scale | Validated against ~4.8k students, 202k sessions, **4M records**, 224k audit rows |
| Dev default | `postgresql+asyncpg://postgres:1234@localhost/erp_scas` (config default — override in any shared environment) |
| Docker | `postgres:16`, `max_connections=40`, `shared_buffers=64MB` (2 workers × 12 = 24 from the API, rest is headroom; sized for a 1 GB VPS), named volume `postgres_data` |
| Backups | `docker compose --profile backup run --rm backup` → `pg_dump -Fc` to `./backups`, keeps the newest 14 |

---

## 4. Frontend (`frontend-erp-react/`)

**Stack**: Next.js 16 App Router, React 19, TypeScript, Tailwind v4, shadcn/Base UI components,
TanStack Query v5, axios, sonner toasts, next-themes, Sentry. Tests: Vitest + Testing Library
(unit), Playwright (e2e). Build output is `standalone` for Docker.

**Structure**

- `app/` — pages: Dashboard (`/`), `programs[/id]`, `students[/id]`, `teachers[/id]`, `assignments`,
  `attendance` (mark) + `attendance/sessions` (correct), `/register`, `/summary`, `/audit`,
  `materials`, `promotions`, `semester-close`, `users`; plus `error.tsx` / `global-error.tsx`.
- `lib/api.ts` — axios client: bearer token from `localStorage`, error → `ApiError`, 401 drops the
  session, 304 treated as success (ETag path).
- `lib/queries/` — one React Query hooks module per domain (students, attendance, users, …) with
  central `keys.ts`.
- `lib/auth-provider.tsx` — JWT session; `useAuth()` loads from `GET /auth/me`.
- `lib/permissions.ts` — capability matrix + route table (`isPathAllowed`), mirror of the backend;
  drives sidebar and UI only — the server is the guard.
- `lib/attendance.ts` — % / tally maths; `lib/types.ts` — shared shapes matching the API.
- `components/` — feature folders (attendance, students, teachers, materials, users, …), `app-sidebar`,
  `term-switcher`, 26 shadcn `ui/` primitives.
- The old `localStorage` data store is gone; the API must be running.

Frontend needs `NEXT_PUBLIC_API_URL` **at build time** (inlined into the bundle).

---

## 5. Docker

Two Compose files, same images.

| Service | Image | Role |
|---|---|---|
| `postgres` | postgres:16 | Data; healthcheck `pg_isready` |
| `redis` | redis:7-alpine | Cache + rate-limit store; AOF off (cold cache is fine) |
| `migrate` (prod) | backend image | One-shot `alembic upgrade head`, run explicitly so replicas never race |
| `seed` (prod) | backend image | One-shot production seed; writes `seed_credentials.csv` |
| `bootstrap` (local) | backend image | Migrate + seed automatically on `up`, safe to re-run |
| `api` | `backend-erp-fastapi/Dockerfile` | gunicorn + uvicorn workers (`WEB_CONCURRENCY`, default 2), `/health/ready` healthcheck, not published |
| `web` | `frontend-erp-react/Dockerfile` | Next.js standalone server on :3000, not published |
| `caddy` | caddy:2-alpine | Only public entry point |
| `backup` (prod, profile) | postgres:16 | On-demand `pg_dump` |

Dockerfiles: backend is multi-stage (python:3.12-slim, non-root, `exec gunicorn` so it is PID 1 and
gets SIGTERM); frontend is multi-stage (node:22-alpine, `npm ci` → `npm run build` → copy
`.next/standalone` + static + public, non-root).

**Production**: `cp .env.example .env` → `docker compose build` → `run --rm migrate` →
`run --rm seed` (first deploy only) → `up -d`. **Local**: `docker compose -f docker-compose.local.yml up -d --build`
→ http://localhost:8080; defaults for everything; Postgres also published on localhost:5432.
Changing `APP_PORT` or the API URL requires rebuilding `web`.

---

## 6. Caddy

| | `Caddyfile` (production) | `Caddyfile.local` |
|---|---|---|
| Site | `{$DOMAIN}` — automatic Let's Encrypt HTTPS | `:80` (published as host :8080), plain HTTP |
| Routing | `handle_path /api/*` → `api:8000` (prefix stripped); everything else → `web:3000` | same |
| Headers | HSTS, `nosniff`, `X-Frame-Options: DENY`, CSP (`'self'`, `'unsafe-inline'` for Next.js) | same minus HSTS (avoids pinning localhost to HTTPS) |

Path-based routing means one domain and one certificate; `NEXT_PUBLIC_API_URL=https://<domain>/api`.
Caddy sets `X-Forwarded-For`; the backend's rate limiter reads it, which is safe only because `api`
is never published to the host.

---

## 7. Testing, CI and load

- **Backend**: pytest + testcontainers — auth, cascades, single-HOD, attendance correction/audit/lock,
  correction window, record integrity, uniqueness, read scoping, account management/lifecycle,
  admin lockout, rep-account rollover, optional student/teacher fields.
- **Frontend**: Vitest (attendance math, permission matrix); Playwright e2e (`tests/e2e/auth.spec.ts`).
- **CI**: `ci.yml` runs pytest plus lint, `tsc --noEmit`, Vitest and build; `e2e.yml` runs Playwright.
- **k6**: login, students search, attendance summary, mark attendance — target ~500 concurrent users.
  The login limit (10/min/IP) will dominate a single-machine `login.js` run.

---

## 8. Work in progress (uncommitted at time of analysis)

Only the initial commit exists; modified files cover **account lifecycle** (new `is_active` +
`token_epoch` columns and migration `f6b8d05e3c19`, so deactivating/changing credentials invalidates
existing JWTs), tests for it, auth/users/permissions changes on both sides, plus new Playwright e2e
setup and workflow.

## 9. Things worth knowing / watching

- `seed_credentials.csv`, `students.csv` and the three `.xlsx` files at the repo root hold real
  passwords and student data; confirm they are gitignored and never committed or baked into images
  (`students.csv` must ship in the backend image because the seed reads it).
- The backend's default `database_url` and JWT secret are dev-only; production fails fast on the
  JWT default but not on the DB default.
- The CSP allows `'unsafe-inline'` scripts — acceptable starting point, flagged for tightening.
- `package.json` name is still `my-app`.
