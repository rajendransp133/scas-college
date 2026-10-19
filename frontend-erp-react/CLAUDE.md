@AGENTS.md

# SCAS ERP — Frontend

The React frontend for the SCAS ERP monorepo, **wired to the FastAPI backend** (`../backend-erp-fastapi`). It talks to the API over a JWT **axios** client (`lib/api.ts`) with **TanStack Query** hooks per domain in `lib/queries/`; the backend is the source of truth for all data and rules. The UI covers **Departments, Programs, Students, and Teachers**, an **Attendance** workflow (assign teachers to courses, promote/graduate student cohorts, and mark per-class daily attendance) and a **Study Materials** module (teachers share links with their class; the class's shared login opens them). Access is gated by **real JWT login** against `POST /auth/login` (see "Auth & roles" below).

> **Requires the backend running.** Set `NEXT_PUBLIC_API_URL` in `.env.local` (defaults to `http://localhost:8000`), start the API, then `npm run dev`. There is **no offline/localStorage fallback** — the old client-only sandbox store (`lib/store.tsx`) was removed when the API was wired in.

The attendance module is built to be **tamper-evident** (the app exists because real-world registers were being quietly "fixed"): every mark/correction/deletion is stamped and logged (the audit log), corrected cells stay visibly marked in the register for *all* viewers including the class's shared login, sessions record who created them, and attendance can be **locked** up to a date — the lock freezes everyone except admin/attendance-manager, who keep audited correction rights (`overrideLock`), and every lock/unlock is itself logged and shown as a history on the oversight page. **These rules are enforced server-side; the client just calls the API.**

---

## Quick start

```bash
npm install          # install deps (package manager is npm; lockfile is package-lock.json)
npm run dev          # start dev server (Turbopack) — http://localhost:3000
npm run build        # production build (also runs full TS typecheck)
npx tsc --noEmit     # typecheck only
npx shadcn@latest add <component> --yes    # add a shadcn/ui primitive
```

A dev server is often already running on port 3000. Don't assume a clean port; check before starting another.

> **Windows/shell note:** run npm/node/next commands in **PowerShell**, not Git Bash. On this machine `node` is a `.ps1`/`.cmd` shim that Git Bash mis-parses (`This: command not found`); PowerShell runs it correctly.

---

## Tech stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router, Turbopack) | Has breaking changes vs. older Next — **read `node_modules/next/dist/docs/` before using framework APIs** (see `AGENTS.md`). |
| UI runtime | **React 19** | Server Components by default; we mostly use Client Components (see below). |
| Language | **TypeScript** (strict) | `@/*` path alias → project root. |
| Styling | **Tailwind v4** | CSS-first config in `app/globals.css`. **No `tailwind.config.js`.** |
| Components | **shadcn/ui**, style `base-nova` | **Built on Base UI (`@base-ui/react`), NOT Radix.** See gotchas. |
| Icons | **lucide-react** | |
| Toasts | **sonner** | `import { toast } from "sonner"`. `<Toaster/>` is mounted in the root layout. |

### Conventions

- **Light mode only.** The theme defines a `.dark` variant but we never add the `.dark` class, so the app stays light. Don't add a theme toggle.
- Prefer **inline Tailwind utility classes**; reach for shadcn components for primitives (buttons, inputs, dialogs, tables…).
- Any component that reads the store, holds state, or has event handlers must be a **Client Component** (`"use client"` at the top of the file).
- ESLint is `eslint-config-next`. Formatting (semicolons, quotes) may be auto-adjusted by the editor/formatter — **match the style of the file you're editing** rather than reformatting wholesale.

---

## Base UI gotchas (this is NOT the Radix-based shadcn you may know)

The `base-nova` style compiles to **Base UI** primitives. APIs differ from the Radix shadcn most references assume:

- **Composition uses a `render` prop, not `asChild`.** Children go on the *outer* component:
  ```tsx
  // ✅ Base UI
  <Button render={<Link href="/x" />} nativeButton={false}>Go</Button>
  // ❌ Radix-style (won't compile here)
  <Button asChild><Link href="/x">Go</Link></Button>
  ```
- **`Button` rendered as a non-`<button>` (e.g. `<Link>`/`<a>`) must also pass `nativeButton={false}`**, or Base UI logs a runtime warning about lost button semantics. A `DropdownMenuTrigger`/`*Trigger` that renders a real `<Button>` does **not** need it; a `DropdownMenuItem` rendered as a `<Link>` doesn't either (menu items render a `<div>`).
- **`Select` `onValueChange` provides `string | null`.** Coerce when you store a string: `onValueChange={(v) => setX(v ?? "")}`.
- **`Switch` uses `checked` + `onCheckedChange(checked: boolean)`** (not `onChange`).
- **`TooltipProvider` takes `delay`**, not `delayDuration`.
- **Route `params`/`searchParams` are Promises** in Server Components (`await params`). In Client Components, read the id with `useParams()` from `next/navigation` instead.

**Rule of thumb:** after `shadcn add`-ing a new component, open its file in `components/ui/` and check the underlying `@base-ui/react` import and prop names before wiring it up. Don't assume Radix prop names.

---

## Directory structure

```
app/
  layout.tsx              # root layout: fonts + metadata, renders <Providers>
  providers.tsx           # client shell: StoreProvider + TooltipProvider + AuthGate (login screen / route guard) + sidebar + header (incl. global TermSwitcher) + Toaster
  page.tsx                # dashboard (stat cards + insight widgets + quick actions + setup checklist) — dept-scoped for HODs
  globals.css             # Tailwind v4 + theme tokens (light + unused .dark)
  programs/page.tsx       # program list (defaults to by-department grouping) + department CRUD dialog
  programs/[id]/page.tsx  # program detail: semesters (Collapsible) + courses
  students/page.tsx
  students/[id]/page.tsx  # student detail (incl. guardian + avatar + active switch)
  promotions/page.tsx     # bulk promote / graduate student cohorts by program (no sidebar entry — linked from Students + Semester Close-Out)
  semester-close/page.tsx # end-of-term checklist with live step statuses (admin/principal; the freeze step is admin-only)
  teachers/page.tsx
  teachers/[id]/page.tsx  # teacher detail (incl. HOD controls)
  assignments/page.tsx    # assign a teacher to each course (per-program view, current term)
  attendance/page.tsx     # MARK attendance only: pick class/period/date, roll-call chips (4 statuses, current term); teachers pick via "My classes" cards only
  attendance/sessions/page.tsx # session management (admin/att-mgr only): open a session's roster in a dialog, edit cells, delete sessions
  attendance/register/page.tsx # students × sessions matrix register (+ month filter, CSV/print, corrected-cell dots)
  attendance/summary/page.tsx  # attendance % + shortfalls + exam eligibility (+ CSV/print)
  attendance/audit/page.tsx    # "Attendance Oversight": red-flag cards + attendance lock incl. lock history (admin only)
  attendance/audit/log/page.tsx # "Audit Log": the filterable audit-log table (admin only)
  materials/page.tsx      # study materials per course — shared links (teacher shares, class-rep opens)
  users/page.tsx          # login-account management (admin only)
components/
  app-sidebar.tsx         # left nav in labelled groups (Overview/Academics/Classes/Oversight; role-filtered via isPathAllowed, empty groups hidden) + user footer with logout (AuthProvider.logout)
  login-page.tsx          # full-screen JWT login (email/password + hardcoded demo-account quick buttons) — calls AuthProvider.login
  page-header.tsx         # title + description + action slot (server-safe); the description is hidden below `md` — the title already says where you are, and on a phone it only pushes content down
  select-field.tsx        # single-select built on Combobox; use this for all dropdowns
  term-switcher.tsx       # global term control in the header: switch terms + add-term form (start year + odd/even; admin/principal), read-only badge otherwise
  attendance/my-classes.tsx # useOwnClasses() hook (drops out-of-session classes) + MyClassesPicker card grid — how teacher-style accounts pick a class
  departments/manage-departments-dialog.tsx # department CRUD list (housed on the Programs page — no standalone /departments route)
  materials/material-share-dialog.tsx # course + link + title + description for study materials
  materials/material-link-thumb.tsx    # URL-derived thumbnail tile (image with icon fallback)
  ui/                     # shadcn/Base UI primitives — generated, avoid hand-editing
    avatar.tsx            # Avatar, AvatarImage, AvatarFallback, AvatarBadge, AvatarGroup
    combobox.tsx          # full Combobox system (trigger + chips variants)
    input-group.tsx       # InputGroup compound component with addons
    progress.tsx          # Progress, ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue
  departments/department-form-dialog.tsx
  programs/program-form-dialog.tsx
  students/student-form-dialog.tsx
  teachers/teacher-form-dialog.tsx
  users/user-form-dialog.tsx
lib/
  types.ts                # domain types + constants (DESIGNATIONS, PROGRAM_LEVELS, Gender, USER_ROLES) + termLabel()/semesterInSession() — shapes the API already matches (camelCase)
  api.ts                  # axios instance + interceptors: apiGet/Post/Put/Patch/Delete; ApiError; token storage; 401 handler; errMsg(); qs(); Page<T>
  date.ts                 # todayLocal() — the browser-local YYYY-MM-DD (never the UTC date)
  auth-provider.tsx       # AuthProvider: holds the JWT (localStorage), login()/logout(), initialized flag
  query-provider.tsx      # QueryClientProvider + shared QueryClient (STALE tiers, no retry on 4xx)
  queries/                # per-domain TanStack Query hooks (useStudents, useCreateStudent, …) + keys.ts factory + barrel index.ts
  permissions.ts          # role capabilities: useAuth() (reads /auth/me + assignments), isPathAllowed(), homePath()
  attendance.ts           # status semantics + tally/pct/classesNeeded (the same maths the API's /attendance/summary runs in SQL)
  export.ts               # toCsv() + downloadCsv() client-side CSV helpers
  utils.ts                # cn() helper (clsx + tailwind-merge)
  branding.ts             # college name/tagline/logo/website — the only place identity is hardcoded
hooks/
  use-debounced-value.ts  # debounce a search box before it reaches a query (input stays instant)
  use-pagination.ts       # 1-based page that resets to 1 when a filter key changes, during render (not in an effect)
```

Per-module pattern: a list page (`app/<module>/page.tsx`), an optional detail page (`app/<module>/[id]/page.tsx`), and a create/edit dialog (`components/<module>/<module>-form-dialog.tsx`).

---

## Data model (`lib/types.ts`)

All ids are strings. Foreign keys are id strings (no nested objects except `Semester.courses`).

- **Department** — `{ id, name, code }`.
- **Program** — `{ id, name, code, departmentId, level: "UG" | "PG" | "PhD" }`. FK `departmentId → Department`. `PROGRAM_LEVELS = ["UG", "PG", "PhD"]` and `PROGRAM_LEVEL_LABELS` (maps to `"Undergraduate" | "Postgraduate" | "Doctoral"`) are exported from `lib/types.ts`.
- **Semester** — `{ id, programId, number, courses: Course[] }`. FK `programId → Program`. **Unique on `(number, programId)`** (enforced in the add-semester form).
- **Course** — `{ id, name, code, credits, type? }`. Owned by a `Semester` (lives in its `courses` array). `type` is one of `COURSE_TYPES` (Core / Elective / Professional Core / Professional Elective / Lab / Open Elective / Audit), optional.
- **Student** — `{ id, rollNumber, name, email, phone, address, dateOfBirth, gender, departmentId, programId, currentSemester, admissionYear, guardianName, guardianRelation, guardianPhone, isActive, graduated? }`. `rollNumber` is unique and **locked once created**. Only `rollNumber`, `name`, `departmentId`, `programId` and `currentSemester` are required — every other field is `?: T | null` and back-fillable, since the registrar rarely has it all on enrolment day. Placement stays required because it decides roster membership. The form dialog keeps optional fields as plain strings and maps `""` → `null` on submit (`components/students/student-form-dialog.tsx::toPayload`); render them with a `—` fallback, and note that a truthy wrapper element (e.g. `<span>{gender}</span>`) defeats a `{children || "—"}` fallback. `isActive` is the soft-delete flag (a **discontinued** student is toggled inactive — no separate status); `graduated` (optional) is the lifecycle flag set by the promotions page. Inactive/graduated students are excluded from new-marking rosters and shortfall/eligibility counts, but their saved attendance stays **visible with a "Left"/"Graduated" tag** in the Register, Summary and session rosters (traces never silently disappear); hard `deleteStudent` is the only thing that strips their marks. `gender: "male" | "female" | "other"`.
- **Teacher** — `{ id, employeeId, name, email, phone, departmentId, designation, qualification, joiningDate, isHod }`. `employeeId` unique and **locked once created**. `designation` is one of `DESIGNATIONS` (Professor / Associate Professor / Assistant Professor / Lecturer). **At most one `isHod` per department.**
- **AcademicTerm** — `{ id, name, startYear, endYear, parity: "odd" | "even" }`. A term is defined by its academic year + half: `endYear` is always `startYear + 1` and `name` is derived via `termLabel(startYear, parity)` (e.g. `termLabel(2026, "odd")` → `"2026-27 (Odd)"`); **unique on `(startYear, parity)`** (enforced in the term-switcher form). Teaching staff are assigned **per term**. The store tracks a `currentTermId` (the active term). **The whole app is scoped to the current term** — it is switched only via the global `TermSwitcher` in the header (`components/term-switcher.tsx`, admin/principal only; other roles see a read-only badge). Pages read `currentTermId` from the store; never add a per-page term selector. **Parity rule (soft-enforced):** only semesters matching the current term's parity are *in session* — `semesterInSession(semNumber, term)` from `lib/types.ts` is the single helper for this. Out-of-session semesters are hidden from staffing (Assignments) and from every attendance semester selector, their courses don't count as "unstaffed" (dashboard/semester-close), and `useOwnClasses()` drops them; students sitting in an out-of-session semester are *flagged, not blocked* (Promotions banner + "Out of session" cohort badge, amber hint in the student form). The store never rejects out-of-parity writes — the UI just never offers them.
- **CourseAssignment** — `{ id, courseId, teacherId, termId }`. Links a teacher to a course **for one term**. A course may have **multiple teachers per term** (from any department — cross-department teaching is allowed); unique on `(courseId, teacherId, termId)`. All of a course's teachers share the same attendance register. FKs `courseId → Course`, `teacherId → Teacher`, `termId → AcademicTerm`.
- **AttendanceSession** — `{ id, courseId, termId, date, period, records: AttendanceRecord[], markedBy?, markedAt? }`. One class **hour**; **unique on `(courseId, date, period)`** (`period` is the 1-based class hour), tagged with the term it was held in. `markedBy` (→ User) + `markedAt` are stamped by the store on creation. Any past date may be marked (the date input caps at today; the lock is the only time guard). The roster is *derived* (not stored): active, non-graduated students in the course's program whose `currentSemester` equals the course's semester number.
- **AttendanceRecord** — `{ studentId, status, originalStatus?, editedBy?, editedAt? }` where `status: AttendanceStatus = "present" | "absent" | "late" | "od"`. Owned by an `AttendanceSession`. `originalStatus` is set on the **first** correction only (preserving what was originally marked — a record with it renders a "corrected" dot in the register, visible to every viewer); `editedBy`/`editedAt` track the latest correction.
- **AuditEntry** — `{ id, at, userId, action, courseId?, termId?, date?, period?, studentId?, from?, to?, note? }`. Append-only log of every attendance mutation; `action` is one of `AUDIT_ACTIONS` (`mark | edit | remove-record | delete-session | lock | unlock`, labels in `AUDIT_ACTION_LABELS`). `remove-record` is one student dropped from a session that still exists — its own action rather than an `edit`, because removing a record also removes the `originalStatus` trail a correction leaves behind, so the log entry is the only remaining evidence. Entries are **never deleted** — they survive removal of whatever they reference. Written only by the store; never construct these in pages.
- **StudyMaterial** — `{ id, courseId, termId, title, description?, url, uploadedBy, uploadedAt }`. A **shared link, not a file**: nothing is stored server-side but the URL (validated as absolute `http(s)` on both sides), so there is no blob column, no size cap and no download endpoint. The card's thumbnail is derived from the URL **client-side, with no network calls of our own** by `lib/material-link.ts` (`linkPreview` → YouTube poster / branded icon / host favicon, plus `hostLabel` and `suggestTitle`); `components/materials/material-link-thumb.tsx` renders it and falls back to the icon when the remote image fails. `uploadedBy`/`uploadedAt` are stamped by the server. FKs `courseId → Course`, `termId → AcademicTerm` (the term when shared; display only), `uploadedBy → User`.
- **User** — `{ id, name, email, password, role, teacherId?, programId?, classSemester? }`. Login account; `password` is **write-only** (sent on create/change, never returned — the server stores a bcrypt hash, and responses are typed `Omit<User, "password">`). `email` unique (case-insensitive login match). `role` is one of `USER_ROLES` (`admin | principal | teacher | attendance-manager | hod | student-rep`; labels in `USER_ROLE_LABELS`). `teacherId → Teacher` is **required for `teacher` and `hod` roles, optional for `principal`** (a principal/HOD may also take classes) — an account's "own courses" and an HOD's department are derived from the linked Teacher record. `programId → Program` + `classSemester` are for `student-rep` only: the **class** the shared account belongs to; **one and only one rep account per `(programId, classSemester)`** (enforced in the user form).

**Attendance status semantics** (single source of truth in `lib/attendance.ts` — never recompute inline):

| Status | attended (numerator) | held (denominator) |
|---|---|---|
| present, late | ✅ | ✅ |
| absent | ❌ | ✅ |
| od | — excused — | ❌ |

`% = attended/held` (null when held = 0), **rounded to 2dp to match
`services/analytics.py::_pct` exactly** — the same student's percentage is computed here on the
register and student-detail pages and in SQL for `/attendance/summary`, so a rounding difference
shows up as one page calling a student eligible and another calling them a defaulter. Round only
for display, never before a threshold comparison. `lib/attendance.ts` exports `ATTENDANCE_STATUSES`/`STATUS_META` (label, short code, badge colour, the two flags), `tally(statuses)`, `pct(attended, held)` (drives eligibility), `pctColor(p, threshold?)` (the shared text-color helper for % cells — use it instead of inline ternaries), `classesNeeded(attended, held, threshold)`, and `DEFAULT_MIN_ATTENDANCE = 75`. `lib/export.ts` exports `toCsv()` + `downloadCsv()` for client-side CSV downloads.

---

## Data layer (`lib/queries/` + `lib/api.ts`)

State comes from the **API via TanStack Query**, not a local store. Providers mount in
`app/providers.tsx`: `QueryProvider` → `AuthProvider` → `AuthGate`. Every page/component reads with
a query hook and writes with a mutation hook; **the backend enforces all rules** (cascades,
single-HOD, correction diffing, audit stamping, lock guard, uniqueness) — the client just calls and
lets the affected queries invalidate. Responses are camelCase and already match `lib/types.ts`.

- **`lib/api.ts`** — a single **axios** instance (`http`) owns the cross-cutting HTTP concerns via
  interceptors: bearer-token injection, error normalisation to `ApiError { status, detail }`, and
  **401 clears the token and drops to the login screen**. `304` counts as success (`validateStatus`)
  so the backend's ETag path works. A 401 drops the session only if the rejected request carried
  the token still stored (so a password change's token rotation survives in-flight requests), and
  never for `/auth/login`, whose 401 is a wrong password. Helpers
  `apiGet/apiPost/apiPut/apiPatch/apiDelete` resolve to the response body. `errMsg(err)` → a
  toast string. `qs()` builds query strings, dropping empty values and repeating array keys
  (`?ids=a&ids=b`, which is what FastAPI expects). `Page<T>` is the shared paginated envelope.
- **`lib/auth-provider.tsx`** — `useAuthSession()` gives `{ token, initialized, login, logout }`.
  JWT lives in `localStorage` (`scas-erp-token`), the **only** thing kept client-side.
- **`lib/queries/<domain>.ts`** — hooks per domain. Map from the old store methods:
  - reads: `useDepartments/usePrograms/useProgram(id)/useSemesters(programId)/useCourses` (flat
    global lookup) `/useStudents(filters)/useStudent(id)/useTeachers/useTeacher(id)/useTerms/
    useAssignments(termId)/useAttendance(filters)/useRoster(courseId)/useAudit(filters)/
    useMaterials(filters)/useUsers(filters)` (admin, paginated) `/useUserDirectory` (id→name, any role) `/useSettings`
    (`currentTermId` + `lockDate` — the term/lock globals that used to be store state).
  - writes (all return a mutation; call `.mutateAsync(...)`, wrap in try/catch + `toast`):
    `useCreate/Update/Delete*` per entity, `useToggleStudentActive/usePromoteStudents/
    useGraduateStudents`, `useSetHod`, `useAddSemester/AddCourse/DeleteSemester/DeleteCourse`,
    `useAddTerm/useSetCurrentTerm`, `useAssignTeacher/useUnassignTeacher`, `useSaveAttendance/
    useSetAttendanceStatus/useDeleteSession`, `useSetLockDate`, `useCreateMaterial/
    useDeleteMaterial` (materials are links — there is no upload or download helper).
- Query keys are centralised in `lib/queries/keys.ts` (`qk`); mutations `invalidateQueries` by prefix
  (e.g. `["students"]` refreshes list + detail; deletes that cascade widely call
  `invalidateQueries()` with no key). Filter objects are **part of the key**, so each
  filter/page combination caches separately instead of clobbering one shared entry.

### Fetching rules (the app runs against ~4.8k students / 4M attendance records)

**Never fetch a whole table to compute something.** The dashboard once called `useAttendance({})` —
every session with every record, ~385 MB of JSON per load. The server aggregates now; the client
asks a question and renders the answer.

- **Paginated lists return `Page<T>`** (`{items, total, page, pageSize, totalPages}`), so read
  `data?.items ?? []`, not `data ?? []`. Paginated: `useStudents`, `useTeachers`, `useAudit`,
  `useMaterials`, `useAttendance`, `useUsers`. All take `{ page, pageSize, search, …filters }` and **filter,
  search and sort server-side** — never fetch a page and then `.filter()` it.
- **`placeholderData: keepPreviousData`** on every paginated hook, so paging/searching keeps the
  current rows on screen instead of flashing empty.
- **Aggregate hooks** replace client-side maths: `useAttendanceSummary` (per-student %, paginated,
  plus whole-set `totals`), `useStudentBreakdown` (per-course, one student — fetched lazily only for
  expanded rows), `useRedFlags`, `useDashboardStats`, `useUnstaffedCourses`, `useShortfallCount`.
- **Bounded-by-design reads stay unpaged** and say so: `useRegister` / `useClassRoster` /
  `useSessionMonths` (one class), `useTeacherOptions` (~100 staff), `useHods` (one per department),
  `useLockHistory`. `useTeacherOptions` is deliberately separate from `useTeachers` so unbounding a
  list is always an explicit choice.
- **Resolve names, don't download tables.** `useStudentLookup(ids)` resolves just the ids on screen
  (the audit log); `useRollNumbers()` backs the bulk-upload duplicate check and is `enabled` only
  while that dialog is open. Client-side uniqueness pre-checks were dropped — the server's 409 is
  authoritative and already surfaces as a toast.
- **`STALE` tiers** (`lib/query-provider.tsx`) pick a `staleTime` by how often data really changes:
  `static` (30 min — terms, courses, departments, directory), `reference` (5 min — programs,
  semesters, teachers), `standard` (1 min), `live` (15 s — attendance, audit, dashboard).
  `refetchOnMount` stays at its default: it refetches on mount **only stale or invalidated**
  data, so the tiers are what stop double-requesting. It was once set to `false`, which meant
  a mutation's invalidation never reached a page that wasn't on screen — save attendance, open
  the summary, see the old numbers. Mutations must invalidate every key they affect
  (`["stats"]` and `["roster"]` are the easy ones to forget); a single-cell register PATCH writes
  the returned session into the cache (`setQueriesData`) instead of refetching the matrix.

### Render rules

- **Debounce search** with `useDebouncedValue` — the input stays controlled and instant, only the
  request waits. Every keystroke was otherwise a request *and* a new cache entry.
- **Reset pagination with `usePagination(filterKey)`**, which adjusts state *during render* when the
  filter key changes. Doing it in a `useEffect` renders the stale page then immediately re-renders
  (and trips `react-hooks/set-state-in-effect`).
- **Memoise table rows.** Long tables extract a `memo`-wrapped row component
  (`components/students/student-row.tsx`) fed by `useCallback`-stable handlers and pre-resolved
  display strings — otherwise a keystroke in the search box re-renders every row and its dropdown.
  The memo only holds if the callbacks are stable, so both halves are required.
- **Every page shows a skeleton on first load**, never its empty state — an empty
  table while a fetch is in flight reads as "no data". Take `isLoading` from the query
  that owns the main list and render `components/ui/table-skeleton.tsx`
  (`TableRowsSkeleton`) inside `<TableBody>`, or one of
  `components/ui/card-skeleton.tsx`'s shapes (`CardGridSkeleton`, `StatTilesSkeleton`,
  `ListCardSkeleton`, `DetailPageSkeleton`) for card/checklist/detail layouts. Keep the
  existing `· updating…` suffix for background refetches — that covers a different case.
- **Skeletons are for first load; spinners are for work on data that already exists.**
  `components/ui/spinner.tsx` is the indeterminate indicator, and `<Button loading>`
  is the normal way to reach it — it renders the spinner, disables the button and sets
  `aria-busy`. Prefer `loading={mutation.isPending}` over a bare `disabled={pending}`,
  which greys out with no explanation. `AlertDialogAction` forwards to `Button`, so
  destructive/bulk confirms take `loading` too.
  There are deliberately **no `app/**/loading.tsx` files**: every page is a Client
  Component fetching through TanStack Query, so a route-level Suspense boundary resolves
  before any data exists.
- **Beware `= []` defaults on query data**: they create a fresh array each render while loading,
  which silently defeats any `useMemo` depending on it. Use a module-level constant
  (`?? NO_TEACHERS`) where the value feeds a memo.

**Behavioural notes vs. the old sandbox** (now server-side, so the client just surfaces the result):
cascading deletes (dept → programs → semesters → courses → assignments → attendance → materials;
teachers/students **orphan** with null dept/program), single-HOD demotion, `saveAttendance` upsert on
`(courseId, date, period)` with correction diffing (`originalStatus` set on first change only) and
audit stamping, the lock guard (`is_locked_for`: date ≤ lockDate unless the role has `overrideLock`),
one-rep-per-class, can't-delete-self. Add/update payloads are `Omit<T,"id">`; program create carries
`semesterCount` (the backend seeds semesters 1..N). Ids come from the backend.

**Seed data** lives in the **backend** (`backend-erp-fastapi/seed_production.py`) — the **real
college**: 13 departments, 19 programs with semesters, 43 real teachers (12 HODs), current term
`2026-2027 (Odd)`, plus login accounts (teacher/hod/class-rep, and one each of principal/admin when
the database has none) with randomly generated passwords
written to a gitignored CSV. The old demo seeds (`seed.py`/`seed_large.py`, deterministic demo
stories, well-known passwords) were **deleted**. No students/courses are seeded — real rosters are
entered through the app. `reset_db.py` (dev-only) wipes back to a single admin.

---

## Auth & roles (`lib/permissions.ts`)

**Real JWT auth.** `LoginPage` calls `AuthProvider.login()` → `POST /auth/login`; the token is stored
and `GET /auth/me` supplies the user + derived scope. `useAuth()` composes `useMe()` +
`useAssignments()` and keeps its old public shape — `{ user, role, teacher, departmentId, classScope,
can, ownCourseIds(termId) }` — so pages are unchanged; `roleCapabilities`/`isPathAllowed`/`homePath`
stay pure. `AuthGate` in `app/providers.tsx`: not `initialized` → loading; no token → `LoginPage`;
token but `/auth/me` pending → loading; `/auth/me` 401 → back to `LoginPage`; disallowed route →
`router.replace(homePath(role))`. The sidebar filters nav with the same `isPathAllowed`. **Never check
roles inline in pages** — read capability flags from `useAuth()`.

> **`isPathAllowed` is UI, not security.** Read scoping is enforced server-side by
> `services/scope.py` off a `view_scope` capability (admin/principal/attendance-manager → the
> college, hod → their department, teacher → their assigned courses this term, student-rep → their
> one class). Until that existed, routing was the *only* thing scoping a role, and a class-rep
> login could reach any class's register by changing `courseId`. Reads outside scope now 403 or
> come back filtered — so a page that offers a class the role can't reach will fail at the API, and
> that's the layer to fix, not the guard to work around.

| Role | Routes | Capabilities |
| --- | --- | --- |
| `admin` | everything + `/users` (home `/`) | all: `manageUsers`, `manageAcademics`, `markScope: "all"`, edit/delete attendance, `overrideLock`, `viewAudit`, `lockAttendance` |
| `principal` | everything except `/users`, `/attendance/sessions` and `/attendance/audit*` (home `/`) | `manageAcademics` + `markScope: "all"` (may take any class) + `materialScope: "all"`/`manageAllMaterials`. **No correction or oversight rights** — no `editAttendance`/`deleteAttendance`/`overrideLock`/`viewAudit`/`lockAttendance`; tamper-correction is the administrator's alone. Still runs `/semester-close`, where the "Freeze the records" step shows status but has no action button. May optionally link a teacher record (a principal who also teaches). |
| `teacher` | attendance pages (**not** `/attendance/audit` or `/attendance/sessions`) + `/materials` (home `/attendance`) | `markScope: "own"` — mark attendance for **own assigned courses** (via `ownCourseIds(termId)`), **first-time only** — once a session exists Save is blocked; no edit/delete; may mark **any past date** (never future — the date input caps at today) but is **hard-blocked for dates ≤ `lockDate`**. **Class selection is cards-only**: on Mark/Register the `MyClassesPicker` cards replace the Program → Semester → Course selects; on `/attendance/summary` class chips replace the program/semester selects and they see **only students of the classes they teach this term**. `materialScope: "own"` — upload study materials to own courses. |
| `attendance-manager` | attendance pages only, **not** `/attendance/audit` (home `/attendance`) | `markScope: "all"` + edit/delete attendance college-wide (inline cell editing on the Register page **and** per-session on `/attendance/sessions`) + `overrideLock` (can correct even locked dates); no academics CRUD. Every correction they make is stamped and logged. |
| `hod` | dashboard (dept-scoped)/students/teachers/programs/attendance (**not** `/attendance/audit` or `/attendance/sessions`)/materials (home `/`) | viewer **locked to own department** (`departmentId` from the linked Teacher); dept filters preset + disabled, all mutation UI hidden — **except** `markScope: "own"`: an HOD also teaches, so they can take **first-time** attendance for their own assigned courses (still no edit/delete). `materialScope: "own"` for their own courses. |
| `student-rep` | `/attendance/register` + `/attendance/summary` + `/materials` (home `/attendance/register`) | **one shared, read-only login per class** — the whole class uses the same account. `markScope: "none"`, zero write access; **locked to their own class** (`classScope` from `useAuth()`): Register/Summary show a static class label + course/month selects only, no program/semester browsing. On `/materials`: download-only view of the class's courses. |

Capability `markScope: "all" | "own" | "none"` — who may create a new attendance session. `"own"` applies to **any account with a linked `teacherId`** (`useAuth().ownCourseIds` works for every role). Attendance page/register scoping for HODs is the **union** of their department's programs and programs where they teach (cross-department teaching).

Integrity capabilities: `overrideLock` (admin/att-mgr — may still edit/delete attendance for dates ≤ `lockDate`, with an amber "editing frozen records" banner and full auditing; everyone else is hard-blocked server-side), `viewAudit` + `lockAttendance` (**admin only**). There is **no backdating concept** — any role may mark any past date (never future) as long as it isn't locked. `/attendance/audit` (a prefix match, so it also covers `/attendance/audit/log`) is **explicitly excluded** from the `/attendance` prefix grant for teacher/att-mgr/hod in `isPathAllowed`; `/attendance/sessions` is likewise excluded for teacher/hod **and principal** (session management is admin/att-mgr only — everyone else views saved attendance in the Register). `lib/permissions.ts` also exports the pure `roleCapabilities(role)` lookup (used by the store's lock guard).

