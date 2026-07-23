# FastAPI Backend Implementation Plan

**Project:** SCAS ERP — backend for the existing Next.js sandbox frontend  
**Timeline:** 5 days × 10–12 hours (~55 hours total)  
**Decisions locked in:**

| Decision | Choice |
|---|---|
| Database | **PostgreSQL** from day one |
| Frontend integration | **Full wiring** — React Query behind existing `useStore()` shape |
| Auth | **Real JWT + bcrypt** password hashing |
| Repo layout | **`backend/`** folder inside this monorepo |

---

## Context

The frontend is currently a **client-only sandbox**: all state lives in `lib/store.tsx`, persisted to `localStorage`, with business rules enforced in the store. Adding a FastAPI backend is a deliberate reversal of that design — the backend becomes the source of truth, and the frontend store becomes a thin async client.

### Key frontend files to mirror

| File | What to port |
|---|---|
| `lib/types.ts` | All domain types, enums, constants |
| `lib/store.tsx` | Every CRUD method, cascades, invariants, audit stamping, lock guard |
| `lib/permissions.ts` | Role capabilities, scope checks (`markScope`, `overrideLock`, HOD dept-lock, rep classScope) |
| `lib/attendance.ts` | Status semantics (`tally`, `pct`, `classesNeeded`) — can stay client-side or move to server |
| `lib/data.ts` | Deterministic seed data (same ids, same demo stories) |

### Biggest risk

Not the backend itself — it's **re-wiring the frontend store**. Every page calls synchronous `useStore()` methods that mutate in-memory state and re-render instantly. The refactor must keep the `useStore()` return shape so pages barely change, while swapping internals to TanStack Query mutations.

---

## Target architecture

| Concern | Choice | Why |
|---|---|---|
| Framework | **FastAPI** + Uvicorn | As requested |
| ORM | **SQLAlchemy 2.0** (async) + Alembic | Migrations + typed models |
| Validation | **Pydantic v2** | Mirrors TS types 1:1 |
| DB driver | **asyncpg** | Async Postgres |
| Auth | **JWT** (access token) + `passlib[bcrypt]` | Replaces plaintext mock |
| File storage | **DB `LargeBinary`** or local `./uploads/` | Replaces per-file `localStorage` keys |
| Frontend data | **TanStack Query** (`@tanstack/react-query`) | Cache + async mutations behind existing store shape |

### Design rule

**All invariants currently in `lib/store.tsx` move server-side:**

- Cascading deletes (department → programs → semesters → courses → assignments → attendance → materials)
- Single-HOD per department
- Attendance upsert + correction diffing + `originalStatus` preservation
- Audit log stamping (append-only, never pruned)
- Lock guard (`date <= lockDate` blocked unless `overrideLock`)
- Uniqueness constraints (roll numbers, employee ids, term parity, assignment triples, one rep per class)

---

## Repo layout

```
frontend-erp-react/
  app/  components/  lib/        # existing Next.js frontend
  backend/
    app/
      main.py            # FastAPI app + CORS
      config.py          # settings (DATABASE_URL, JWT_SECRET) via pydantic-settings
      db.py              # async engine + session
      security.py        # bcrypt + JWT issue/verify
      deps.py            # get_current_user, require_capability, scope guards
      models/            # SQLAlchemy 2.0 models (one module per domain)
      schemas/           # Pydantic v2 (Base/Create/Read)
      routers/           # one router per entity group
      services/          # business logic (cascades, invariants, attendance/audit, lock guard)
      seed.py            # deterministic port of lib/data.ts
    alembic/             # migrations
    docker-compose.yml   # local Postgres 16
    requirements.txt
    .env.example
    README.md
```

---

## Database schema (14 entities)

Normalize the two nested shapes from the frontend:

- **`Course`** → own table with FK `semester_id` (currently nested in `Semester.courses[]`)
- **`AttendanceRecord`** → own table with FK `session_id` (currently nested in `AttendanceSession.records[]`)

### Uniqueness constraints

