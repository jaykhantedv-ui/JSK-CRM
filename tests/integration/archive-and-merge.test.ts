import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ACCOUNTS,
  ACTIVITIES,
  OPPORTUNITIES,
  PROJECTS,
  USERS,
  becomeUser,
  connect,
  expectRejected,
  type Db,
} from './harness'

/**
 * Archive, restore and merge (§8.8, §8.9, C-3, ADR-008).
 *
 * Every permission assertion runs as the RESTRICTED role. **Never verify a
 * permission as OWNER** — OWNER passes everything (§23), so a test that archived
 * as OWNER would prove nothing about who may archive.
 */

let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db.end()
})

/** Run a body as one user inside a rolled-back transaction. */
async function as<T>(userId: string | null, body: () => Promise<T>): Promise<T> {
  await db.query('begin')
  try {
    await becomeUser(db, userId)
    return await body()
  } finally {
    await db.query('rollback')
    await db.query('reset role')
  }
}

describe('archive_account — C-3’s one controlled operation', () => {
  it('archives the account and its opportunities, projects and contacts together', async () => {
    await as(USERS.managerA, async () => {
      const { rows } = await db.query('select * from public.archive_account($1, $2)', [
        ACCOUNTS.aOwnedByA1,
        'duplicate record',
      ])
      expect(rows[0]).toMatchObject({ accounts: 1, opportunities: 1, projects: 1, contacts: 1 })

      const { rows: live } = await db.query(
        `select
           (select count(*) from public.accounts      where id = $1 and archived_at is null)::int as a,
           (select count(*) from public.opportunities where account_id = $1 and archived_at is null)::int as o,
           (select count(*) from public.projects      where account_id = $1 and archived_at is null)::int as p,
           (select count(*) from public.contacts      where account_id = $1 and archived_at is null)::int as c`,
        [ACCOUNTS.aOwnedByA1],
      )
      expect(live[0]).toEqual({ a: 0, o: 0, p: 0, c: 0 })
    })
  })

  it('NEVER archives activities or opportunity events — history stays (§8.8)', async () => {
    await as(USERS.managerA, async () => {
      const before = await db.query(
        'select count(*)::int as n from public.activities where account_id = $1',
        [ACCOUNTS.aOwnedByA1],
      )
      const eventsBefore = await db.query(
        'select count(*)::int as n from public.opportunity_events where opportunity_id = $1',
        [OPPORTUNITIES.aOwnedByA1],
      )

      await db.query('select * from public.archive_account($1)', [ACCOUNTS.aOwnedByA1])

      const after = await db.query(
        'select count(*)::int as n from public.activities where account_id = $1',
        [ACCOUNTS.aOwnedByA1],
      )
      const eventsAfter = await db.query(
        'select count(*)::int as n from public.opportunity_events where opportunity_id = $1',
        [OPPORTUNITIES.aOwnedByA1],
      )

      expect(after.rows[0].n).toBe(before.rows[0].n)
      // One MORE event: the ARCHIVED one the trigger just wrote.
      expect(eventsAfter.rows[0].n).toBe(eventsBefore.rows[0].n + 1)
    })
  })

  it('writes an ARCHIVED event carrying the reason through the GUC (ADR-001, M-24)', async () => {
    await as(USERS.managerA, async () => {
      await db.query('select * from public.archive_account($1, $2)', [
        ACCOUNTS.aOwnedByA1,
        'customer moved away',
      ])

      const { rows } = await db.query(
        `select event_type, reason, actor_id from public.opportunity_events
          where opportunity_id = $1 and event_type = 'ARCHIVED'`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].reason).toBe('customer moved away')
      expect(rows[0].actor_id).toBe(USERS.managerA)
    })
  })

  it('removes the account from active pipeline value', async () => {
    await as(USERS.managerA, async () => {
      const before = await db.query(
        `select coalesce(sum(estimated_value), 0)::bigint as total
           from public.v_opportunity_flags where in_pipeline`,
      )
      await db.query('select * from public.archive_account($1)', [ACCOUNTS.aOwnedByA1])
      const after = await db.query(
        `select coalesce(sum(estimated_value), 0)::bigint as total
           from public.v_opportunity_flags where in_pipeline`,
      )
      expect(Number(after.rows[0].total)).toBeLessThan(Number(before.rows[0].total))
    })
  })

  it('a SALESPERSON cannot archive, even their own customer', async () => {
    await as(USERS.salesA1, async () => {
      const error = await expectRejected(db, 'select * from public.archive_account($1)', [
        ACCOUNTS.aOwnedByA1,
      ])
      expect(error.code).toBe('42501')
      expect(error.message).toMatch(/manager or the owner/i)
    })
  })

  it('a MANAGER cannot archive a customer outside their outlets', async () => {
    await as(USERS.managerA, async () => {
      // Account B belongs to outlet B; manager.a manages outlet A only.
      await expectRejected(db, 'select * from public.archive_account($1)', [ACCOUNTS.bOwnedByB1])
    })
  })

  it('refuses when a child sits outside the caller’s scope, rather than half-archiving', async () => {
    await as(null, async () => {
      // Arranged as the owner of the database, so RLS does not interfere with
      // setting up the awkward case: a customer in outlet A holding an
      // opportunity in outlet B.
      await db.query('reset role')
      await db.query('update public.opportunities set outlet_id = $1 where id = $2', [
        '00000000-0000-4000-8000-000000002002',
        OPPORTUNITIES.aOwnedByA1,
      ])

      await becomeUser(db, USERS.managerA)
      const error = await expectRejected(db, 'select * from public.archive_account($1)', [
        ACCOUNTS.aOwnedByA1,
      ])
      expect(error.message).toMatch(/outside your scope/i)
    })
  })

  it('refuses to archive an account twice', async () => {
    await as(USERS.managerA, async () => {
      await db.query('select * from public.archive_account($1)', [ACCOUNTS.aOwnedByA1])
      const error = await expectRejected(db, 'select * from public.archive_account($1)', [
        ACCOUNTS.aOwnedByA1,
      ])
      expect(error.code).toBe('P0002')
    })
  })
})

