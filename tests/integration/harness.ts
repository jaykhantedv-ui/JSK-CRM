import { Client } from 'pg'

/**
 * The integration / RLS harness (§19.2, ADR-018).
 *
 * **These are the most important tests in the project.** They are the only proof
 * that the authorization model actually holds, because row-level security — not
 * the UI and not the service layer — is the security boundary (§15).
 *
 * A test impersonates a user EXACTLY as PostgREST does: it sets
 * `request.jwt.claims` and switches to the `authenticated` role. Nothing is
 * mocked. A policy that would reject a real request rejects one here, for the
 * same reason and with the same error.
 *
 * Every test runs inside a transaction that is rolled back, so the fixture set is
 * identical for each one and the suite has no ordering dependency.
 */

export const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54322/postgres'

/** Fixture ids from `supabase/seed/dev-fixtures.sql`. */
export const USERS = {
  owner: '00000000-0000-4000-8000-000000001001',
  admin: '00000000-0000-4000-8000-000000001002',
  managerA: '00000000-0000-4000-8000-000000001003',
  managerAC: '00000000-0000-4000-8000-000000001004',
  managerNone: '00000000-0000-4000-8000-000000001005',
  salesA1: '00000000-0000-4000-8000-000000001006',
  salesA2: '00000000-0000-4000-8000-000000001007',
  salesB1: '00000000-0000-4000-8000-000000001008',
  deactivated: '00000000-0000-4000-8000-000000001009',
} as const

export const OUTLETS = {
  a: '00000000-0000-4000-8000-000000002001',
  b: '00000000-0000-4000-8000-000000002002',
  c: '00000000-0000-4000-8000-000000002003',
} as const

export const ACCOUNTS = {
  aOwnedByA1: '00000000-0000-4000-8000-000000003001',
  aOwnedByA2: '00000000-0000-4000-8000-000000003002',
  bOwnedByB1: '00000000-0000-4000-8000-000000003003',
  cOwnedByA1: '00000000-0000-4000-8000-000000003004',
} as const

export const PROJECTS = {
  aOwnedByA1: '00000000-0000-4000-8000-000000004001',
  aOwnedByA2: '00000000-0000-4000-8000-000000004002',
  bOwnedByB1: '00000000-0000-4000-8000-000000004003',
} as const

export const OPPORTUNITIES = {
  aOwnedByA1: '00000000-0000-4000-8000-000000005001',
  aOwnedByA2: '00000000-0000-4000-8000-000000005002',
  bOwnedByB1: '00000000-0000-4000-8000-000000005003',
  /** On A2's account and project, but owned by A1 — the work-context case (§3.2). */
  workContext: '00000000-0000-4000-8000-000000005004',
  cOwnedByA1: '00000000-0000-4000-8000-000000005005',
} as const

export const ACTIVITIES = {
  onAOwnedByA1: '00000000-0000-4000-8000-000000007001',
  onBOwnedByB1: '00000000-0000-4000-8000-000000007002',
} as const

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL })
  await client.connect()
  return client
}

export type Db = Client

/**
 * Run a body inside a rolled-back transaction, as a given user.
 *
 * `set local role authenticated` plus the JWT claims GUC is precisely what
 * PostgREST does for an authenticated request, so `auth.uid()` resolves the same
 * way and every policy is evaluated for real.
 *
 * Pass `null` to run as an unauthenticated (`anon`) caller.
 */
export async function asUser<T>(
  db: Db,
  userId: string | null,
  body: (db: Db) => Promise<T>,
): Promise<T> {
  await db.query('begin')
  try {
    if (userId) {
      await db.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: userId, role: 'authenticated' }),
      ])
      await db.query('set local role authenticated')
    } else {
      await db.query('set local role anon')
    }
    return await body(db)
  } finally {
    await db.query('rollback')
  }
}