| Entity | Constraint |
|---|---|
| `Semester` | `(number, program_id)` |
| `Student` | `roll_number` |
| `Teacher` | `employee_id` |
| `AcademicTerm` | `(start_year, parity)` |
| `CourseAssignment` | `(course_id, teacher_id, term_id)` |
| `AttendanceSession` | `(course_id, date, period)` |
| `User` | `email` (case-insensitive login) |
| `User` (student-rep) | one account per `(program_id, class_semester)` |
| `Teacher` (HOD) | at most one `is_hod = true` per `department_id` |

### Postgres-specific

- Partial unique index for single-HOD: `UNIQUE (department_id) WHERE is_hod = true`
- `AuditEntry` table — append-only, never deleted
- `lock_date` stored as a singleton row or app-settings table
- `current_term_id` stored as app-settings (or FK on a `settings` table)

---

## Endpoint map

Every `useStore()` method becomes an endpoint.

### Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` | Returns `{ access_token, user }` |
| `POST` | `/auth/logout` | Optional (stateless JWT) |
| `GET` | `/auth/me` | Current user + linked teacher/class scope |

### Departments

| Method | Path | Notes |
|---|---|---|
| `GET` | `/departments` | List |
| `POST` | `/departments` | Create |
| `PUT` | `/departments/{id}` | Update |
| `DELETE` | `/departments/{id}` | Cascade: programs → semesters → courses → assignments → attendance → materials |

### Programs

| Method | Path | Notes |
|---|---|---|
| `GET` | `/programs` | List (optional `?departmentId=`) |
| `POST` | `/programs` | Create; returns new id |
| `PUT` | `/programs/{id}` | Update |
| `DELETE` | `/programs/{id}` | Cascade |

### Semesters & Courses

| Method | Path | Notes |
|---|---|---|
| `POST` | `/semesters` | Create (empty `courses: []`) |
| `DELETE` | `/semesters/{id}` | Cascade |
| `POST` | `/semesters/{id}/courses` | Add course |
| `DELETE` | `/semesters/{id}/courses/{courseId}` | Cascade assignments/attendance/materials |

### Students

| Method | Path | Notes |
|---|---|---|
| `GET` | `/students` | List (filters: dept, program, semester, status) |
| `POST` | `/students` | Create |
| `PUT` | `/students/{id}` | Update (`roll_number` locked on edit) |
| `DELETE` | `/students/{id}` | Hard delete + strip from all attendance records |
| `POST` | `/students/{id}/toggle-active` | Flip `is_active` |
| `POST` | `/students/promote` | Bulk `current_semester + 1` (active, non-graduated only) |
| `POST` | `/students/graduate` | Bulk set `graduated = true` |

### Teachers

| Method | Path | Notes |
|---|---|---|
| `GET` | `/teachers` | List |
| `POST` | `/teachers` | Create; enforces single-HOD if `is_hod` |
| `PUT` | `/teachers/{id}` | Update; enforces single-HOD |
| `DELETE` | `/teachers/{id}` | Unlink user accounts, drop assignments |
| `POST` | `/teachers/{id}/hod` | Set/clear HOD; demotes others in dept |

### Academic terms

| Method | Path | Notes |
|---|---|---|
| `GET` | `/terms` | List |
| `POST` | `/terms` | Create from `(startYear, parity)`; derives name/endYear |
| `PUT` | `/terms/current` | Set `current_term_id` |

### Teaching assignments

| Method | Path | Notes |
|---|---|---|
| `GET` | `/assignments` | Filter by `?termId=` |
| `POST` | `/assignments` | Assign (no-op if exists) |
| `DELETE` | `/assignments` | Unassign by `(courseId, teacherId, termId)` |

### Attendance

| Method | Path | Notes |
|---|---|---|
| `GET` | `/attendance` | Filter by course/term/date |
| `POST` | `/attendance` | Upsert `(courseId, date, period)` — diff records, stamp audit, lock guard |
| `PATCH` | `/attendance/{sessionId}/records/{studentId}` | Single-cell correction |
| `DELETE` | `/attendance/{sessionId}` | Delete + tombstone audit entry |
| `GET` | `/attendance/roster` | Server-derived roster (`?courseId=`) |

### Integrity

