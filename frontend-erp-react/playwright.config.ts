import { defineConfig, devices } from "@playwright/test"

/**
 * End-to-end tests, run against the *real* Dockerized stack — not a mock.
 *
 * Bring the stack up first (from the repo root) with a known admin password so
 * the tests can log in deterministically:
 *
 *   ADMIN_PASSWORD=e2e-admin-pass \
 *     docker compose -f docker-compose.local.yml up -d --build
 *   # wait until http://localhost:8080/api/health/ready returns 200
 *   E2E_ADMIN_PASSWORD=e2e-admin-pass npm run test:e2e
 *
 * These are deliberately separate from the Vitest unit suite (`*.test.ts`);
 * Playwright only picks up `tests/e2e/**` and only `*.spec.ts`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // The stack is external (docker compose), so there is no webServer here.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
})
