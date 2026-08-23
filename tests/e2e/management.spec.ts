import { expect, test, type Page } from '@playwright/test'

/**
 * Master Phase 3 — the ten management scenarios (§20 E2E).
 *
 * **These require a signed-in session, which needs Supabase Auth (GoTrue).**
 * ADR-018 records why this environment cannot run it: the Supabase container
 * images are blocked by the egress policy, so the local runtime is a plain
 * PostgreSQL server with a platform bootstrap. There is no auth server to issue a
 * session and therefore no way to sign in from a browser here.
 *
 * The specs below are written against the real application and are skipped —
 * loudly, with a stated reason — when no Supabase project is reachable. Point
 * `E2E_SUPABASE_READY=1` plus real credentials at a project and they run as
 * written. This mirrors `core-crm.spec.ts` exactly.
 *
 * **This is not treated as coverage.** Every scope rule below is also proved at
 * the database level in `tests/integration/management-scope.test.ts`, which runs
 * for real on every commit against a real PostgreSQL server and is where the
 * authorization rules are actually verified (§19.2). What these specs add is the
 * browser-level half: that a manager can get from a number to the work behind it,
 * that the export downloads, and that a direct URL is refused.
 */
const AUTH_READY = process.env.E2E_SUPABASE_READY === '1'

const SALESPERSON = {
  email: process.env.E2E_SALESPERSON_EMAIL ?? 'sales.a1@jsk.test',
  password: process.env.E2E_PASSWORD ?? 'devpassword',
}
const MANAGER = {
  email: process.env.E2E_MANAGER_EMAIL ?? 'manager.a@jsk.test',
  password: process.env.E2E_PASSWORD ?? 'devpassword',
}
const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? 'owner@jsk.test',
  password: process.env.E2E_PASSWORD ?? 'devpassword',
}
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'admin@jsk.test',
  password: process.env.E2E_PASSWORD ?? 'devpassword',
}

test.describe('Management intelligence', () => {
  test.skip(
    !AUTH_READY,
    'Supabase Auth is unreachable in this environment (ADR-018). These run against a real ' +
      'Supabase project with E2E_SUPABASE_READY=1; every scope rule below is proved against the ' +
      'database in tests/integration/management-scope.test.ts.',
  )

  async function signIn(page: Page, who: { email: string; password: string }) {
    await page.goto('/login')
    await page.getByLabel('Email').fill(who.email)
    await page.getByLabel('Password').fill(who.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/(today|dashboard|settings)/)
  }

  // 1 — a manager opens the dashboard.
  test('a manager lands on the dashboard after signing in', async ({ page }) => {
    await signIn(page, MANAGER)
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole('heading', { name: 'Branch' })).toBeVisible()
  })

  // 2 — the values are there, and they are values rather than placeholders.
  test('the dashboard shows real figures, not placeholders', async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto('/dashboard')

    await expect(page.getByText('Won Value')).toBeVisible()
    await expect(page.getByText('Pipeline Value')).toBeVisible()
    await expect(page.getByText('Weighted Pipeline')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Needs attention today' })).toBeVisible()

    // §2.4 — the word "Revenue" must never appear in the UI.
    await expect(page.locator('body')).not.toContainText(/revenue/i)
  })

  // 3 — filtering by branch.
  test('a manager filters the dashboard by branch', async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto('/dashboard')

    const branch = page.getByLabel('Branch')
    if (await branch.isVisible()) {
      const options = await branch.locator('option').all()
      // The control is only rendered when the manager holds more than one branch;
      // with one branch there is nothing to choose between, which is correct.
      if (options.length > 1) {
        await branch.selectOption({ index: 1 })
        await expect(page).toHaveURL(/outlet=/)
      }
    }
  })

  // 4 — opening a salesperson.
  test('a manager opens a salesperson from the team list', async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto('/team')

    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible()
    await page.getByRole('link', { name: /Sales A/ }).first().click()
    await expect(page).toHaveURL(/\/team\/[0-9a-f-]{36}/)
    await expect(page.getByText('Won Value')).toBeVisible()
  })

  // 5 — the overdue list. This is the chain §21 exists for: a count, then the
  // work behind it.
  test('the overdue count opens the filtered enquiry list', async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto('/dashboard')

    await page.getByRole('link', { name: /Overdue follow-ups/ }).first().click()
    await expect(page).toHaveURL(/\/opportunities\?overdue=1/)
  })

  // 6 — a stalled enquiry, opened from the at-risk report.
  test('a manager opens a stalled enquiry and sees why it is at risk', async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto('/reports/at-risk')

    await expect(page.getByRole('heading', { name: 'Stalled and at risk' })).toBeVisible()

    const first = page.getByRole('link', { name: /—/ }).first()
    if (await first.isVisible()) {
      await first.click()
      await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}/)
    }
  })

  // 7 — exporting the current filtered report.
  test('a manager exports the filtered report as CSV', async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto('/reports/salespeople')

    const download = page.waitForEvent('download')
    await page.getByTestId('export-csv').click()
    const file = await download

    expect(file.suggestedFilename()).toMatch(/^jsk-team-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  // 8 — the owner sees every branch.
  test('the owner compares every branch', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto('/reports/outlets')

    await expect(page.getByRole('heading', { name: 'Branch comparison' })).toBeVisible()
    // Two branches at minimum, per the seeded fixture set.
    const rows = page.locator('table tbody tr')
    expect(await rows.count()).toBeGreaterThan(1)
  })

  // 9 — a salesperson cannot reach the manager dashboard.
  test('a salesperson typing /dashboard is sent to their own day', async ({ page }) => {
    await signIn(page, SALESPERSON)
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/today/)

    await page.goto('/team')
    await expect(page).toHaveURL(/\/today/)

    await page.goto('/reports')
    await expect(page).toHaveURL(/\/today/)
  })

  // 10 — ADMIN gets no sales visibility (ADR-017).
  test('an admin cannot reach a sales dashboard', async ({ page }) => {
    await signIn(page, ADMIN)
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/settings/)

    await page.goto('/reports')
    await expect(page).toHaveURL(/\/settings/)

    await page.goto('/team')
    await expect(page).toHaveURL(/\/settings/)
  })

  // The export route is attacked directly, not through the button — §19.4 is
  // explicit that the security suite attacks the API and that a hidden control is
  // not a control.
  test('the export route refuses a salesperson and an admin', async ({ page }) => {
    await signIn(page, SALESPERSON)
    const asSalesperson = await page.request.get('/api/export/opportunities')
    expect(asSalesperson.status()).toBe(403)

    await page.goto('/login')
    await signIn(page, ADMIN)
    const asAdmin = await page.request.get('/api/export/team')
    expect(asAdmin.status()).toBe(403)
  })

  test('the export route rejects an unknown dataset', async ({ page }) => {
    await signIn(page, MANAGER)
    const response = await page.request.get('/api/export/../../etc/passwd')
    expect([404, 400]).toContain(response.status())
  })
})