| Method | Path | Notes |
|---|---|---|
| `PUT` | `/lock-date` | Freeze/unfreeze; audited |
| `GET` | `/audit` | Filterable audit log (term, action, user) |
| `GET` | `/attendance/summary` | Optional server-side aggregation |

### Study materials

| Method | Path | Notes |
|---|---|---|
| `GET` | `/materials` | List (role-scoped) |
| `POST` | `/materials` | Multipart upload (2 MB cap, allowed extensions) |
| `GET` | `/materials/{id}/download` | Stream file blob |
| `DELETE` | `/materials/{id}` | Delete metadata + blob |

### Users (admin only)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/users` | List |
| `POST` | `/users` | Create (enforce email + rep-class uniqueness) |
| `PUT` | `/users/{id}` | Update |
| `DELETE` | `/users/{id}` | No-op on self |

---

## Permission enforcement

Port `lib/permissions.ts` to Python. FastAPI dependencies:

```python
require_capability("manageAcademics")
require_capability("overrideLock")
require_mark_scope(course_id)      # "all" | "own" | "none"
require_dept_scope(department_id)  # HOD lock
require_class_scope(program_id, semester)  # student-rep lock
```

### Role capability matrix

| Role | Key capabilities |
|---|---|
| `admin` | Everything |
| `principal` | All except `manageUsers` |
| `teacher` | `markScope: own` (first-time only), `materialScope: own` |
| `attendance-manager` | `markScope: all`, `editAttendance`, `deleteAttendance`, `overrideLock` |
| `hod` | `markScope: own`, `materialScope: own`, dept-scoped reads |
| `student-rep` | Read-only: register, summary, materials for own class |

---

## 5-day schedule

### Day 1 — Foundations & data layer (~11h)

| Task | Hours |
|---|---|
| Scaffold `backend/` (FastAPI, config, db, Alembic, `.env`, `requirements.txt`, CORS) | 1.5 |
| `docker-compose.yml` for Postgres 16 + `DATABASE_URL` wiring | 1 |
| SQLAlchemy models for all 14 entities + uniqueness constraints | 4 |
| Pydantic schemas mirroring `lib/types.ts` | 2.5 |
| First Alembic migration + create DB | 1 |
| Seed script porting `lib/data.ts` (same ids, bcrypt-hashed passwords) | 2 |

**End of day:** Postgres DB with identical demo data to the sandbox.

---

### Day 2 — Auth + simple CRUD (~11h)

