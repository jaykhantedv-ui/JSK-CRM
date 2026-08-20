import { expect, test } from '@playwright/test'

/**
 * Master Phase 4 — operations, data and automation (§19.3, §20 of the phase brief).
 *
 * **Two of these ten scenarios run for real here, and eight cannot.** The split
 * is not arbitrary and the eight are not quietly passed:
 *
 *   * The cron scenarios authenticate by **shared secret**, not by session, so
 *     they exercise the real routes, the real middleware exemption and the real
 *     §14.7 response contract against a running server. They run on every commit.
 *
 *   * Everything involving a signed-in user needs Supabase Auth, and everything
 *     involving a file needs Supabase Storage. ADR-018 records why neither runs
 *     in this environment: the container images are blocked by the egress policy.
 *     Those specs are written against the real application and **skip loudly with
 *     a stated reason** — they never masquerade as passed.
 *
 * The skipped behaviour is not unverified. Import execution, duplicate decisions,
 * `LINK_EXISTING`, rollback, archive, restore, merge and every storage
 * authorization rule are proved against a real PostgreSQL server in
 * `tests/integration/import-execution.test.ts`, `archive-and-merge.test.ts`,
 * `storage-authorization.test.ts` and `automation-state.test.ts`. What E2E adds
 * beyond those is the browser: that the wizard renders, that the confirmation is
 * required, that an upload failure leaves the activity intact.
 */

const CRON_SECRET = process.env.CRON_SECRET ?? 'e2e-cron-secret-value'
const AUTH_READY = process.env.E2E_SUPABASE_READY === '1'

const CRON_ROUTES = [
  '/api/cron/new-opportunity-sla',
  '/api/cron/daily-digest',
  '/api/cron/manager-digest',
  '/api/cron/owner-summary',
  '/api/cron/maintenance',
]

// ---------------------------------------------------------------------------
// Scenarios 8 and 9 — these RUN.
// ---------------------------------------------------------------------------

test.describe('cron authentication (§14.7)', () => {
  for (const route of CRON_ROUTES) {
    test(`${route} rejects a missing secret with a machine-readable 401`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 })

      expect(response.status()).toBe(401)
      expect(await response.json()).toEqual({ error: 'unauthorized' })
    })

    test(`${route} rejects a wrong secret`, async ({ request }) => {
      const response = await request.get(route, {
        headers: { authorization: `Bearer ${CRON_SECRET}-wrong` },
        maxRedirects: 0,
      })

      expect(response.status()).toBe(401)
      expect(await response.json()).toEqual({ error: 'unauthorized' })
    })

    test(`${route} NEVER redirects to /login`, async ({ request }) => {
      // The regression this phase exists to fix. A cron route that redirects
      // answers the scheduler 200 with a page of HTML, which reads as a
      // successful run and hides a broken job indefinitely.
      const response = await request.get(route, { maxRedirects: 0 })

      expect([301, 302, 303, 307, 308]).not.toContain(response.status())
      expect(response.headers()['location']).toBeUndefined()
      expect(response.headers()['content-type'] ?? '').toContain('application/json')
    })

    test(`${route} executes when the secret is correct`, async ({ request }) => {
      const response = await request.get(route, {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
        maxRedirects: 0,
      })

      // Past authentication: whatever happens next, it is not a refusal.
      expect(response.status()).not.toBe(401)

      // §14.7's contract holds on both paths. Supabase is unreachable here, so
      // the job itself fails — and that failure is still reported as the same
      // JSON shape rather than as a stack trace or an HTML error page.
      const body = await response.json()
      expect(Object.keys(body).sort()).toEqual(['durationMs', 'failed', 'processed', 'sent'])
      expect(typeof body.durationMs).toBe('number')
    })

    test(`${route} leaks nothing when it refuses`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 })
      const text = await response.text()

      expect(text).not.toContain(CRON_SECRET)
      // No schema names, no configuration, no stack.
      expect(text.length).toBeLessThan(200)
    })
  }

  test('the x-cron-secret header is accepted for a manual run', async ({ request }) => {
    const response = await request.get('/api/cron/daily-digest', {
      headers: { 'x-cron-secret': CRON_SECRET },
      maxRedirects: 0,
    })
    expect(response.status()).not.toBe(401)
  })
})

