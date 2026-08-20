import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ACCOUNTS,
  ACTIVITIES,
  OPPORTUNITIES,
  USERS,
  asPostgres,
  asUser,
  connect,
  expectRejected,
  updateRowCount,
  type Db,
} from './harness'

/**
 * `activities` — append-only, with a 24-hour edit window (§5.8, §8.10).
 *
 * Editable BY THE AUTHOR for 24 hours, enforced by the RLS UPDATE policy and not
 * by the UI. Immutable thereafter. **Deletable by nobody, ever** — a correction
 * after 24 hours is a new activity of type NOTE.
 */

let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db?.end()
})

describe('the 24-hour edit window', () => {
  it('the author may edit their own activity within 24 hours', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const affected = await updateRowCount(
        tx,
        `update public.activities set summary = 'Corrected within the window' where id = $1`,
        [ACTIVITIES.onAOwnedByA1],
      )
      expect(affected).toBe(1)
    })
  })

  it('the author may NOT edit it after 24 hours', async () => {
    await asPostgres(db, async (tx) => {
      await tx.query(
        `update public.activities set created_at = now() - interval '25 hours' where id = $1`,
        [ACTIVITIES.onAOwnedByA1],
      )
      await tx.query('set local role authenticated')
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: USERS.salesA1, role: 'authenticated' }),
      ])

      const result = await tx.query(
        `update public.activities set summary = 'Too late' where id = $1`,
        [ACTIVITIES.onAOwnedByA1],
      )
      expect(result.rowCount).toBe(0)
    })
  })

  it('somebody else may not edit it, even a manager, even inside the window', async () => {
    for (const userId of [USERS.salesA2, USERS.managerA, USERS.owner]) {
      await asUser(db, userId, async (tx) => {
        const affected = await updateRowCount(
          tx,
          `update public.activities set summary = 'Not mine to edit' where id = $1`,
          [ACTIVITIES.onAOwnedByA1],
        ).catch(() => 0)
        expect(affected).toBe(0)
      })
    }
  })

  it('nobody may delete an activity', async () => {
    for (const userId of [USERS.salesA1, USERS.managerA, USERS.owner, USERS.admin]) {
      await asUser(db, userId, async (tx) => {
        const error = await expectRejected(tx, 'delete from public.activities')
        expect(error.code).toBe('42501')
      })
    }
  })
})

describe('logging an activity', () => {
  it('an activity must be performed by the caller', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.activities (account_id, opportunity_id, type, summary, performed_by)
         values ($1, $2, 'CALL', 'Logged on behalf of somebody else', $3)`,
        [ACCOUNTS.aOwnedByA1, OPPORTUNITIES.aOwnedByA1, USERS.salesA2],
      )
      expect(error.code).toBe('42501')
    })
  })

  it('an activity may not be logged against an account the caller cannot see', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.activities (account_id, type, summary, performed_by)
         values ($1, 'CALL', 'Reaching into outlet B', $2)`,
        [ACCOUNTS.bOwnedByB1, USERS.salesA1],
      )
      expect(error.code).toBe('42501')
    })
  })

  it('work context is enough to log against an account the caller does not own', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rowCount } = await tx.query(
        `insert into public.activities (account_id, opportunity_id, type, summary, performed_by)
         values ($1, $2, 'CALL', 'Discussed allied items on my own opportunity', $3)`,
        [ACCOUNTS.aOwnedByA2, OPPORTUNITIES.workContext, USERS.salesA1],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('reassignment never rewrites history: performed_by is untouched', async () => {
    await asPostgres(db, async (tx) => {
      await tx.query('update public.opportunities set owner_id = $1 where id = $2', [
        USERS.salesA2,
        OPPORTUNITIES.aOwnedByA1,
      ])
      const { rows } = await tx.query('select performed_by from public.activities where id = $1', [
        ACTIVITIES.onAOwnedByA1,
      ])
      expect(rows[0].performed_by).toBe(USERS.salesA1)
    })
  })

  it('a salesperson sees activities on an account they can see, and no others', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query('select id from public.activities')
      const ids = rows.map((row: { id: string }) => row.id)
      expect(ids).toContain(ACTIVITIES.onAOwnedByA1)
      expect(ids).not.toContain(ACTIVITIES.onBOwnedByB1)
    })
  })
})