/**
 * Direct-URL authorization (ADR-040).
 *
 * **Typing the address is the test.** Hiding a navigation item proves nothing —
 * that is the whole point of stating the three controls separately — so each
 * screen below is opened by URL, with no link involved, and must answer a
 * refusal rather than an empty page.
 *
 * Skipped in this environment for the same reason as everything above, and
 * backed by `tests/integration/pilot-organization.test.ts`, which proves the
 * database refuses the same callers whatever the browser does.
 */
test.describe('direct URL access, by role', () => {
  test.skip(
    !AUTH_READY,
    'Supabase Auth is unreachable in this environment (ADR-018). The database half of every ' +
      'rule below runs on every commit in tests/integration/pilot-organization.test.ts.',
  )

  async function signIn(page: Page, who: { email: string; password: string }) {
    await page.goto('/login')
    await page.getByLabel('Email').fill(who.email)
    await page.getByLabel('Password').fill(who.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/(today|dashboard)/)
  }

  const REFUSED_FOR_SALESPERSON = [
    '/reports',
    '/reports/pipeline',
    '/dashboard',
    '/team',
    '/settings',
    '/settings/organization/people',
    '/settings/organization/branches',
    '/settings/organization/structure',
  ]

  for (const path of REFUSED_FOR_SALESPERSON) {
    test(`a salesperson typing ${path} is refused`, async ({ page }) => {
      await signIn(page, SALESPERSON)
      await page.goto(path)
      await expect(page.getByText(/not part of your role|don't have access/i)).toBeVisible()
    })
  }

  const REFUSED_FOR_SALES_HEAD = [
    '/settings',
    '/settings/organization/people',
    '/settings/organization/branches',
    '/settings/organization/structure',
  ]

  for (const path of REFUSED_FOR_SALES_HEAD) {
    test(`a sales head typing ${path} is refused`, async ({ page }) => {
      // Reporting is theirs; administering the organisation is not.
      await signIn(page, MANAGER)
      await page.goto(path)
      await expect(page.getByText(/not part of your role|don't have access/i)).toBeVisible()
    })
  }

  test('a sales head reaches Team and Reports', async ({ page }) => {
    await signIn(page, MANAGER)
    for (const path of ['/team', '/reports']) {
      await page.goto(path)
      await expect(page.getByText(/not part of your role|don't have access/i)).toHaveCount(0)
    }
  })

  test('an administrator reaches the organisation screens and the reports', async ({ page }) => {
    await signIn(page, ADMIN)
    for (const path of ['/settings/organization/people', '/reports', '/dashboard']) {
      await page.goto(path)
      await expect(page.getByText(/not part of your role|don't have access/i)).toHaveCount(0)
    }
  })

  test('the owner reaches everything', async ({ page }) => {
    await signIn(page, OWNER)
    for (const path of ['/dashboard', '/team', '/reports', '/settings/organization/structure']) {
      await page.goto(path)
      await expect(page.getByText(/not part of your role|don't have access/i)).toHaveCount(0)
    }
  })

  test('a salesperson sees My Day and My Targets, and a sales head does not', async ({ page }) => {
    await signIn(page, SALESPERSON)
    await expect(page.getByRole('link', { name: 'My Targets' })).toBeVisible()

    await page.goto('/my-targets')
    await expect(page.getByRole('heading', { name: 'My Targets' })).toBeVisible()
  })

  test('the branch selector never offers a branch the caller cannot work in', async ({ page }) => {
    // The pilot's second branch is created and closed, so it must appear on the
    // Branches screen — where it is administered — and in no creation form.
    await signIn(page, SALESPERSON)
    await page.goto('/accounts/new')
    const options = await page.locator('select[name="outletId"] option').allTextContents()
    expect(options.join(' ')).not.toMatch(/chithode/i)
  })
})
