import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ACCOUNTS,
  OUTLETS,
  PROJECTS,
  USERS,
  asPostgres,
  connect,
  expectRejected,
  type Db,
} from './harness'

/**
 * The check constraints, generated columns and partial unique indexes (§5).
 *
 * **These constraints are the backbone of data quality.** They exist so a bug in
 * the service layer cannot produce a won opportunity with no value. If one of
 * them ever blocks a legitimate flow, the FLOW is wrong — never relax the
 * constraint to make code easier (CLAUDE.md §5).
 *
 * Arranged as the database owner, because what is under test is the SCHEMA, not
 * a policy. The policies have their own suite, asserted as the restricted role.
 */

let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db?.end()
})

const NEW_OPP = `insert into public.opportunities
  (title, account_id, owner_id, outlet_id, category, estimated_value, stage`

describe('opportunity check constraints', () => {
  it('won requires a final order value', async () => {
    await asPostgres(db, async (tx) => {
      const error = await expectRejected(
        tx,
        `${NEW_OPP}, closed_at)
         values ('x', $1, $2, $3, 'TILES', 100, 'won', now())`,
        [ACCOUNTS.aOwnedByA1, USERS.salesA1, OUTLETS.a],
      )
      expect(error.constraint).toBe('won_requires_value')
    })
  })

  it('won requires a close date', async () => {
    await asPostgres(db, async (tx) => {
      const error = await expectRejected(
        tx,
        `${NEW_OPP}, final_order_value)
         values ('x', $1, $2, $3, 'TILES', 100, 'won', 100)`,
        [ACCOUNTS.aOwnedByA1, USERS.salesA1, OUTLETS.a],
      )
      expect(error.constraint).toBe('won_requires_closed')
    })
  })

  it('lost requires a reason', async () => {
    await asPostgres(db, async (tx) => {
      const error = await expectRejected(
        tx,
        `${NEW_OPP}, closed_at)
         values ('x', $1, $2, $3, 'TILES', 100, 'lost', now())`,
        [ACCOUNTS.aOwnedByA1, USERS.salesA1, OUTLETS.a],
      )
      expect(error.constraint).toBe('lost_requires_reason')
    })
  })

  it('quoted requires the quotation reference, date and value', async () => {
    await asPostgres(db, async (tx) => {
      const error = await expectRejected(
        tx,
        `${NEW_OPP})
         values ('x', $1, $2, $3, 'TILES', 100, 'quoted')`,
        [ACCOUNTS.aOwnedByA1, USERS.salesA1, OUTLETS.a],
      )
      expect(error.constraint).toBe('quoted_requires_quotation')
    })
  })

  it('REGRESSION (ADR-006): selection → negotiation succeeds with NO quotation information', async () => {
    // §9.2 permits this transition and §9.1 states no entry requirement for
    // `negotiation`. A salesperson must never be forced to invent quotation data
    // in order to enter it.
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        `${NEW_OPP}) values ('selection deal', $1, $2, $3, 'TILES', 100, 'selection') returning id`,
        [ACCOUNTS.aOwnedByA1, USERS.salesA1, OUTLETS.a],
      )
      const result = await tx.query(
        `update public.opportunities set stage = 'negotiation' where id = $1 returning stage`,
        [rows[0].id],
      )
      expect(result.rows[0].stage).toBe('negotiation')
    })
  })

  it('verbal_confirmation also needs no quotation information (ADR-006)', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        `${NEW_OPP}) values ('vc deal', $1, $2, $3, 'TILES', 100, 'verbal_confirmation') returning stage`,
        [ACCOUNTS.aOwnedByA1, USERS.salesA1, OUTLETS.a],
      )
      expect(rows[0].stage).toBe('verbal_confirmation')
    })
  })

  it('a next action needs both a type and a date, or neither', async () => {
    await asPostgres(db, async (tx) => {
      const error = await expectRejected(
        tx,
        `${NEW_OPP}, next_action)
         values ('x', $1, $2, $3, 'TILES', 100, 'new', 'CALL')`,
        [ACCOUNTS.aOwnedByA1, USERS.salesA1, OUTLETS.a],
      )
      expect(error.constraint).toBe('next_action_pairing')
    })
  })

  it('nurture requires a date to revisit', async () => {
    await asPostgres(db, async (tx) => {
      const error = await expectRejected(
        tx,
        `${NEW_OPP}) values ('x', $1, $2, $3, 'TILES', 100, 'nurture')`,
        [ACCOUNTS.aOwnedByA1, USERS.salesA1, OUTLETS.a],
      )
      expect(error.constraint).toBe('nurture_needs_date')
    })
  })

  it('an opportunity must belong to an outlet (ADR-016)', async () => {
    await asPostgres(db, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.opportunities (title, account_id, owner_id, category, estimated_value)
         values ('x', $1, $2, 'TILES', 100)`,
        [ACCOUNTS.aOwnedByA1, USERS.salesA1],
      )
      expect(error.code).toBe('23502')
    })
  })

  it('an unassigned opportunity is legal — it is a real state (§13.3)', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        `insert into public.opportunities (title, account_id, outlet_id, category, estimated_value)
         values ('unassigned', $1, $2, 'TILES', 100) returning owner_id`,
        [ACCOUNTS.aOwnedByA1, OUTLETS.a],
      )
      expect(rows[0].owner_id).toBeNull()
    })
  })
})

describe('reachability constraints', () => {
  it('an account needs a phone or an email (ADR-013)', async () => {
    await asPostgres(db, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.accounts (name, account_type, owner_id, outlet_id)
         values ('Unreachable', 'HOMEOWNER', $1, $2)`,
        [USERS.salesA1, OUTLETS.a],
      )
      expect(error.constraint).toBe('account_reachable')
    })
  })

  it('an email alone is enough for an account', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        `insert into public.accounts (name, account_type, email, owner_id, outlet_id)
         values ('Email Only', 'ARCHITECT', 'a@b.test', $1, $2) returning email_normalized`,
        [USERS.salesA1, OUTLETS.a],
      )
      expect(rows[0].email_normalized).toBe('a@b.test')
    })
  })

  it('a contact needs a phone or an email', async () => {
    await asPostgres(db, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.contacts (full_name, owner_id) values ('No Contact Method', $1)`,
        [USERS.salesA1],
      )
      expect(error.constraint).toBe('contact_reachable')
    })
  })

  it('a stakeholder must point at a person or a company', async () => {
    await asPostgres(db, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.project_stakeholders (project_id, role) values ($1, 'ARCHITECT')`,
        [PROJECTS.aOwnedByA1],
      )
      expect(error.constraint).toBe('stakeholder_target')
    })
  })
})