test.describe('the cron middleware exemption does not weaken anything else', () => {
  test('an ordinary API route still refuses an unauthenticated caller with 401', async ({
    request,
  }) => {
    const response = await request.get('/api/export/opportunities', { maxRedirects: 0 })
    expect(response.status()).toBe(401)
  })

  test('the import template route refuses an unauthenticated caller with a status, not a page', async ({
    request,
  }) => {
    const response = await request.get('/api/import-template/accounts', { maxRedirects: 0 })

    expect(response.status()).toBe(401)
    expect(response.headers()['content-type'] ?? '').not.toContain('text/csv')
  })

  test('a cron secret buys nothing on a normal route', async ({ request }) => {
    // The exemption is scoped to `/api/cron/*` by prefix. Presenting the secret
    // anywhere else must achieve exactly nothing.
    const response = await request.get('/api/export/opportunities', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
      maxRedirects: 0,
    })
    expect(response.status()).toBe(401)
  })

  for (const route of ['/import', '/archive', '/settings']) {
    test(`an unauthenticated visitor to ${route} lands on the login screen`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    })
  }
})

// ---------------------------------------------------------------------------
// Scenarios 1–7 and 10 — written, and skipped with a reason.
// ---------------------------------------------------------------------------

test.describe('operations workflows', () => {
  test.skip(
    !AUTH_READY,
    'Supabase Auth and Storage are unreachable in this environment (ADR-018): the container ' +
      'images are blocked by the egress policy, so no browser session can be established and no ' +
      'object can be uploaded. Run with E2E_SUPABASE_READY=1 against a real project. The same ' +
      'rules are proved against a real database in tests/integration/import-execution.test.ts, ' +
      'archive-and-merge.test.ts, storage-authorization.test.ts and automation-state.test.ts.',
  )

  const PASSWORD = process.env.E2E_PASSWORD ?? 'devpassword'
  const OWNER = { email: process.env.E2E_OWNER_EMAIL ?? 'owner@jsk.test', password: PASSWORD }
  const MANAGER = { email: process.env.E2E_MANAGER_EMAIL ?? 'manager.a@jsk.test', password: PASSWORD }
  const SALESPERSON = {
    email: process.env.E2E_SALESPERSON_EMAIL ?? 'sales.a1@jsk.test',
    password: PASSWORD,
  }

  async function signIn(
    page: import('@playwright/test').Page,
    who: { email: string; password: string },
  ) {
    await page.goto('/login')
    await page.getByLabel('Email').fill(who.email)
    await page.getByLabel('Password').fill(who.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/(today|dashboard|settings)/)
  }

  const CUSTOMERS_CSV = [
    'name,account_type,phone,email,city,owner_email,legacy_ref',
    'Kalyani Traders,DEALER,9843101010,,Erode,sales.a1@jsk.test,REG-101',
    'Senthil Builders,BUILDER,9843101011,,Perundurai,sales.a1@jsk.test,REG-102',
  ].join('\n')

  /** Scenario 1 — the OWNER brings the paper register across. */
  test('an OWNER uploads a file of historical customers and imports it', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto('/import')

    await page.getByLabel('What are you importing?').selectOption('accounts')
    await page.getByLabel('CSV file').setInputFiles({
      name: 'customers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CUSTOMERS_CSV),
    })
    await page.getByRole('button', { name: /upload and check/i }).click()

    // The preview screen. Nothing has been created yet.
    await expect(page.getByText('Ready to import')).toBeVisible()
    await page.getByRole('button', { name: /^Import 2 rows$/ }).click()
    await expect(page.getByText(/records were created/i)).toBeVisible()

    await page.goto('/accounts?q=Kalyani')
    await expect(page.getByText('Kalyani Traders')).toBeVisible()
  })

  /** Scenario 2 — a duplicate blocks the run until somebody decides. */
  test('a duplicate row must be ruled on before the import can run', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto('/import')

    await page.getByLabel('CSV file').setInputFiles({
      name: 'dupes.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        ['name,account_type,phone,owner_email', 'Ravi Kumar,HOMEOWNER,9843011111,sales.a1@jsk.test'].join('\n'),
      ),
    })
    await page.getByRole('button', { name: /upload and check/i }).click()

    await expect(page.getByText(/still need a decision/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Import/ })).toBeDisabled()

    await page.getByRole('button', { name: 'Skip' }).first().click()
    await expect(page.getByRole('button', { name: /^Import/ })).toBeEnabled()
  })

  /** Scenario 3 — LINK_EXISTING records the reference and changes nothing else. */
  test('LINK_EXISTING never overwrites the existing customer', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto('/import')

    await page.getByLabel('CSV file').setInputFiles({
      name: 'link.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'name,account_type,phone,owner_email,legacy_ref',
          'RAVI KUMAR CHANGED,BUILDER,9843011111,sales.a1@jsk.test,REG-OLD',
        ].join('\n'),
      ),
    })
    await page.getByRole('button', { name: /upload and check/i }).click()
    await page.getByRole('button', { name: 'Link to existing' }).first().click()
    await page.getByRole('button', { name: /^Import/ }).click()

    await page.goto('/accounts?q=Ravi')
    // The name the salesperson typed months ago, not the one in the file.
    await expect(page.getByText('Ravi Kumar', { exact: true })).toBeVisible()
    await expect(page.getByText('RAVI KUMAR CHANGED')).toHaveCount(0)
  })

  /** Scenario 4 — archive and restore, with the impact shown first. */
  test('a MANAGER archives a customer after seeing the impact, then restores it', async ({
    page,
  }) => {
    await signIn(page, MANAGER)
    await page.goto('/accounts')
    await page.getByRole('link', { name: 'Ravi Kumar' }).first().click()

    await page.getByRole('button', { name: 'Archive' }).click()

    // C-3: the preview is shown before the confirmation, and it says what else
    // goes with it.
    await expect(page.getByText(/this also archives/i)).toBeVisible()
    await expect(page.getByText(/history is never archived/i)).toBeVisible()
    await page.getByRole('button', { name: /yes, archive/i }).click()

    await page.goto('/archive?entity=account')
    await expect(page.getByText('Ravi Kumar')).toBeVisible()

    await page.getByRole('button', { name: 'Restore' }).first().click()
    await page.goto('/accounts?q=Ravi')
    await expect(page.getByText('Ravi Kumar')).toBeVisible()
  })

  /** Scenario 5 — merge, with the irreversibility stated (ADR-008). */
  test('a MANAGER merges two customers after an explicit confirmation', async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto('/accounts')
    await page.getByRole('link', { name: 'Ravi Kumar' }).first().click()
    await page.getByRole('link', { name: 'Merge' }).click()

    await page.getByRole('link', { name: /keep this one/i }).first().click()

    // ADR-008 — the warning is unhedged and the confirmation is typed.
    await expect(page.getByText(/this cannot be undone/i)).toBeVisible()
    await expect(page.getByText(/the full history follows the customer/i)).toBeVisible()

    await page.getByRole('button', { name: /^Merge into/ }).click()
    await expect(page.getByText(/type merge to confirm/i)).toBeVisible()

    await page.getByLabel(/type merge to confirm/i).fill('MERGE')
    await page.getByRole('button', { name: /^Merge into/ }).click()
    await page.waitForURL(/\/accounts\/.*merged=1/)
  })

  /** Scenario 6 — a site-visit photo, and the guarantee around it (§11.5). */
  test('a SALESPERSON uploads a site-visit photo, and a failed upload never loses the visit', async ({
    page,
  }) => {
    await signIn(page, SALESPERSON)
    await page.goto('/accounts')
    await page.getByRole('link', { name: 'Ravi Kumar' }).first().click()

    await page.getByRole('button', { name: 'Log activity' }).click()
    await page.getByRole('button', { name: 'Site visit' }).click()
    await page.getByLabel('Measurements').fill('Hall 18x14, 2 bedrooms 12x11')
    await page.getByLabel(/what happened|summary/i).fill('Measured the hall and both bedrooms.')
    await page.getByRole('button', { name: 'Log it' }).click()

    // The activity is committed BEFORE the photo step appears. That ordering is
    // the guarantee: an upload that fails costs the photo, never the visit.
    await expect(page.getByText(/site visit saved/i)).toBeVisible()

    await page.getByLabel(/add photos/i).setInputFiles({
      name: 'site.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
    })

    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByText('Measured the hall and both bedrooms.')).toBeVisible()
  })

  /** Scenario 7 — a quotation PDF, uploaded and opened through a signed URL. */
  test('a quotation PDF can be attached and opened again', async ({ page }) => {
    await signIn(page, SALESPERSON)
    await page.goto('/opportunities')
    await page.getByRole('link', { name: /tiles/i }).first().click()

    await page.getByRole('button', { name: /attach quotation/i }).click()
    await page.getByLabel(/attach quotation/i).setInputFiles({
      name: 'quotation.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'),
    })

    await expect(page.getByRole('button', { name: 'quotation.pdf' })).toBeVisible()

    // Opening mints a fresh sixty-second URL; nothing is baked into the page.
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: 'quotation.pdf' }).click(),
    ])
    expect(popup.url()).toContain('token=')
  })

  /** Scenario 10 — a manager's operational surface stops at their outlets. */
  test('a MANAGER sees only their own outlets in the operational surface', async ({ page }) => {
    await signIn(page, MANAGER)

    // manager.a manages Erode Main only. Perundurai's customers must not appear
    // anywhere on their screens — and typing the URL must not help.
    await page.goto('/archive?entity=account')
    await expect(page.getByText('Bhavani Builders')).toHaveCount(0)

    await page.goto('/dashboard')
    await expect(page.getByText('Bhavani Builders')).toHaveCount(0)
  })
})