describe('restore_account', () => {
  it('brings back exactly what the archive took, with relationships intact', async () => {
    await as(USERS.managerA, async () => {
      await db.query('select * from public.archive_account($1)', [ACCOUNTS.aOwnedByA1])
      const { rows } = await db.query('select * from public.restore_account($1)', [
        ACCOUNTS.aOwnedByA1,
      ])
      expect(rows[0]).toMatchObject({ accounts: 1, opportunities: 1, projects: 1, contacts: 1 })

      const { rows: live } = await db.query(
        `select
           (select count(*) from public.opportunities where account_id = $1 and archived_at is null)::int as o,
           (select count(*) from public.projects      where account_id = $1 and archived_at is null)::int as p,
           (select count(*) from public.contacts      where account_id = $1 and archived_at is null)::int as c,
           (select account_id  from public.opportunities where id = $2) as opp_account,
           (select project_id  from public.opportunities where id = $2) as opp_project`,
        [ACCOUNTS.aOwnedByA1, OPPORTUNITIES.aOwnedByA1],
      )
      expect(live[0].o).toBe(1)
      expect(live[0].p).toBe(1)
      expect(live[0].c).toBe(1)
      expect(live[0].opp_account).toBe(ACCOUNTS.aOwnedByA1)
      expect(live[0].opp_project).toBe(PROJECTS.aOwnedByA1)
    })
  })

  it('does NOT resurrect a child archived separately beforehand', async () => {
    await as(USERS.managerA, async () => {
      // Archived on its own a day earlier. The cascade stamps its rows with one
      // shared instant, and restore reverses exactly that instant — so this
      // project, carrying a different timestamp, must stay archived.
      await db.query(
        `update public.projects
            set archived_at = now() - interval '1 day', archived_by = $1
          where id = $2`,
        [USERS.managerA, PROJECTS.aOwnedByA1],
      )

      await db.query('select * from public.archive_account($1)', [ACCOUNTS.aOwnedByA1])
      const { rows } = await db.query('select * from public.restore_account($1)', [
        ACCOUNTS.aOwnedByA1,
      ])

      // The project the cascade did not archive is not one the restore brings back.
      expect(rows[0].projects).toBe(0)
      const { rows: project } = await db.query(
        'select archived_at from public.projects where id = $1',
        [PROJECTS.aOwnedByA1],
      )
      expect(project[0].archived_at).not.toBeNull()
    })
  })

  it('writes a RESTORED event', async () => {
    await as(USERS.managerA, async () => {
      await db.query('select * from public.archive_account($1)', [ACCOUNTS.aOwnedByA1])
      await db.query('select * from public.restore_account($1, $2)', [
        ACCOUNTS.aOwnedByA1,
        'archived by mistake',
      ])

      const { rows } = await db.query(
        `select reason from public.opportunity_events
          where opportunity_id = $1 and event_type = 'RESTORED'`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows[0].reason).toBe('archived by mistake')
    })
  })

  it('a SALESPERSON cannot restore', async () => {
    await db.query('begin')
    try {
      await db.query(
        `update public.accounts set archived_at = now(), archived_by = $1 where id = $2`,
        [USERS.managerA, ACCOUNTS.aOwnedByA1],
      )
      await becomeUser(db, USERS.salesA1)
      const error = await expectRejected(db, 'select * from public.restore_account($1)', [
        ACCOUNTS.aOwnedByA1,
      ])
      expect(error.code).toBe('42501')
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })
})

describe('merge_accounts (§8.9, ADR-008)', () => {
  it('moves contacts, projects, opportunities and activities to the target', async () => {
    await as(USERS.managerA, async () => {
      const { rows } = await db.query('select * from public.merge_accounts($1, $2, $3)', [
        ACCOUNTS.aOwnedByA1,
        ACCOUNTS.aOwnedByA2,
        'same customer twice',
      ])
      expect(rows[0]).toMatchObject({ contacts: 1, projects: 1, opportunities: 1, activities: 1 })

      const { rows: moved } = await db.query(
        `select
           (select count(*) from public.opportunities where account_id = $1)::int as o,
           (select count(*) from public.activities    where account_id = $1)::int as a`,
        [ACCOUNTS.aOwnedByA1],
      )
      expect(moved[0]).toEqual({ o: 0, a: 0 })
    })
  })

  it('ARCHIVES the source rather than deleting it (CLAUDE.md §11)', async () => {
    await as(USERS.managerA, async () => {
      await db.query('select * from public.merge_accounts($1, $2)', [
        ACCOUNTS.aOwnedByA1,
        ACCOUNTS.aOwnedByA2,
      ])
      const { rows } = await db.query(
        'select archived_at, archived_by from public.accounts where id = $1',
        [ACCOUNTS.aOwnedByA1],
      )
      expect(rows[0].archived_at).not.toBeNull()
      expect(rows[0].archived_by).toBe(USERS.managerA)
    })
  })

  it('records a MERGED event per moved opportunity with source, target and reason', async () => {
    await as(USERS.managerA, async () => {
      await db.query('select * from public.merge_accounts($1, $2, $3)', [
        ACCOUNTS.aOwnedByA1,
        ACCOUNTS.aOwnedByA2,
        'duplicate entry',
      ])

      const { rows } = await db.query(
        `select event_type, reason, metadata, actor_id from public.opportunity_events
          where opportunity_id = $1 and event_type = 'MERGED'`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].reason).toBe('duplicate entry')
      expect(rows[0].actor_id).toBe(USERS.managerA)
      expect(rows[0].metadata).toEqual({
        from_account_id: ACCOUNTS.aOwnedByA1,
        to_account_id: ACCOUNTS.aOwnedByA2,
      })
    })
  })

  it('preserves activity authorship — history is never rewritten (§8.1)', async () => {
    await as(USERS.managerA, async () => {
      const before = await db.query(
        'select performed_by, summary, occurred_at from public.activities where id = $1',
        [ACTIVITIES.onAOwnedByA1],
      )
      await db.query('select * from public.merge_accounts($1, $2)', [
        ACCOUNTS.aOwnedByA1,
        ACCOUNTS.aOwnedByA2,
      ])
      const after = await db.query(
        'select performed_by, summary, occurred_at, account_id from public.activities where id = $1',
        [ACTIVITIES.onAOwnedByA1],
      )

      expect(after.rows[0].performed_by).toBe(before.rows[0].performed_by)
      expect(after.rows[0].summary).toBe(before.rows[0].summary)
      expect(after.rows[0].account_id).toBe(ACCOUNTS.aOwnedByA2)
    })
  })

  it('a SALESPERSON cannot merge', async () => {
    await as(USERS.salesA1, async () => {
      const error = await expectRejected(db, 'select * from public.merge_accounts($1, $2)', [
        ACCOUNTS.aOwnedByA1,
        ACCOUNTS.aOwnedByA2,
      ])
      expect(error.code).toBe('42501')
    })
  })

  it('an ADMIN cannot merge — it is a sales-management action (ADR-017)', async () => {
    await as(USERS.admin, async () => {
      const error = await expectRejected(db, 'select * from public.merge_accounts($1, $2)', [
        ACCOUNTS.aOwnedByA1,
        ACCOUNTS.aOwnedByA2,
      ])
      expect(error.code).toBe('42501')
    })
  })

  it('a MANAGER cannot merge a record they cannot see', async () => {
    await as(USERS.managerA, async () => {
      // Account B is in outlet B, which manager.a does not manage. The function
      // runs SECURITY DEFINER, so this check is its own responsibility.
      const error = await expectRejected(db, 'select * from public.merge_accounts($1, $2)', [
        ACCOUNTS.bOwnedByB1,
        ACCOUNTS.aOwnedByA1,
      ])
      expect(error.code).toBe('P0002')
    })
  })

  it('refuses to merge a record into itself', async () => {
    await as(USERS.managerA, async () => {
      await expectRejected(db, 'select * from public.merge_accounts($1, $1)', [
        ACCOUNTS.aOwnedByA1,
      ])
    })
  })

  it('refuses when either side is archived', async () => {
    await db.query('begin')
    try {
      await db.query('update public.accounts set archived_at = now() where id = $1', [
        ACCOUNTS.aOwnedByA1,
      ])
      await becomeUser(db, USERS.managerA)
      await expectRejected(db, 'select * from public.merge_accounts($1, $2)', [
        ACCOUNTS.aOwnedByA1,
        ACCOUNTS.aOwnedByA2,
      ])
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('never deletes a row', async () => {
    await as(USERS.managerA, async () => {
      const before = await db.query(
        `select (select count(*) from public.accounts)::int as a,
                (select count(*) from public.activities)::int as act,
                (select count(*) from public.opportunities)::int as o`,
      )
      await db.query('select * from public.merge_accounts($1, $2)', [
        ACCOUNTS.aOwnedByA1,
        ACCOUNTS.aOwnedByA2,
      ])
      const after = await db.query(
        `select (select count(*) from public.accounts)::int as a,
                (select count(*) from public.activities)::int as act,
                (select count(*) from public.opportunities)::int as o`,
      )
      expect(after.rows[0]).toEqual(before.rows[0])
    })
  })
})
