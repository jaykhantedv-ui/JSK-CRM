import { expect, test } from '@playwright/test'

/**
 * Master Phase 1 smoke tests.
 *
 * They prove the application boots, that an unauthenticated visitor is sent to
 * the login screen from every protected route, and that there is no way to
 * register an account.
 *
 * **They do not sign anybody in, and they must not pretend to.** Signing in needs
 * Supabase Auth itself, which this environment cannot run (ADR-018) — its
 * container images are blocked by the egress policy. The fifteen required
 * scenarios (§19.3) arrive with the features they cover, against a real Supabase
 * project.
 */

const PROTECTED_ROUTES = ['/', '/today', '/dashboard', '/settings', '/accounts']

test('the login screen renders', async ({ page }) => {
  const response = await page.goto('/login')

  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'JSK CRM' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('there is no way to register an account', async ({ page }) => {
  await page.goto('/login')

  // §3.2 — no self-registration. Users are created by an OWNER or an ADMIN.
  await expect(page.getByRole('link', { name: /sign up|register|create account/i })).toHaveCount(0)
  await expect(page.getByText(/created by your owner or administrator/i)).toBeVisible()
})

for (const route of PROTECTED_ROUTES) {
  test(`an unauthenticated visitor to ${route} lands on the login screen`, async ({ page }) => {
    await page.goto(route)

    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })
}

test('a signed-out visitor is offered no application data', async ({ page }) => {
  await page.goto('/today')

  // The redirect is a convenience; row-level security is the control. Nothing
  // from the authenticated shell may render.
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
})
