import { expect, test } from "@playwright/test"

/**
 * The wired auth flow end-to-end: the login screen gate, a rejected password,
 * and a successful sign-in that actually stores a session. This is the seam the
 * unit suite can't cover — real HTTP to the backend, the token landing in
 * localStorage, and the app shell replacing the login screen.
 *
 * Requires the Dockerized stack up with a known admin password — see
 * playwright.config.ts for the exact commands.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@scascollege.ac.in"
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-pass"
const TOKEN_KEY = "scas-erp-token"

test("an unauthenticated visitor is shown the login screen", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()
  await expect(page.getByLabel("Email")).toBeVisible()
})

test("a wrong password is rejected and no session is stored", async ({ page }) => {
  await page.goto("/")
  await page.getByLabel("Email").fill(ADMIN_EMAIL)
  await page.getByLabel("Password").fill("definitely-not-the-password")
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page.getByText(/invalid email or password/i)).toBeVisible()
  const token = await page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)
  expect(token).toBeNull()
})

test("a valid admin login stores a session and leaves the login screen", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByLabel("Email").fill(ADMIN_EMAIL)
  await page.getByLabel("Password").fill(ADMIN_PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()

  // The login screen is gone…
  await expect(page.getByRole("button", { name: "Sign in" })).toBeHidden()
  await expect(page.getByLabel("Email")).toBeHidden()

  // …and a JWT was persisted — the concrete evidence the flow completed.
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY))
    .not.toBeNull()
})