describe('partial unique indexes', () => {
  it('a project has at most one primary stakeholder', async () => {
    await asPostgres(db, async (tx) => {
      await tx.query(
        `insert into public.project_stakeholders (project_id, account_id, role, is_primary)
         values ($1, $2, 'OWNER_BUYER', true)`,
        [PROJECTS.aOwnedByA1, ACCOUNTS.aOwnedByA1],
      )
      const error = await expectRejected(
        tx,
        `insert into public.project_stakeholders (project_id, account_id, role, is_primary)
         values ($1, $2, 'BUILDER', true)`,
        [PROJECTS.aOwnedByA1, ACCOUNTS.aOwnedByA2],
      )
      expect(error.constraint).toBe('one_primary_per_project')
    })
  })

  it('non-primary stakeholders are unlimited', async () => {
    await asPostgres(db, async (tx) => {
      await tx.query(
        `insert into public.project_stakeholders (project_id, account_id, role)
         values ($1, $2, 'OWNER_BUYER')`,
        [PROJECTS.aOwnedByA1, ACCOUNTS.aOwnedByA1],
      )
      const { rowCount } = await tx.query(
        `insert into public.project_stakeholders (project_id, account_id, role)
         values ($1, $2, 'BUILDER')`,
        [PROJECTS.aOwnedByA1, ACCOUNTS.aOwnedByA2],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('a user holds an outlet once at a time, and may return to one they left', async () => {
    await asPostgres(db, async (tx) => {
      const error = await expectRejected(
        tx,
        'insert into public.user_outlets (user_id, outlet_id) values ($1, $2)',
        [USERS.managerA, OUTLETS.a],
      )
      expect(error.code).toBe('23505')
    })

    await asPostgres(db, async (tx) => {
      await tx.query(
        'update public.user_outlets set revoked_at = now() where user_id = $1 and outlet_id = $2',
        [USERS.managerA, OUTLETS.a],
      )
      const { rowCount } = await tx.query(
        'insert into public.user_outlets (user_id, outlet_id) values ($1, $2)',
        [USERS.managerA, OUTLETS.a],
      )
      expect(rowCount).toBe(1)
    })
  })
})

describe('generated columns', () => {
  it.each([
    ['+91 98430 12345', '9843012345'],
    ['098430-12345', '9843012345'],
    ['91 (98430) 12345', '9843012345'],
    ['9843012345', '9843012345'],
    ['12345', null],
    [null, null],
  ])('normalize_phone(%s) is %s', async (input, expected) => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query('select public.normalize_phone($1) as normalized', [input])
      expect(rows[0].normalized).toBe(expected)
    })
  })

  it('phone_normalized is maintained on accounts, and is deliberately not unique', async () => {
    // Two family members legitimately share a number; duplicate detection is
    // advisory (§8.9), so this must be an insert that succeeds.
    await asPostgres(db, async (tx) => {
      const insert = `insert into public.accounts (name, account_type, phone, owner_id, outlet_id)
                      values ($1, 'HOMEOWNER', '+91 98430 99999', $2, $3) returning phone_normalized`
      const first = await tx.query(insert, ['Husband', USERS.salesA1, OUTLETS.a])
      const second = await tx.query(insert, ['Wife', USERS.salesA1, OUTLETS.a])
      expect(first.rows[0].phone_normalized).toBe('9843099999')
      expect(second.rows[0].phone_normalized).toBe('9843099999')
    })
  })

  it('updated_at is maintained by the trigger, not by the caller', async () => {
    await asPostgres(db, async (tx) => {
      const before = await tx.query('select updated_at from public.accounts where id = $1', [
        ACCOUNTS.aOwnedByA1,
      ])
      await tx.query(`select pg_sleep(0.01)`)
      const after = await tx.query(
        `update public.accounts set notes = 'touched' where id = $1 returning updated_at`,
        [ACCOUNTS.aOwnedByA1],
      )
      expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(
        new Date(before.rows[0].updated_at).getTime(),
      )
    })
  })
})

describe('system settings', () => {
  it('seeds every key the application reads, and retires dormancy_days (ADR-010)', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query('select key from public.system_settings order by key')
      const keys = rows.map((row: { key: string }) => row.key)

      expect(keys).toEqual([
        'account_dormancy_days',
        'cities',
        'high_value_threshold_paise',
        'maintenance_consecutive_failures',
        'maintenance_last_failure_at',
        'material_types',
        'new_enquiry_sla_hours',
        'opportunity_dormancy_days',
        'owner_summary_schedule',
        'stage_probabilities',
        'stage_stall_days',
      ])
      expect(keys).not.toContain('dormancy_days')
    })
  })

  it('carries the ten Erode revenue taluks, without Chennimalai (TODO-BD-06)', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(`select value from public.system_settings where key = 'cities'`)
      const cities: string[] = rows[0].value
      expect(cities).toHaveLength(10)
      expect(cities).toContain('Erode')
      expect(cities).toContain('Perundurai')
      // Chennimalai is a development block and firka WITHIN Perundurai taluk. It
      // belongs in `area`, never in the taluk list.
      expect(cities).not.toContain('Chennimalai')
    })
  })

  it('holds the approved high-value threshold in exactly one place (TODO-BD-02)', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        `select value from public.system_settings where key = 'high_value_threshold_paise'`,
      )
      expect(rows[0].value).toBe(30000000)
    })
  })
})
