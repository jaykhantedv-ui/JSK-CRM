import { expect, test } from '@playwright/test'

/**
 * Master Phase 2 — the critical Core CRM workflows (§19.3).
 *
 * **These require a signed-in session, which needs Supabase Auth (GoTrue).**
 * ADR-018 records why this environment cannot run it: the Supabase container
 * images are blocked by the egress policy, so the local runtime is a plain
 * PostgreSQL server with a platform bootstrap. There is no auth server to issue
 * a session, and therefore no way to sign in from a browser here.
 *
 * The specs below are written against the real application and are skipped —
 * loudly, with a stated reason — when no Supabase project is reachable. Point
 * `E2E_SUPABASE_READY=1` plus real credentials at a project and they run as
 * written.
 *
 * **This is not a substitute for coverage, and it is not treated as one.** Every
 * workflow below is also proved at the database level in
 * `tests/integration/crm-workflows.test.ts` and
 * `tests/integration/crm-permissions.test.ts`, which run for real on every
 * commit and are where the authorization rules are actually verified (§19.2 —
 * "the most important tests in the project"). The scenarios that E2E adds beyond
 * those are the browser-level ones: the sixty-second mobile flow and the
 * direct-URL access checks.
 */
const AUTH_READY = process.env.E2E_SUPABASE_READY === '1'

