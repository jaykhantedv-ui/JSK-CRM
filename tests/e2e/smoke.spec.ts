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

const PROTECTED_ROUTES = [
  '/', '/today', '/dashboard', '/settings', '/accounts',
  // Master Phase 3 added a management surface. Every route on it is protected by
  // the same middleware, and an unauthenticated visitor must reach none of them.
  '/team', '/reports', '/reports/at-risk', '/reports/outlets', '/reports/targets',
]

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

test('the CSV export route gives a signed-out visitor no data', async ({ page }) => {
  // Attacked as an API call rather than through the UI (§19.4). The route must
  // never answer with a file to a caller it cannot identify — the check is
  // server-side in `export.service.ts`, not on the button.
  const response = await page.request.get('/api/export/opportunities')

  // 401 with a status line, not a 302 to the login page: a script downloading a
  // CSV would follow the redirect, receive HTML with a 200, and write it to a
  // `.csv` file believing it had data.
  expect(response.status()).toBe(401)
  expect(response.headers()['content-type'] ?? '').not.toContain('text/csv')
})
