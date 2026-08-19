import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { businessDate } from '@/lib/dates'

import {
  ACCOUNTS,
  OPPORTUNITIES,
  OUTLETS,
  USERS,
  asPostgres,
  asUser,
  connect,
  type Db,
} from './harness'

/**
 * The business day is Asia/Kolkata (§8.11, SPEC_AUDIT B-10, CLAUDE.md §10).
 *
 * Supabase runs its sessions in UTC, so a bare `current_date` or a bare
 * `timestamptz::date` is wrong for five and a half hours of every day: between
 * 18:30 and 24:00 IST it still reads as yesterday. The overdue list — the single
 * most important thing this CRM produces — would be silently wrong every evening.
 *
 * And `v_opportunity_flags` (§10.3) must be `security_invoker = true`. A view
 * without it runs with the definer's rights and publishes every salesperson's
 * pipeline to every other salesperson (§25).
 */

let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db?.end()
})

describe('the IST date expression', () => {
  it.each([
    // instant (UTC)             IST business day   naive UTC date
    ['2026-08-19T18:29:00Z', '2026-08-19', '2026-08-19'],
    ['2026-08-19T18:30:00Z', '2026-08-20', '2026-08-19'], // the boundary
    ['2026-08-19T19:00:00Z', '2026-08-20', '2026-08-19'],
    ['2026-08-19T23:59:00Z', '2026-08-20', '2026-08-19'],
    ['2026-08-20T00:01:00Z', '2026-08-20', '2026-08-20'],
    // A year boundary, where getting this wrong moves a deal into the wrong year.
    ['2025-12-31T19:00:00Z', '2026-01-01', '2025-12-31'],
  ])('%s is %s in Asia/Kolkata, not %s', async (instant, ist, naive) => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        `select ($1::timestamptz at time zone 'Asia/Kolkata')::date::text as ist,
                ($1::timestamptz)::date::text                            as naive`,
        [instant],
      )
      expect(rows[0].ist).toBe(ist)
      expect(rows[0].naive).toBe(naive)
    })
  })

  it('TypeScript and SQL agree on the business day for the same instant', async () => {
    // `lib/dates.ts` and the SQL expression are the two halves of one rule. If
    // they ever disagree, a screen and its query disagree about "today".
    const instants = [
      '2026-08-19T18:29:00Z',
      '2026-08-19T18:30:00Z',
      '2026-08-19T23:59:00Z',
      '2026-08-20T00:01:00Z',
      '2025-12-31T19:00:00Z',
    ]

    await asPostgres(db, async (tx) => {
      for (const instant of instants) {
        const { rows } = await tx.query(
          `select ($1::timestamptz at time zone 'Asia/Kolkata')::date::text as ist`,
          [instant],
        )
        expect(businessDate(instant)).toBe(rows[0].ist)
      }
    })
  })
})

describe('v_opportunity_flags', () => {
  it('is created with security_invoker, so RLS still applies', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        `select reloptions from pg_class where relname = 'v_opportunity_flags'`,
      )
      expect(rows[0].reloptions).toContain('security_invoker=true')
    })
  })

  it('shows a salesperson only their own opportunities', async () => {
    // The negative case is the point: a view without security_invoker would
    // return every row here regardless of the policy on the base table.
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query('select id from public.v_opportunity_flags')
      const ids = rows.map((row: { id: string }) => row.id)
      expect(ids).toContain(OPPORTUNITIES.aOwnedByA1)
      expect(ids).not.toContain(OPPORTUNITIES.aOwnedByA2)
      expect(ids).not.toContain(OPPORTUNITIES.bOwnedByB1)
    })
  })

  it('shows an outlet manager their outlet, and not another', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const { rows } = await tx.query('select id from public.v_opportunity_flags')
      const ids = rows.map((row: { id: string }) => row.id)
      expect(ids).toContain(OPPORTUNITIES.aOwnedByA2)
      expect(ids).not.toContain(OPPORTUNITIES.bOwnedByB1)
    })
  })

  it('never uses a bare current_date', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        `select pg_get_viewdef('public.v_opportunity_flags'::regclass, true) as sql`,
      )
      const sql: string = rows[0].sql
      // Every date expression in the view converts to Asia/Kolkata first:
      // is_overdue, is_due_today, days_in_stage and days_since_activity.
      expect(sql.match(/AT TIME ZONE 'Asia\/Kolkata'/g) ?? []).toHaveLength(6)
      expect(sql).not.toMatch(/\bcurrent_date\b/i)
    })
  })

  it('excludes archived opportunities', async () => {
    await asPostgres(db, async (tx) => {
      await tx.query('update public.opportunities set archived_at = now() where id = $1', [
        OPPORTUNITIES.aOwnedByA1,
      ])
      const { rows } = await tx.query('select id from public.v_opportunity_flags where id = $1', [
        OPPORTUNITIES.aOwnedByA1,
      ])
      expect(rows).toHaveLength(0)
    })
  })
})