| Task | Hours |
|---|---|
| JWT auth: `passlib` hashing, login, token issue, `get_current_user`, `/auth/me` | 2.5 |
| Port `roleCapabilities` + `require_capability` / `require_scope` dependencies | 2 |
| CRUD routers: departments, programs, semesters/courses, teachers (cascades + single-HOD) | 4.5 |
| Users router (admin-gated, can't-delete-self, uniqueness, rep-class uniqueness) | 2 |

---

### Day 3 — Students, terms, assignments, attendance core (~11h)

| Task | Hours |
|---|---|
| Students router + promote/graduate/toggle-active | 2 |
| Terms + set current term | 1 |
| Assignments (multi-teacher, unique triple) | 1.5 |
| **Attendance** — upsert w/ correction diff, `originalStatus`, audit stamping, lock guard | 5 |
| Lock-date + audit (filterable) endpoints | 1.5 |

---

### Day 4 — Materials, hardening, frontend kickoff (~11h)

| Task | Hours |
|---|---|
| Materials: multipart upload, download stream, delete, cascade cleanup | 2.5 |
| Optional server-side summary/register aggregation | 1.5 |
| Backend hardening: error shapes, 403 on scope violations, smoke tests | 2 |
| **Frontend:** add `@tanstack/react-query`, `lib/api.ts`, `AuthProvider`, refactor `lib/store.tsx` reads + login/logout | 5 |

---

### Day 5 — Finish frontend wiring, test, polish (~11h)

| Task | Hours |
|---|---|
| Convert remaining mutations to React Query with cache invalidation | 4.5 |
| Fix loading/`hydrated` semantics (`AuthGate` waits on query loading) | 1.5 |
| End-to-end test all 6 demo roles against real backend | 3 |
| `npx tsc --noEmit` + `npm run build` green; `backend/README.md` | 2 |

---

## Frontend integration strategy

### Keep the `useStore()` shape

Pages call `useStore()` synchronously. The refactor swaps internals without changing the public API:

```typescript
// Before (localStorage)
addDepartment: (input) => setState(...)

// After (React Query)
addDepartment: (input) => {
  createDepartment.mutate(input)
  // optimistic update or invalidate ['departments']
}
```

### New files

| File | Purpose |
|---|---|
| `lib/api.ts` | Typed fetch client; attaches JWT; handles 401 |
| `lib/auth-provider.tsx` | Stores JWT; provides login/logout |
| `lib/queries/` | React Query hooks per domain (optional split) |

### Breaking changes to audit

| Current behavior | New behavior |
|---|---|
| `addProgram()` returns `string` synchronously | Returns `Promise<string>` or use mutation callback |
| `addMaterial()` returns `boolean` synchronously | Async; toast on quota error from 413 response |
| `login()` returns `boolean` | Async; sets JWT in `AuthProvider` |
| `hydrated` from localStorage load | `isLoading` from initial queries |
| `getMaterialData(id)` reads localStorage | Fetches `GET /materials/{id}/download` |
| `resetData()` restores seed | `POST /admin/reset` or re-run seed script |

### Environment

```env
# .env.local (frontend)
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Attendance business logic (server-side)

Port exactly from `lib/store.tsx`:

### Upsert (`saveAttendance`)

1. Check lock guard: `date <= lockDate` AND user lacks `overrideLock` → 403
2. Find existing session by `(courseId, date, period)`
3. **If exists (correction):**
   - Diff each record; log `"edit"` audit entry per changed cell
   - Set `originalStatus` on first correction only (`originalStatus ?? old.status`)
   - Stamp `editedBy` / `editedAt`
4. **If new:**
   - Create session with `markedBy` / `markedAt`
   - Append `"mark"` audit entry

### Single-cell edit (`setAttendanceStatus`)

Same correction logic for one student; add record if missing.

### Delete session

Append `"delete-session"` tombstone audit entry; remove session + records.

### Lock / unlock

Update `lock_date`; append `"lock"` or `"unlock"` audit entry.

### Roster derivation

Active, non-graduated students in the course's program whose `current_semester` equals the course's semester number.

---

## Seed data

Port `lib/data.ts` deterministically:

- Same ids (`dept-cs`, `prog-bca`, `tch-1`, etc.) so demo stories survive
- Demo passwords bcrypt-hashed (`admin123`, `principal123`, etc.)
- ~150 students, ~60 attendance sessions, audit log with correction/red-flag stories
- Hero classes: BCA Sem 3, B.Sc CS Sem 1, B.Com Sem 3, BA English Sem 3

Run: `python -m app.seed` (or `alembic upgrade head && python -m app.seed`)

---

## Definition of done

- [ ] Every `useStore()` method backed by a real endpoint
- [ ] All invariants enforced server-side (not just in the frontend)
- [ ] All 6 demo roles work end-to-end against Postgres
- [ ] Demo data identical to sandbox (same ids, same stories)
- [ ] `npx tsc --noEmit` + `npm run build` pass
- [ ] `backend/README.md` documents: `docker compose up`, `alembic upgrade head`, seed, env vars
- [ ] One-command boot: Postgres + migrations + seed + `uvicorn` + `npm run dev`

---

## Quick start (target end state)

```bash
# Terminal 1 — backend
cd backend
docker compose up -d
pip install -r requirements.txt
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
npm install
npm run dev
# → http://localhost:3000 (API at http://localhost:8000)
```

Login with demo accounts: `admin@scas.edu` / `admin123`, etc.

---

## Dependencies (`requirements.txt`)

```
fastapi
uvicorn[standard]
sqlalchemy[asyncio]
asyncpg
alembic
pydantic-settings
python-jose[cryptography]
passlib[bcrypt]
python-multipart
```

Frontend addition:

```
@tanstack/react-query
```
