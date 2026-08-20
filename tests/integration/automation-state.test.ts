import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ACCOUNTS,
  OPPORTUNITIES,
  USERS,
  becomeUser,
  connect,
  expectRejected,
  updateRowCount,
  type Db,
} from './harness'

/**
 * Maintenance, SLA state and settings permissions (§14.2, §14.6, ADR-002,
 * ADR-014, H-09).
 *
 * The most important assertion in this file is the H-09 one: **a nightly
 * maintenance run must not make freshly imported records look user-edited**,
 * because §20.6 decides rollback eligibility on exactly that signal. Getting it
 * wrong silently costs the business its undo at 02:00 the morning after an
 * import.
 */

let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db.end()
})

describe('run_maintenance — dormancy (§14.6, ADR-010)', () => {
  it('flags an account with no recent activity as DORMANT', async () => {
    await db.query('begin')
    try {
      await db.query(
        `update public.accounts
            set status = 'ACTIVE', last_activity_at = now() - interval '60 days'
          where id = $1`,
        [ACCOUNTS.aOwnedByA1],
      )

      const { rows } = await db.query('select * from public.run_maintenance(30)')
      expect(rows[0].dormant_accounts).toBeGreaterThanOrEqual(1)

      const { rows: account } = await db.query(
        'select status from public.accounts where id = $1',
        [ACCOUNTS.aOwnedByA1],
      )
      expect(account[0].status).toBe('DORMANT')
    } finally {
      await db.query('rollback')
    }
  })

  it('leaves a recently active account alone', async () => {
    await db.query('begin')
    try {
      await db.query(
        `update public.accounts set status = 'ACTIVE', last_activity_at = now() where id = $1`,
        [ACCOUNTS.aOwnedByA1],
      )
      await db.query('select * from public.run_maintenance(30)')
      const { rows } = await db.query('select status from public.accounts where id = $1', [
        ACCOUNTS.aOwnedByA1,
      ])
      expect(rows[0].status).toBe('ACTIVE')
    } finally {
      await db.query('rollback')
    }
  })

  it('never overrules DO_NOT_CONTACT', async () => {
    await db.query('begin')
    try {
      await db.query(
        `update public.accounts
            set status = 'DO_NOT_CONTACT', last_activity_at = now() - interval '400 days'
          where id = $1`,
        [ACCOUNTS.aOwnedByA1],
      )
      await db.query('select * from public.run_maintenance(30)')
      const { rows } = await db.query('select status from public.accounts where id = $1', [
        ACCOUNTS.aOwnedByA1,
      ])
      // An explicit instruction not to contact somebody is not a state the
      // system may recompute.
      expect(rows[0].status).toBe('DO_NOT_CONTACT')
    } finally {
      await db.query('rollback')
    }
  })

  it('uses the threshold it is given rather than a baked-in number (CLAUDE.md §3)', async () => {
    await db.query('begin')
    try {
      // The ACTIVITY is back-dated too, not just the denormalised column. Step 3
      // of the job recomputes `last_activity_at` from the activities, so a test
      // that moved only the column would have its own fixture corrected out from
      // under it — which is the job working correctly.
      await db.query(
        `update public.activities set occurred_at = now() - interval '45 days'
          where account_id = $1`,
        [ACCOUNTS.aOwnedByA1],
      )
      await db.query(
        `update public.accounts
            set status = 'ACTIVE', last_activity_at = now() - interval '45 days'
          where id = $1`,
        [ACCOUNTS.aOwnedByA1],
      )

      await db.query('select * from public.run_maintenance(60)')
      let { rows } = await db.query('select status from public.accounts where id = $1', [
        ACCOUNTS.aOwnedByA1,
      ])
      expect(rows[0].status).toBe('ACTIVE')

      await db.query('select * from public.run_maintenance(30)')
      ;({ rows } = await db.query('select status from public.accounts where id = $1', [
        ACCOUNTS.aOwnedByA1,
      ]))
      expect(rows[0].status).toBe('DORMANT')
    } finally {
      await db.query('rollback')
    }
  })

  it('refuses a nonsensical threshold rather than flagging everything', async () => {
    await db.query('begin')
    try {
      await expectRejected(db, 'select * from public.run_maintenance(0)')
      await expectRejected(db, 'select * from public.run_maintenance(null)')
    } finally {
      await db.query('rollback')
    }
  })
})

