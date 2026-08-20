import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ACCOUNTS, PROJECTS, USERS, asPostgres, asUser, connect, type Db } from './harness'

/**
 * Nothing is ever hard-deleted (§8.8, §15.2, ADR-004).
 *
 * **Exactly one table in the schema has a DELETE policy: `project_stakeholders`,**
 * because its rows are relationship links carrying no history, no ownership and
 * no money. Everything else is undeletable by every role, INCLUDING OWNER.
 *
 * A reviewer should be able to grep migration 016 for `for delete` and find one
 * policy. This suite is that grep, executed.
 */

const EVERY_TABLE = [
  'users',
  'outlets',
  'user_outlets',
  'accounts',
  'contacts',
  'projects',
  'opportunities',
  'activities',
  'opportunity_events',
  'system_settings',
  'import_batches',
  'import_rows',
] as const

const EVERY_ROLE = [
  ['the owner', USERS.owner],
  ['an admin', USERS.admin],
  ['a manager', USERS.managerA],
  ['a salesperson', USERS.salesA1],
] as const

let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db?.end()
})

describe('the schema grants exactly one delete', () => {
  it('has one DELETE policy, on project_stakeholders', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        `select tablename, policyname from pg_policies
         where schemaname = 'public' and cmd = 'DELETE'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].tablename).toBe('project_stakeholders')
    })
  })

  it('grants the DELETE privilege on no other table', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        `select table_name from information_schema.role_table_grants
         where table_schema = 'public' and privilege_type = 'DELETE' and grantee = 'authenticated'`,
      )
      expect(rows.map((row: { table_name: string }) => row.table_name)).toEqual([
        'project_stakeholders',
      ])
    })
  })
})

describe.each(EVERY_ROLE)('%s cannot delete a business record', (_who, userId) => {
  it.each(EVERY_TABLE)('delete from %s is refused', async (table) => {
    await asUser(db, userId, async (tx) => {
      await expect(tx.query(`delete from public.${table}`)).rejects.toMatchObject({ code: '42501' })
    })
  })
})

describe('the one approved exception (ADR-004)', () => {
  it('lets whoever may update the parent project remove a stakeholder', async () => {
    await asPostgres(db, async (tx) => {
      await tx.query(
        `insert into public.project_stakeholders (project_id, account_id, role)
         values ($1, $2, 'ARCHITECT')`,
        [PROJECTS.aOwnedByA1, ACCOUNTS.aOwnedByA1],
      )
      await tx.query('set local role authenticated')
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: USERS.salesA1, role: 'authenticated' }),
      ])

      // salesA1 owns project 4001, so they may correct its stakeholder list.
      const result = await tx.query('delete from public.project_stakeholders where project_id = $1', [
        PROJECTS.aOwnedByA1,
      ])
      expect(result.rowCount).toBe(1)
    })
  })

  it('refuses a stakeholder deletion on a project the caller cannot update', async () => {
    await asPostgres(db, async (tx) => {
      await tx.query(
        `insert into public.project_stakeholders (project_id, account_id, role)
         values ($1, $2, 'ARCHITECT')`,
        [PROJECTS.bOwnedByB1, ACCOUNTS.bOwnedByB1],
      )
      await tx.query('set local role authenticated')
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: USERS.salesA1, role: 'authenticated' }),
      ])

      // Outlet B, owned by somebody else: the row is not even visible.
      const result = await tx.query('delete from public.project_stakeholders where project_id = $1', [
        PROJECTS.bOwnedByB1,
      ])
      expect(result.rowCount).toBe(0)
    })
  })
})

describe('archiving is how records are removed', () => {
  it('a manager archives, and the row survives with its relationships', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const result = await tx.query(
        'update public.accounts set archived_at = now(), archived_by = $1 where id = $2 returning id',
        [USERS.managerA, ACCOUNTS.aOwnedByA1],
      )
      expect(result.rowCount).toBe(1)

      const { rows } = await tx.query(
        `select count(*)::int as n from public.opportunities where account_id = $1`,
        [ACCOUNTS.aOwnedByA1],
      )
      expect(rows[0].n).toBeGreaterThan(0)
    })
  })
})