Material capabilities: `materialScope: "all" | "own" | "none"` — who may share study materials (admin/principal "all", teacher/hod "own", att-mgr/rep "none") — and `manageAllMaterials` (admin/principal: delete anyone's; uploaders can always delete their own — the page checks `uploadedBy === user.id`).

The login page shows **no demo-account shortcuts**, and there are no demo accounts anymore — all logins are real accounts created by `seed_production.py` (random passwords, distributed via the credentials CSV) or through `/users`.

**Account management** is `admin` + `principal`, minus one hole: `lib/permissions.ts::canManageRole(actor, target)` returns false for a non-admin acting on an `admin` account, mirroring the server guard. Use it anywhere the UI offers to create/edit/delete an account — `/users` hides the row actions and filters the role dropdown through it. **Change password** lives in the sidebar account menu for every role except `student-rep` (shared class logins).

Gating pattern in pages: `const { can, role, departmentId } = useAuth()`, then wrap mutation UI in `{can.manageAcademics && …}` / `{can.deleteAttendance && …}`, and for HOD compute `lockedDept = role === "hod" ? departmentId : null` to preset+disable department filters. The attendance page derives `canMarkHere = can.markScope === "all" || (can.markScope === "own" && ownIds.has(courseId))` and `canSave = !lockBlocks && (existingSession ? can.editAttendance : canMarkHere)` where `lockBlocks = dateLocked && !can.overrideLock`. Lock-sensitive UI uses the same shape everywhere: `locked && !can.overrideLock ⇒ read-only`.

## UI components reference

### `SelectField` (`components/select-field.tsx`)
The standard single-select control for all dropdowns in form dialogs. Wraps `Combobox` with a simpler API:
```tsx
<SelectField
  options={[{ value: "UG", label: "Undergraduate" }, ...]}
  value={draft.level}
  onValueChange={(v) => setDraft({ ...draft, level: v as ProgramLevel })}
  placeholder="Select level"
/>
```
Props: `options`, `value`, `onValueChange`, `placeholder?`, `searchPlaceholder?`, `emptyText?`, `disabled?`, `id?`, `className?`. Value is always a `string`; empty string = nothing selected.

### `Avatar` (`components/ui/avatar.tsx`)
Built on `@base-ui/react/avatar`. Exports: `Avatar` (`size?: "sm" | "default" | "lg"`), `AvatarImage`, `AvatarFallback`, `AvatarBadge` (dot overlay), `AvatarGroup` (overlapping row), `AvatarGroupCount` ("+N" bubble).

### `Progress` (`components/ui/progress.tsx`)
Built on `@base-ui/react/progress`. `Progress` (root) auto-renders its own track+indicator — put `ProgressLabel` and `ProgressValue` as children. `value={null}` = indeterminate. Override track height via a className selector, e.g. `[&_[data-slot=progress-track]]:h-2`.

### `InputGroup` (`components/ui/input-group.tsx`)
Compound component grouping an input with inline addons. Parts: `InputGroup` (outer wrapper), `InputGroupAddon` (`align?: "inline-start" | "inline-end" | "block-start" | "block-end"`), `InputGroupButton`, `InputGroupText`, `InputGroupInput`, `InputGroupTextarea`. Focus ring lives on `InputGroup`; inner controls have `ring-0`.

### `Combobox` (`components/ui/combobox.tsx`)
Full searchable dropdown built on `@base-ui/react`. Root needs `items` and `itemToStringLabel`. `ComboboxList` children must be `(itemId: string) => ReactNode` (not a JSX array). Use `SelectField` for simple single-select; reach for `Combobox` directly only for multi-select (`ComboboxChips`) or custom layouts.

---

## Module reference

- **Dashboard** (`/`) — header shows the **current academic term**; **4 stat cards** each linking to a route the viewer can reach (admin/principal: students, teachers, programs, **in shortfall `< 75%`**; HOD, dept-scoped: students, teachers, **marked today** → `/attendance/register`, shortfall — the shortfall count excludes left/graduated students). Admin/principal additionally get **one combined "This term" strip** (4 tiles: unstaffed courses + "Staff courses" action, sessions this term/today, corrections this week, lock state; "Open oversight" action → `/attendance/audit`; the unstaffed count covers **in-session courses only** via `semesterInSession`) and the **"Quick actions" card** (button grid: `DepartmentFormDialog`/`ProgramFormDialog`/`StudentFormDialog` openers + links to `/assignments`, `/attendance`, `/promotions`; gated on `manageAcademics`). No decorative widgets — the fake "Recent activity" feed, "By level"/"Programs by department" charts and the separate integrity strip were removed deliberately; don't re-add them. A **"Getting started" setup checklist** (ordered entry steps with done-states, `Progress` bar, dialog/link per row) renders **for admins only** (`can.manageUsers`) while a step is incomplete. **HODs additionally get a "My classes" card** (their own assigned courses via `useOwnClasses()`, linking to `/attendance`) — no strips, checklist or form dialogs.
- **Programs & Curriculum** (`/programs`, `/programs/[id]`) — table (name, code, department, level, semester count), **grouped by department by default** (`GroupBy` toggle: none / department / level; when grouped by department each group header has a "+ Program" ghost button pre-selecting that department). Header has a **"Departments" button** (admin/principal) opening `ManageDepartmentsDialog` — the department CRUD list (edit/delete + cascade-warning `AlertDialog` + `DepartmentFormDialog`); **there is no standalone departments page**. Create/edit dialog with department and level (`SelectField`), plus a **number-of-semesters** field (auto-generates semesters 1..N on create; on edit, increasing it appends missing semesters). Detail page is the **curriculum** view: lists **semesters** as `Collapsible` panels (chevron rotates on open) with each course's **Type** and credits; a single "Add course" `Dialog` is reused across all semesters via `courseSemesterId: string | null` state. (Teacher assignment lives on `/assignments`, not here.)
- **Students** (`/students`, `/students/[id]`) — list with a **search box** (name or roll number), **dependent filters** (department → program → semester) plus a **Status filter** (All / Active / Inactive / Graduated — active means `isActive && !graduated`), and **server-side pagination** (`PAGE_SIZE` constant in the page; filters reset to page 1 via `usePagination`). A **live result count sits directly under the filters** — the matching total plus the active filters spelled out (`53 students · BCA · Semester 3`) and a "Clear filters" button. The filter list is the point: a bare number answers nothing, and reading the cohort size shouldn't mean paging to the bottom. An HOD's department filter is preset and disabled, so it's excluded from both the clear action and the has-filters test. The pagination row below now shows only the range. Header links to `/promotions` (the Promotions page has no sidebar entry). Row actions: view, edit, activate/deactivate, delete. The **create/edit form** is sectioned into Identity / Contact / Academic / Guardian / Status; **roll number input is disabled when editing**; an amber hint (not a block) appears under Current semester when it doesn't match the current term's parity. Detail page shows a rounded initials badge (hand-rolled, not the `Avatar` component), active enrolment `Switch`, three info cards (Academic, Personal & Contact, Parent/Guardian), and an **Attendance card** (per-course Held · Attended · % with shortfall flags + an overall badge, computed via `lib/attendance`).
- **Teachers** (`/teachers`, `/teachers/[id]`) — list with a **department filter** and a **"HODs only"** switch; a row of **per-department HOD cards** at the top. Create/edit form (employee id locked on edit; designation `SelectField`; HOD switch with an inline amber "this will replace <current HOD>" warning). **"Assign as HOD"** row/detail action: if the department already has an HOD, an `AlertDialog` confirms the replacement by name.
- **Promotions** (`/promotions`) — **not in the sidebar** (reached from the Students header button and the Semester Close-Out checklist — it's a twice-a-year task). Pick a program (`SelectField`); active, non-graduated students are grouped into **cohorts by `currentSemester`**. Each cohort row offers **Promote to Sem N+1** (`promoteStudents`) and **Graduate** (`graduateStudents`), both confirmed via `AlertDialog`. The program's final semester is its highest defined `Semester.number`. No row-level selection — actions operate on the whole cohort. **Parity flags:** cohorts whose semester doesn't match the current term's parity get an amber **"Out of session" badge**, and an amber banner above the page counts all such students college-wide ("promote or graduate them so classes match the term") — flagged, never blocked.
- **Global term switcher** (header, `components/term-switcher.tsx`) — the **only** term control in the app. Admin/principal get a `SelectField` bound to `currentTermId` (`setCurrentTerm`) plus an "Add term" dialog: **start year input + read-only end year (`start + 1`) + Odd/Even `SelectField`** with a live derived-name preview; the form rejects duplicate `(startYear, parity)` and years outside 2000–2100, then `addTerm(startYear, parity)` → `setCurrentTerm` (the app switches to the new, empty term immediately). Every other role sees a read-only current-term `Badge`. Every term-scoped page below reads `currentTermId` from the store.
- **Teacher Assignments** (`/assignments`) — scoped to the **current term**. Pick a program; its **in-session semesters only** (parity match via `semesterInSession` — the header copy says why) are listed **grouped by semester**, each course showing its **assigned teachers as removable `Badge` chips** (X button → `unassignTeacher`) plus an "Add teacher…" `SelectField` (any teacher, any department; already-assigned ones excluded → `assignTeacher`). A **"Show only unassigned"** `Switch` and a coverage badge ("X of Y courses assigned", assigned = ≥1 teacher) reflect the current term. This is the only place teachers are assigned to courses.
- **Mark attendance** (`/attendance`) — marking **only**; viewing/correcting saved sessions lives on `/attendance/sessions`. Cascading **Program → Semester → Course** (in-session semesters only) + **Period** (1–8) + **date** (defaults to today; capped at today for everyone — any past date is fine unless locked), all against the current term. A **"My classes" picker** (`MyClassesPicker` from `components/attendance/my-classes.tsx`, any account with own courses) shows one card per assigned course — deliberately **not** a daily to-do list (there is no timetable, so no "Not marked" nag; a subtle "Today ✓" appears only once today's session is saved) — one tap prefills the selectors. **For teachers the cards are the only selector** — the Program/Semester/Course selects are hidden (Period + Date remain). The roster is the derived class list (see `AttendanceSession`); each student has a row of **4 roll-call status chips** (tap to set — P/A/L/OD, default present), with "All present / All absent" shortcuts and a live present-equivalent count. Shows the current term's assigned teacher(s) and an **Overall %** per student (via `lib/attendance`). **Save** upserts the `(course, date, period)` session tagged with the current term (gated by `canMarkHere`/`canSave`; an amber banner appears for locked dates — blocking for teachers/HODs, "you're editing frozen records" for `overrideLock` roles). Header links to Sessions (only for roles allowed there) + Register + Summary.
- **Correct Attendance** (`/attendance/sessions`, admin/att-mgr only) — session management: unscoped Program → Semester → Course selectors (in-session semesters only), then a table of the course's current-term sessions (`date · P{n}`, marked-by name, lock icon, present/absent counts). **Open** raises a **dialog** (`components/attendance/session-roster-dialog.tsx`, driven by the page's `selectedId`) holding the session's roster: each record renders the 4 status chips writing via `setAttendanceStatus` (corrections — amber dot + hover title when `originalStatus` is set; left/graduated students carry a "Left"/"Graduated" badge). Both viewer roles have `overrideLock`, so locked sessions stay editable — the lock icon/"Locked" badge keeps the freeze visible. **Delete** per session behind an `AlertDialog` (deleting the open session clears `selectedId`, which closes the dialog). Principals/teachers/HODs/reps can't reach it (`isPathAllowed`) — they view saved attendance in the Register.
- **Attendance Register** (`/attendance/register`) — pick the class (**admin/principal/att-mgr/HOD**: program + semester + course selects, in-session semesters only; **teacher**: `MyClassesPicker` cards; **student-rep**: locked to their class — static class label + course select) **+ month** (current-term sessions only; month options derived from the scoped sessions' `date.slice(0,7)`; "All months" default; filtering scopes the matrix, the per-student tallies, the CSV — filename gains a `-YYYY-MM` suffix — and the print title; resets to "all" when the global term or class selection changes); renders the classic **students × sessions matrix** (columns are `MM-DD P{n}`, cells the colored status short-code) with trailing Att · Held · % per student and a status legend. The row set is **current class members ∪ anyone with saved marks in the scoped sessions** — students who left or graduated keep their rows, tagged with a "Left"/"Graduated" badge (and a Status column in the CSV); history never silently disappears. **Corrected cells carry an amber corner dot** (record has `originalStatus`) with a hover `title` showing original → current, editor and date — **visible to every viewer, including student reps** (this is the deterrent). For `editAttendance` roles **each cell is click-to-edit** (locked dates stay editable for `overrideLock` roles): a `DropdownMenu` lists the 4 statuses and writes via `setAttendanceStatus` (corrections can also be made per-session on `/attendance/sessions`). **Export CSV** + **Print** (sticky first column, horizontal scroll).
- **Attendance Summary** (`/attendance/summary`) — current-term sessions only; **teachers see only their own classes' students**, picked via **class chips** (one per `(programId, semester)` pair of their assigned courses + "All my classes"); **student-reps are locked to their class** (static label, no selects); other roles filter by program/semester (in-session semesters only). All roles get name/roll search and a **"Defaulters only"** switch. There is **no minimum-attendance input**: the college requirement is a fixed **75%** (`DEFAULT_MIN_ATTENDANCE`), so it is neither asked for nor given a filter slot of its own — it is simply stated once in the result line above the table ("N detained (< 75%)"), which is enough. Don't re-add it as a field; making it adjustable per viewer is what let two pages disagree about who is detained. Aggregates each student across scoped sessions via `lib/attendance`: Held · Attended · Overall % (**shows `origPct → pct` in amber when corrections changed it**, with a `·N✎` edit count) · **Eligible/Detained** badge (driven by the raw %) · **Need**; expand a row for the per-course breakdown (same correction deltas). Students who **left or graduated** keep their rows while they have saved marks — tagged "Left"/"Graduated" in place of the eligibility badge and excluded from the Defaulters filter and detained count. **Export CSV** — deliberately **detailed**: 17 columns covering roll/name/program/semester/enrolment status, held/attended/**absent**, %, the full **as-marked trio** (held, attended, %) beside the current one plus the correction count, eligibility, classes needed, and the threshold + term stamped on **every row** so a forwarded or re-filtered sheet still says what it is. The as-marked columns ship alongside the current ones because the *gap between them* is the tamper-evidence signal — exporting one without the other makes corrections invisible again. Filename carries the class and term (`attendance-summary-bca-sem3-2026-odd.csv`). The export re-fetches the whole filtered set at 200/page rather than holding every row in memory. Plus **Print** (desktop only).
- **Attendance Oversight** (`/attendance/audit`, admin only) — the oversight home, deliberately split in two pages so neither is overwhelming. This page holds **"Warning signs"** (2 red-flag cards: students passing only because of corrections — as-marked % < 75, current ≥ 75 — and corrections per user) and **"Freeze records"** (a full-width lock card: date picker + Lock/Unlock behind `AlertDialog`; copy explains the lock freezes teachers/HODs while manager corrections stay possible; shows the **latest lock event** — who/when — plus a **lock history list** of all `lock`/`unlock` audit entries; the lock state itself is audited). A header button links to the log page.
- **Audit Log** (`/attendance/audit/log`, admin only — covered by the same `AUDIT_ROUTE` prefix exclusion) — the **audit log table** (newest first, scoped to the current term — entries with no `termId`, i.e. lock/unlock, always show — and filterable by action/user `SelectField`s) — when · who · action badge · student · course/class · from → to status chips · note. Has its own sidebar entry in the Oversight group; the Oversight entry uses `exact: true` so the two don't highlight together.
- **Study Materials** (`/materials`) — per-course **link** sharing, cards grouped by course (program · semester in the header). Role scoping: **teacher** sees own assigned courses (current term) and shares to them; **hod** sees own courses + department courses that have materials; **student-rep** sees their class's courses, open-only; **admin/principal** get Program → Semester filters (no program selected = only courses that already have materials) and can share/delete anywhere. Share via `MaterialShareDialog` (course `SelectField` limited to the uploader's allowed courses, a `type="url"` input with a live `MaterialLinkThumb` preview, title — defaulted from the link on blur via `suggestTitle`, never overwriting typed text — and an optional description). Each row: `MaterialLinkThumb`, title/description, `host · uploader · date`, term badge, **Open** (an `<a target="_blank" rel="noopener noreferrer">` rendered through `Button render={…} nativeButton={false}`) and **Delete** (own upload or `manageAllMaterials`) behind `AlertDialog`.
- **Semester Close-Out** (`/semester-close`, admin/principal only — guarded with `can.manageAcademics`) — the end-of-term checklist: **one card with 5 compact rows** (complete registers → lock → review shortfalls → promote/graduate → create & staff the next term), each a **binary done/pending** check icon + one-line detail + link button, **computed from store data only** (no writes; e.g. locked = `lockDate >= max session date of the term`, "next term" = a term ≠ current with zero sessions; the shortfall count excludes left/graduated students; the next-term staffing target counts only courses in session for **that term's** parity). The **first unfinished row is highlighted** (accent tint + "Do this next" badge + default-variant button) so non-technical users know where to start. Deliberately lightweight — no progress bar, no per-step cards, no three-way statuses. In the sidebar's Oversight group.
- **User Accounts** (`/users`, admin only) — table of login accounts (name, email, role badge, linked teacher) with create/edit/delete via `UserFormDialog`, plus **debounced name/email search, a role filter and pagination — all server-side** (`GET /users` returns `Page<UserResponse>`; the role filter lists **every** role including `admin` — it narrows a read, and a principal already sees admin rows unfiltered. `canManageRole` gates writes and belongs on the row actions and the dialog's role list, not here). Role `SelectField`; picking `teacher`/`hod` reveals a required teacher `SelectField` (HOD accounts list only `isHod` teachers); picking `principal` reveals an optional one (a principal who also teaches); picking `student-rep` reveals required program + semester selects. **Email uniqueness and one-account-per-class are server-side only** — the dialog's client-side pre-checks were dropped when the list was paginated (there is no longer a full account list to scan, and the API's 409 already surfaces as a toast). You can't delete your own account. The login screen itself is `components/login-page.tsx` (email/password form + one-click demo accounts).

---

## Production / scaling architecture (500-concurrent-user pass)

A second pass beyond the fetching/render rules above, aimed at real deployment and
production-grade error handling (see the backend CLAUDE.md's matching section, and the root
CLAUDE.md's map, for the other half):

- **Error boundaries**: `app/error.tsx` (catches render errors below the root layout — "Something
  went wrong" + a retry button wired to Next 16's `unstable_retry`) and `app/global-error.tsx`
  (catches errors in the root layout itself; renders its own `<html>/<body>` and imports
  `globals.css` directly since it replaces `app/layout.tsx` entirely when active — don't assume
  `Providers`/auth context are available there). Both route through `lib/error-reporting.ts`'s
  `reportError()`, the single seam to Sentry — call that, not `console.error`/`Sentry.captureException`
  directly, if you ever need to report an error from somewhere else.
- **Sentry**, both sides (`@sentry/nextjs`): `instrumentation-client.ts` (client init +
  `onRouterTransitionStart` for navigation instrumentation), `sentry.server.config.ts` /
  `sentry.edge.config.ts` (loaded via `instrumentation.ts`'s `register()`, keyed on
  `NEXT_RUNTIME`). All three read `NEXT_PUBLIC_SENTRY_DSN` — empty (local dev default, see
  `.env.example`) means `Sentry.init` runs with no DSN and every capture call is a silent no-op, so
  there's no separate on/off flag anywhere. `next.config.ts` wraps the config in
  `withSentryConfig(...)` for source-map upload — `org`/`project`/`authToken` are unset until a
  real Sentry project exists, and the plugin skips the upload step gracefully (a build warning, not
  a failure) when they're missing.
- **`output: "standalone"`** in `next.config.ts` — required for the Docker image
  (`frontend-erp-react/Dockerfile`), which copies only `.next/standalone` + `.next/static` +
  `public/` rather than the full `node_modules`.
- **`NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SENTRY_DSN` are baked in at Docker *build* time**, not
  read at container start (Next.js inlines `NEXT_PUBLIC_*` into the client bundle when it
  compiles) — passed as Docker build args in `docker-compose.yml`. Changing either requires
  `docker compose build web` again, not just a restart; see the root `DEPLOY.md`.
- **Tests**: Vitest + React Testing Library (`lib/*.test.ts`, 57 tests): attendance maths,
  the permission matrix, `lib/api.ts`'s 401 handling (a rotated token survives an in-flight
  401 on the old one; a wrong password is not "session expired"), CSV export (formula-injection
  guard, BOM) and `lib/date.ts::todayLocal`. Playwright e2e lives in `tests/e2e/`
  (`playwright.config.ts`; `.github/workflows/e2e.yml`, manually dispatched against the Docker
  stack). `npm run test` (`vitest run`); `.github/workflows/ci.yml` (repo root) runs it alongside
  lint/typecheck/build on every push.
- **"Today" is `lib/date.ts::todayLocal()`**, never `toISOString().slice(0, 10)` (the UTC date —
  yesterday for IST until 05:30).
- **A failed main query renders `components/query-error.tsx`**, not the empty state — a 403 or 500
  shown as "No students match your filters" sends people hunting for missing data.

## Patterns to follow when extending

1. **New entity/field?** Add it to the **backend first** (model → schema → service → router, plus a migration), then the shared type in `lib/types.ts`, a `lib/queries/<entity>.ts` hook module (register in the barrel + `keys.ts`), and consume it. Cascade/invariant logic lives **server-side**, not on the client.
2. **New screen?** Follow the per-module layout: list page + `[id]` detail + a `*-form-dialog.tsx`. Make pages `"use client"`. Use `PageHeader` for the title/description/action row. Read with a query hook (`const { data = [], isLoading } = useX()`); write with a mutation (`await m.mutateAsync(...)`).
3. **Forms:** controlled local state, validate on submit, `await mutation.mutateAsync(input)` in a try/catch, surface errors with `toast.error(errMsg(err))` (server 409/403/422 flow through), success with `toast.success(...)`, then close the dialog. Use `SelectField` for all dropdown fields. (Client-side uniqueness checks are a UX nicety; the server is authoritative.)
4. **Destructive actions:** confirm with `AlertDialog`. Per-row menus use `DropdownMenu` with a `DropdownMenuTrigger render={<Button .../>}`.
5. **Linking from a button:** `<Button render={<Link href=… />} nativeButton={false}>`.
6. **Single dialog reused per row:** use a `fooId: string | null` state — dialog is open when non-null, closes by setting it to `null` — instead of mounting one `Dialog` per row.
7. **Collapsible with animated chevron:** `<CollapsibleTrigger className="group">` + `<ChevronRight className="group-data-[panel-open]:rotate-90 transition-transform" />`.
8. **Pre-selecting in a dialog:** `ProgramFormDialog` accepts `defaultDepartmentId` to pre-select a department (used from the Departments card page).
9. **Printable report pages:** mark app chrome (headers, buttons, filters — anything not part of the printed output) with `data-print-hide`; the `@media print` rule in `app/globals.css` hides those elements plus the sidebar. Used by Attendance Register and Summary's "Print" buttons (`window.print()`). The Print button itself is `max-md:hidden` — a phone can't produce the wide report it lays out.
10. **Compact cells inside a stacked table:** `<Table variant="stacked">` gives every labelled cell its own full-width row on mobile, which turns a number-heavy table into one very tall column. Add `data-compact` (half width) or `data-compact="third"` to those cells so they share a line, and `data-compact-end` on the last of a group to restore the divider. The rule lives in `app/globals.css` beside the stacked-table block and **repeats `[data-label]` in its selector on purpose** — that lifts specificity to match the `display: block` rule above it, which would otherwise win. Tailwind utilities on the cell can't do this: a single utility class loses to those attribute selectors. Used by Attendance Summary (Held/Attended/Overall three-up, Eligibility/Need two-up).
10. **Verify** with `npx tsc --noEmit` (fast) and/or `npm run build` before declaring done.
