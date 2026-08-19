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
export async function expectRejected(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<{ code: string; message: string; constraint?: string }> {
  try {
    await db.query(sql, params)
  } catch (error) {
    const e = error as { code: string; message: string; constraint?: string }
    return { code: e.code, message: e.message, constraint: e.constraint }
  }
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
