# End-to-end tests (Playwright)

These run against the **real Dockerized stack** (Postgres + API + web + Caddy),
not mocks — they exercise the wired auth flow and route guarding that the Vitest
unit suite (pure `lib/` logic) can't reach.

## Run locally

From the **repo root**, bring the stack up with a known admin password so the
tests can log in deterministically:

```bash
ADMIN_PASSWORD=e2e-admin-pass \
  docker compose -f docker-compose.local.yml up -d --build

# Wait until readiness returns 200:
curl -fsS http://localhost:8080/api/health/ready
```

Then from `frontend-erp-react/`:

```bash
npx playwright install chromium      # first time only (browser binary)
E2E_ADMIN_PASSWORD=e2e-admin-pass npm run test:e2e
# or: npm run test:e2e:ui   (interactive)
```

Env knobs (all optional, with sensible defaults):

| Var | Default | Meaning |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:8080` | Where the stack is served (Caddy) |
| `E2E_ADMIN_EMAIL` | `admin@scascollege.ac.in` | Seeded admin login |
| `E2E_ADMIN_PASSWORD` | `e2e-admin-pass` | Must match the `ADMIN_PASSWORD` the stack was started with |

## Status & next steps

`auth.spec.ts` covers the login gate, a rejected password, and a successful
sign-in that persists a session. Natural additions (each needs deterministic
test accounts provisioned via the API in a global-setup):

- mark attendance as a teacher, then correct it and see the audit trail;
- a `student-rep` is scoped out of another class's register (403 / empty);
- a disabled account is bounced to the login screen mid-session.

> First run against the stack to confirm selectors/timing before wiring the CI
> job to run on every push (see `.github/workflows/e2e.yml`, currently
> `workflow_dispatch`).