/** Run a body as the database owner — for arranging fixtures, never for asserting. */
export async function asPostgres<T>(db: Db, body: (db: Db) => Promise<T>): Promise<T> {
  await db.query('begin')
  try {
    return await body(db)
  } finally {
    await db.query('rollback')
  }
}

/** The ids of the rows this user can SELECT from a table. */
export async function visibleIds(db: Db, table: string): Promise<string[]> {
  const { rows } = await db.query(`select id from public.${table} order by id`)
  return rows.map((row: { id: string }) => row.id)
}

export async function canSee(db: Db, table: string, id: string): Promise<boolean> {
  const { rows } = await db.query(`select 1 from public.${table} where id = $1`, [id])
  return rows.length === 1
}

/**
 * Assert a statement is rejected, and return the error so a test can check which
 * rule rejected it. A statement that unexpectedly SUCCEEDS fails the test loudly —
 * a silently permitted write is the exact failure these tests exist to catch.
 */
let savepointCounter = 0

export async function expectRejected(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<{ code: string; message: string; constraint?: string }> {
  // Wrapped in a savepoint so the surrounding transaction survives.
  //
  // A rejected statement aborts its transaction, and every statement after it
  // fails with `in_failed_sql_transaction` (25P02) regardless of what it does.
  // Without this, a test that checks several refusals in a row would report the
  // second one as a permission failure when it was really just collateral — and,
  // worse, a test asserting only "it was rejected" would pass for the wrong
  // reason. The savepoint keeps each assertion independent and honest.
  const name = `expect_rejected_${++savepointCounter}`
  await db.query(`savepoint ${name}`)

  try {
    await db.query(sql, params)
  } catch (error) {
    await db.query(`rollback to savepoint ${name}`)
    const e = error as { code: string; message: string; constraint?: string }
    return { code: e.code, message: e.message, constraint: e.constraint }
  }

  await db.query(`release savepoint ${name}`)
  throw new Error(`Expected this statement to be rejected, but it succeeded:\n${sql}`)
}

/**
 * A write blocked by RLS shows up in two different ways depending on the
 * operation: INSERT/UPDATE with a failing WITH CHECK raises 42501, while an
 * UPDATE whose USING clause hides the row simply affects zero rows. Both mean
 * "refused", and a test that only checked for an exception would pass while the
 * data quietly changed.
 */
export async function updateRowCount(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const result = await db.query(sql, params)
  return result.rowCount ?? 0
}

/**
 * Impersonate a different user inside an already-open transaction.
 *
 * `set local role` and the claims GUC are both transaction-scoped, so a scenario
 * that arranges data as one person and asserts as another can do both inside the
 * single transaction it will roll back. `reset role` first, because a session
 * already switched to `authenticated` cannot switch again — it has no membership
 * in any other role.
 */
export async function becomeUser(db: Db, userId: string | null): Promise<void> {
  await db.query('reset role')
  if (userId === null) {
    await db.query('select set_config($1, $2, true)', ['request.jwt.claims', ''])
    await db.query('set local role anon')
    return
  }
  await db.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ])
  await db.query('set local role authenticated')
}

/**
 * Arrange fixtures as the database owner, then assert as a given user — in one
 * transaction that is rolled back.
 *
 * The management suites need this shape because the data under test is other
 * people's: won deals owned by several salespeople across several branches,
 * which a manager then reads. Arranging that through each owner's own session
 * would test the write policies all over again rather than the reporting rule
 * actually under examination.
 *
 * **`arrange` runs as the database owner and must never assert anything.** The
 * owner bypasses row-level security, so an assertion made there proves nothing
 * (§23).
 */
export async function scenario<T>(
  db: Db,
  arrange: (db: Db) => Promise<void>,
  userId: string | null,
  assert: (db: Db) => Promise<T>,
): Promise<T> {
  await db.query('begin')
  try {
    await arrange(db)
    await becomeUser(db, userId)
    return await assert(db)
  } finally {
    await db.query('rollback')
    await db.query('reset role')
  }
}