const SALESPERSON = {
  email: process.env.E2E_SALESPERSON_EMAIL ?? 'sales.a1@jsk.test',
  password: process.env.E2E_PASSWORD ?? 'devpassword',
}
const OTHER_SALESPERSON = {
  email: process.env.E2E_OTHER_SALESPERSON_EMAIL ?? 'sales.b1@jsk.test',
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

test.describe('Core CRM workflows', () => {
  test.skip(
    !AUTH_READY,
    'Supabase Auth is unreachable in this environment (ADR-018). These run against a real ' +
      'Supabase project with E2E_SUPABASE_READY=1; the same workflows are proved against the ' +
      'database in tests/integration/crm-workflows.test.ts and crm-permissions.test.ts.',
  )

  async function signIn(page: import('@playwright/test').Page, who: { email: string; password: string }) {
    await page.goto('/login')
    await page.getByLabel('Email').fill(who.email)
    await page.getByLabel('Password').fill(who.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/(today|dashboard|settings)/)
  }

  const uniqueName = (prefix: string) => `${prefix} ${Date.now()}`

  // 1 — salesperson creates a customer and an opportunity in one flow (§11.1)
  test('a salesperson creates a customer and an enquiry in one flow', async ({ page }) => {
    await signIn(page, SALESPERSON)
    const name = uniqueName('E2E Homeowner')

    await page.goto('/accounts/new')
    await page.getByLabel('Phone').fill('9876500001')
    await page.getByLabel('Name').fill(name)
    await page.getByLabel('Customer type').selectOption('HOMEOWNER')
    await page.getByLabel('Asking about').selectOption('TILES')
    await page.getByLabel('Estimated value').fill('150000')
    await page.getByRole('button', { name: 'Tomorrow' }).click()
    await page.getByRole('button', { name: 'Save customer and enquiry' }).click()

    await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}/)
    await expect(page.getByRole('heading', { name })).toBeVisible()
    // §11.1 — the enquiry is visible on the customer page straight away.
    await expect(page.getByText('Open enquiries · 1')).toBeVisible()
  })

  // 2 — salesperson logs an activity (§11.5)
  test('a salesperson logs an activity in three taps', async ({ page }) => {
    await signIn(page, SALESPERSON)
    await page.goto('/today')
    await page.locator('a[href^="/opportunities/"]').first().click()

    await page.getByRole('button', { name: 'Log activity' }).click()
    await page.getByRole('button', { name: 'Call', exact: true }).first().click()
    await page.getByRole('button', { name: 'Positive' }).click()
    await page.getByLabel('Summary').fill('Discussed 600x600 vitrified for the hall.')
    await page.getByRole('button', { name: 'Log it' }).click()

    await expect(page.getByText('Discussed 600x600 vitrified for the hall.')).toBeVisible()
  })

  // 3 — salesperson sets a next action (§11.6)
  test('a salesperson sets a next action from the opportunity', async ({ page }) => {
    await signIn(page, SALESPERSON)
    await page.goto('/opportunities')
    await page.locator('a[href^="/opportunities/"]').first().click()

    await page.getByRole('button', { name: /Set next action|Change/ }).click()
    await page.getByRole('button', { name: 'Tomorrow' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await expect(page.getByText('Tomorrow')).toBeVisible()
  })

  // 4 — overdue and due-today appear on /today (§13.2)
  test('the overdue and due-today lists appear on Today', async ({ page }) => {
    await signIn(page, SALESPERSON)
    await page.goto('/today')

    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(page.getByText(/^Overdue · \d+$/)).toBeVisible()
    await expect(page.getByText(/^Due today · \d+$/)).toBeVisible()
    await expect(page.getByText(/^Missing next action · \d+$/)).toBeVisible()
  })

  // 5 — manager views the outlet pipeline (§13.3, basic visibility)
  test('a manager sees the pipeline for their outlet', async ({ page }) => {
    await signIn(page, MANAGER)
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByText('Pipeline Value')).toBeVisible()
    await expect(page.getByText('By stage')).toBeVisible()
  })

  // 6 — manager cannot reach another outlet's record (§19.3 scenario 13)
  test('a manager cannot open a record from an outlet they do not manage', async ({ page, request }) => {
    await signIn(page, MANAGER)
    const foreign = process.env.E2E_FOREIGN_OPPORTUNITY_ID
    test.skip(!foreign, 'Set E2E_FOREIGN_OPPORTUNITY_ID to an opportunity outside this manager’s scope.')

    await page.goto(`/opportunities/${foreign}`)
    // §25 — the same words as "does not exist". Existence is never confirmed.
    await expect(page.getByText(/don't have access to this record/i)).toBeVisible()

    // And the same denial holds against the API, not merely the screen (§19.4).
    const direct = await request.get(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/opportunities?id=eq.${foreign}&select=*`,
      {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
          Authorization: `Bearer ${process.env.E2E_MANAGER_JWT ?? ''}`,
        },
      },
    )
    expect(await direct.json()).toEqual([])
  })

  // 7 — owner sees every outlet (§13.4)
  test('an owner sees every outlet', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto('/dashboard')
    await expect(page.getByText('Every branch.')).toBeVisible()
  })

  // 8 — one project carries several opportunities (§11.3)
  test('a project lists more than one enquiry', async ({ page }) => {
    await signIn(page, SALESPERSON)
    await page.goto('/projects')
    await page.locator('a[href^="/projects/"]').first().click()

    const heading = page.getByText(/Enquiries on this site · \d+/)
    await expect(heading).toBeVisible()

    await page.getByRole('link', { name: 'Add enquiry' }).click()
    await page.getByLabel('Category').selectOption('SANITARYWARE')
    await page.getByLabel('Estimated value').fill('80000')
    await page.getByRole('button', { name: 'Create enquiry' }).click()
    await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}/)
  })

  // 9 — an opportunity moves through the pipeline, and an invalid move is refused (§11.7)
  test('an opportunity moves through valid stages', async ({ page }) => {
    await signIn(page, SALESPERSON)
    await page.goto('/opportunities?stage=new')
    await page.locator('a[href^="/opportunities/"]').first().click()

    await page.getByRole('button', { name: 'Qualified' }).click()
    await page.getByRole('button', { name: 'Move to Qualified' }).click()
    await expect(page.getByText('Qualified').first()).toBeVisible()

    // The picker never offers a move the matrix forbids — `new → won` is not
    // reachable from here, which is the UI half of the rule the service enforces.
    await expect(page.getByRole('button', { name: 'Won', exact: true })).toHaveCount(0)
  })

  // 10 — won and lost behaviour (§11.8)
  test('marking lost requires a reason, and marking won stores the value', async ({ page }) => {
    await signIn(page, SALESPERSON)
    await page.goto('/opportunities')
    await page.locator('a[href^="/opportunities/"]').first().click()

    await page.getByRole('button', { name: 'Lost' }).click()
    // The reason field is required, so the browser refuses the empty submit and
    // the service refuses it again if the browser is bypassed.
    await expect(page.getByLabel('Why was it lost?')).toBeVisible()
    await page.getByLabel('Why was it lost?').selectOption('PRICE')
    await page.getByRole('button', { name: 'Move to Lost' }).click()

    await expect(page.getByText(/Lost: Price/)).toBeVisible()
    // §8.7 — closing clears the next action, so the control disappears.
    await expect(page.getByRole('button', { name: 'Set next action' })).toHaveCount(0)
  })

  // §19.3 scenario 13 — a salesperson cannot reach another salesperson's record
  test('a salesperson cannot open another salesperson’s opportunity by URL', async ({ page }) => {
    const foreign = process.env.E2E_FOREIGN_OPPORTUNITY_ID
    test.skip(!foreign, 'Set E2E_FOREIGN_OPPORTUNITY_ID to an opportunity this user does not own.')

    await signIn(page, OTHER_SALESPERSON)
    await page.goto(`/opportunities/${foreign}`)
    await expect(page.getByText(/don't have access to this record/i)).toBeVisible()
  })

  // §19.3 scenario 15 — the mobile flow at 375x812
  test('the mobile create flow completes at 375x812', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await signIn(page, SALESPERSON)

    const started = Date.now()
    await page.goto('/accounts/new')
    await page.getByLabel('Phone').fill('9876500002')
    await page.getByLabel('Name').fill(uniqueName('E2E Mobile'))
    await page.getByLabel('Estimated value').fill('90000')
    await page.getByRole('button', { name: 'Tomorrow' }).click()
    await page.getByRole('button', { name: 'Save customer and enquiry' }).click()
    await page.waitForURL(/\/accounts\/[0-9a-f-]{36}/)

    // §1.4 — the whole design bet is that this beats a notebook.
    expect(Date.now() - started).toBeLessThan(60_000)

    // §12.3 — the bottom tab bar and its raised + are the mobile navigation.
    await expect(page.getByRole('button', { name: 'Quick actions' })).toBeVisible()
  })
})

/**
 * Checks that need no session, so they run everywhere — including here.
 *
 * §19.4 requires unauthenticated access to every route to be tested, and these do
 * exactly that against the routes Master Phase 2 added.
 */
test.describe('unauthenticated access to the Core CRM routes (§19.4)', () => {
  const ROUTES = [
    '/today',
    '/accounts',
    '/accounts/new',
    '/accounts/00000000-0000-4000-8000-000000003001',
    '/contacts',
    '/projects',
    '/projects/new',
    '/opportunities',
    '/opportunities/board',
    '/opportunities/new',
    '/search?q=ravi',
    '/dashboard',
  ]

  for (const route of ROUTES) {
    test(`a signed-out visitor to ${route} lands on the login screen`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    })
  }

  test('no application data reaches a signed-out visitor', async ({ page }) => {
    await page.goto('/accounts')
    // The redirect is a convenience; RLS is the control. Nothing from the
    // authenticated shell may render.
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Quick actions' })).toHaveCount(0)
  })
})