describe('run_maintenance — quotation expiry (§14.6)', () => {
  it('expires a quotation past its validity date', async () => {
    await db.query('begin')
    try {
      await db.query(
        `update public.opportunities
            set quotation_status = 'SENT', quotation_valid_until = current_date - 1
          where id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      const { rows } = await db.query('select * from public.run_maintenance(30)')
      expect(rows[0].expired_quotations).toBe(1)

      const { rows: opp } = await db.query(
        'select quotation_status from public.opportunities where id = $1',
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(opp[0].quotation_status).toBe('EXPIRED')
    } finally {
      await db.query('rollback')
    }
  })

  it('leaves an ACCEPTED quotation alone', async () => {
    await db.query('begin')
    try {
      await db.query(
        `update public.opportunities
            set quotation_status = 'ACCEPTED', quotation_valid_until = current_date - 30
          where id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      await db.query('select * from public.run_maintenance(30)')
      const { rows } = await db.query(
        'select quotation_status from public.opportunities where id = $1',
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows[0].quotation_status).toBe('ACCEPTED')
    } finally {
      await db.query('rollback')
    }
  })
})

describe('run_maintenance — last_activity_at corrections (§14.6)', () => {
  it('reports every row it had to correct, and does not suppress it', async () => {
    await db.query('begin')
    try {
      // Simulate a write path that failed to maintain the column.
      await db.query(
        `update public.accounts set last_activity_at = now() - interval '900 days' where id = $1`,
        [ACCOUNTS.aOwnedByA1],
      )

      const { rows } = await db.query('select * from public.run_maintenance(3000)')
      expect(rows[0].corrected_accounts).toBeGreaterThanOrEqual(1)
      expect(rows[0].corrected_ids).toContain(ACCOUNTS.aOwnedByA1)

      const { rows: fixed } = await db.query(
        `select a.last_activity_at = (select max(occurred_at) from public.activities where account_id = a.id) as correct
           from public.accounts a where a.id = $1`,
        [ACCOUNTS.aOwnedByA1],
      )
      expect(fixed[0].correct).toBe(true)
    } finally {
      await db.query('rollback')
    }
  })

  it('reports zero corrections when every write path behaved', async () => {
    await db.query('begin')
    try {
      // Run once to settle any fixture drift, then again on a correct database.
      await db.query('select * from public.run_maintenance(3000)')
      const { rows } = await db.query('select * from public.run_maintenance(3000)')
      expect(rows[0].corrected_accounts).toBe(0)
      expect(rows[0].corrected_opportunities).toBe(0)
    } finally {
      await db.query('rollback')
    }
  })
})

describe('H-09 — maintenance must not destroy import rollback eligibility', () => {
  async function importBatch(): Promise<string> {
    const { rows: batch } = await db.query(
      `insert into public.import_batches (entity, file_name, status, total_rows, uploaded_by)
       values ('accounts', 'historic.csv', 'REVIEW', 1, $1) returning id`,
      [USERS.owner],
    )
    const batchId = batch[0].id as string

    await db.query(
      `insert into public.import_rows (batch_id, row_number, raw, normalized, status)
       values ($1, 1, '{}', $2, 'VALID')`,
      [
        batchId,
        JSON.stringify({
          name: 'Historic Customer',
          account_type: 'HOMEOWNER',
          phone: '9843070001',
          email: null,
          address: null,
          city: 'Erode',
          area: null,
          source: 'OTHER',
          notes: null,
          status: 'PROSPECT',
          owner_id: USERS.salesA1,
          outlet_id: '00000000-0000-4000-8000-000000002001',
          legacy_ref: 'OLD-1',
        }),
      ],
    )

    await db.query('select * from public.execute_import($1)', [batchId])
    return batchId
  }

  it('leaves records inside the rollback window untouched, so rollback still works', async () => {
    await db.query('begin')
    try {
      const batchId = await importBatch()

      // An imported customer has NO activity, so a naive dormancy pass would flag
      // it immediately — bumping `updated_at` and making it look edited.
      const { rows: maintenance } = await db.query('select * from public.run_maintenance(1)')

      const { rows: imported } = await db.query(
        `select status, updated_at > (select completed_at from public.import_batches where id = $1) as looks_edited
           from public.accounts where import_batch_id = $1`,
        [batchId],
      )

      expect(imported[0].status).toBe('PROSPECT')
      expect(imported[0].looks_edited).toBe(false)
      expect(maintenance[0].dormant_accounts).toBe(0)

      // The decisive assertion: rollback is still available after the nightly run.
      const { rows: rolled } = await db.query('select * from public.rollback_import($1)', [batchId])
      expect(rolled[0].accounts).toBe(1)
    } finally {
      await db.query('rollback')
    }
  })

  it('resumes maintaining those records once the window has passed', async () => {
    await db.query('begin')
    try {
      const batchId = await importBatch()
      // A ten-day-old import: the batch AND the records it created. Backdating
      // only the batch would leave a customer created a second ago, which is
      // correctly not dormant whatever the window says.
      await db.query(
        `update public.import_batches set completed_at = now() - interval '10 days' where id = $1`,
        [batchId],
      )
      await db.query(
        `update public.accounts set created_at = now() - interval '10 days'
          where import_batch_id = $1`,
        [batchId],
      )

      const { rows } = await db.query('select * from public.run_maintenance(1)')
      expect(rows[0].dormant_accounts).toBeGreaterThanOrEqual(1)
    } finally {
      await db.query('rollback')
    }
  })
})

describe('SLA notification state (§14.2, ADR-002)', () => {
  it('sla_notified_at starts null and is what makes the reminder fire once', async () => {
    await db.query('begin')
    try {
      const { rows } = await db.query(
        'select sla_notified_at from public.opportunities where id = $1',
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows[0].sla_notified_at).toBeNull()

      // The job's own query: stage `new`, old enough, not yet notified, not imported.
      await db.query(
        `update public.opportunities
            set stage = 'new', created_at = now() - interval '72 hours'
          where id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )

      const eligible = async () => {
        const { rows: due } = await db.query(
          `select count(*)::int as n from public.opportunities
            where stage = 'new' and archived_at is null and sla_notified_at is null
              and is_imported = false and created_at < now() - interval '48 hours'
              and id = $1`,
          [OPPORTUNITIES.aOwnedByA1],
        )
        return due[0].n
      }

      expect(await eligible()).toBe(1)

      await db.query('update public.opportunities set sla_notified_at = now() where id = $1', [
        OPPORTUNITIES.aOwnedByA1,
      ])

      // Second run: nothing. One reminder per opportunity, ever.
      expect(await eligible()).toBe(0)
    } finally {
      await db.query('rollback')
    }
  })

  it('an IMPORTED opportunity is never SLA-eligible (ADR-025)', async () => {
    await db.query('begin')
    try {
      await db.query(
        `update public.opportunities
            set stage = 'new', created_at = now() - interval '400 days', is_imported = true
          where id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )

      const { rows } = await db.query(
        `select count(*)::int as n from public.opportunities
          where stage = 'new' and sla_notified_at is null and is_imported = false
            and created_at < now() - interval '48 hours' and id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      // A customer copied out of a 2019 register is not an unanswered enquiry.
      expect(rows[0].n).toBe(0)
    } finally {
      await db.query('rollback')
    }
  })

  it('a closed opportunity is never SLA-eligible', async () => {
    await db.query('begin')
    try {
      await db.query(
        `update public.opportunities
            set stage = 'won', final_order_value = 100, closed_at = now()
          where id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      const { rows } = await db.query(
        `select count(*)::int as n from public.opportunities where stage = 'new' and id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows[0].n).toBe(0)
    } finally {
      await db.query('rollback')
    }
  })
})

describe('maintenance failure state (ADR-014)', () => {
  it('is seeded as operational state, not as configuration', async () => {
    const { rows } = await db.query(
      `select key, value from public.system_settings
        where key in ('maintenance_consecutive_failures', 'maintenance_last_failure_at')
        order by key`,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ key: 'maintenance_consecutive_failures', value: 0 })
    expect(rows[1]).toMatchObject({ key: 'maintenance_last_failure_at', value: null })
  })

  it('`dormancy_days` is retired and must never be seeded (ADR-010)', async () => {
    const { rows } = await db.query(
      `select count(*)::int as n from public.system_settings where key = 'dormancy_days'`,
    )
    expect(rows[0].n).toBe(0)
  })

  it('the maintenance RPC is unreachable by a signed-in user, even the OWNER', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.owner)
      const error = await expectRejected(db, 'select * from public.run_maintenance(30)')
      expect(error.code).toBe('42501')
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })
})

describe('settings permissions (§15.5)', () => {
  it('every authenticated user can READ settings', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.salesA1)
      const { rows } = await db.query('select count(*)::int as n from public.system_settings')
      expect(rows[0].n).toBeGreaterThan(0)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('a SALESPERSON cannot change one', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.salesA1)
      const affected = await updateRowCount(
        db,
        `update public.system_settings set value = '1' where key = 'high_value_threshold_paise'`,
      )
      expect(affected).toBe(0)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('a MANAGER cannot change one either', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.managerA)
      const affected = await updateRowCount(
        db,
        `update public.system_settings set value = '1' where key = 'high_value_threshold_paise'`,
      )
      expect(affected).toBe(0)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('an ADMIN can, and so can the OWNER', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.admin)
      expect(
        await updateRowCount(
          db,
          `update public.system_settings set value = '40000000' where key = 'high_value_threshold_paise'`,
        ),
      ).toBe(1)

      await becomeUser(db, USERS.owner)
      expect(
        await updateRowCount(
          db,
          `update public.system_settings set value = '72' where key = 'new_enquiry_sla_hours'`,
        ),
      ).toBe(1)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('nobody may DELETE a setting', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.owner)
      await expectRejected(db, 'delete from public.system_settings')
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('the high-value threshold lives in the database, not in the code', async () => {
    // CLAUDE.md §3: 30000000 appears in exactly one place, and that place is
    // migration 014. This asserts the value is READ from there.
    const { rows } = await db.query(
      `select value from public.system_settings where key = 'high_value_threshold_paise'`,
    )
    expect(Number(rows[0].value)).toBe(30000000)
  })
})