describe('derived accountability flags', () => {
  async function flagsFor(tx: Db, id: string) {
    const { rows } = await tx.query(
      `select is_active, in_pipeline, is_overdue, is_due_today, is_missing_next_action,
              is_unassigned, days_in_stage, days_since_activity
       from public.v_opportunity_flags where id = $1`,
      [id],
    )
    return rows[0]
  }

  it('is_due_today follows the Asia/Kolkata date, not the UTC one', async () => {
    await asPostgres(db, async (tx) => {
      await tx.query(
        `update public.opportunities
         set next_action = 'CALL',
             next_action_date = (now() at time zone 'Asia/Kolkata')::date
         where id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      const flags = await flagsFor(tx, OPPORTUNITIES.aOwnedByA1)
      expect(flags.is_due_today).toBe(true)
      expect(flags.is_overdue).toBe(false)
    })
  })

  it('is_overdue is true the day after', async () => {
    await asPostgres(db, async (tx) => {
      await tx.query(
        `update public.opportunities
         set next_action = 'CALL',
             next_action_date = (now() at time zone 'Asia/Kolkata')::date - 1
         where id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      const flags = await flagsFor(tx, OPPORTUNITIES.aOwnedByA1)
      expect(flags.is_overdue).toBe(true)
      expect(flags.is_due_today).toBe(false)
    })
  })

  it('days_in_stage counts Asia/Kolkata days', async () => {
    await asPostgres(db, async (tx) => {
      // 00:30 IST today, which is 19:00 UTC YESTERDAY. A naive UTC computation
      // reports a day that has not happened.
      await tx.query(
        `update public.opportunities
         set stage_changed_at = ((now() at time zone 'Asia/Kolkata')::date + time '00:30')
                                at time zone 'Asia/Kolkata'
         where id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect((await flagsFor(tx, OPPORTUNITIES.aOwnedByA1)).days_in_stage).toBe(0)
    })
  })

  it('a closed opportunity is never overdue and never due today (M-07)', async () => {
    await asPostgres(db, async (tx) => {
      await tx.query(
        `update public.opportunities
         set stage = 'lost', lost_reason = 'PRICE', closed_at = now(),
             next_action = 'CALL', next_action_date = current_date - 30
         where id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      const flags = await flagsFor(tx, OPPORTUNITIES.aOwnedByA1)
      expect(flags.is_active).toBe(false)
      expect(flags.in_pipeline).toBe(false)
      expect(flags.is_overdue).toBe(false)
      expect(flags.is_due_today).toBe(false)
      expect(flags.is_missing_next_action).toBe(false)
    })
  })

  it('nurture is active but out of the pipeline (§9.1)', async () => {
    await asPostgres(db, async (tx) => {
      await tx.query(
        `update public.opportunities
         set stage = 'nurture', next_action = 'AWAIT_CUSTOMER',
             next_action_date = current_date + 90
         where id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      const flags = await flagsFor(tx, OPPORTUNITIES.aOwnedByA1)
      expect(flags.is_active).toBe(true)
      expect(flags.in_pipeline).toBe(false)
    })
  })

  it('flags are false rather than null when there is no next action (M-07)', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        `insert into public.opportunities
           (title, account_id, outlet_id, category, estimated_value)
         values ('no next action', $1, $2, 'TILES', 100) returning id`,
        [ACCOUNTS.aOwnedByA1, OUTLETS.a],
      )
      const flags = await flagsFor(tx, rows[0].id)
      expect(flags.is_overdue).toBe(false)
      expect(flags.is_due_today).toBe(false)
      expect(flags.is_missing_next_action).toBe(true)
      expect(flags.is_unassigned).toBe(true)
    })
  })
})
