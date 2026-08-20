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

test('the health probe answers without a session', async ({ page }) => {
  // Docker's HEALTHCHECK, systemd and deploy/health.sh all call this with no
  // cookie jar (§11). Behind the session middleware it answered 401 to every one
  // of them, so the container was marked unhealthy the moment it started and
  // restarted forever — a liveness probe that required you to be alive to pass
  // it. This test is here so that exemption cannot be quietly reverted.
  const response = await page.request.get('/api/health')

  // 503 is the healthy answer HERE: the smoke suite runs with no Supabase
  // reachable (ADR-018), and the probe is supposed to say so rather than
  // claim to be fine. What matters is that it ANSWERED — not 401, not a
  // redirect to /login.
  expect([200, 503]).toContain(response.status())

  const body = await response.json()
  expect(body).toHaveProperty('status')
  expect(body).toHaveProperty('checks.database.status')

  // A cached health check is a lie by the time it is read.
  expect(response.headers()['cache-control'] ?? '').toContain('no-store')

  // It must give an unauthenticated caller nothing to work with: no version, no
  // hostname, no row counts, no Postgres error text (§13).
  const text = JSON.stringify(body)
  expect(text).not.toMatch(/postgres|password|localhost|127\.0\.0\.1|supabase|stack/i)
})
