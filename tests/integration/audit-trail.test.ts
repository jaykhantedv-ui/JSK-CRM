import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ACCOUNTS,
  OPPORTUNITIES,
  OUTLETS,
  USERS,
  asPostgres,
  asUser,
  connect,
  expectRejected,
  updateRowCount,
  type Db,
} from './harness'

/**
 * `opportunity_events` — the audit trail (§5.9, §9.2, ADR-001, ADR-003, ADR-007).
 *
 * The trigger is the SINGLE WRITER, so no path can bypass the audit. There is no
 * INSERT policy for callers, no UPDATE policy and no DELETE policy — for anyone,
 * including OWNER. Historical stage changes are never deleted or rewritten.
 */

let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db?.end()
})

async function newOpportunity(tx: Db, stage = 'new'): Promise<string> {
  const { rows } = await tx.query(
    `insert into public.opportunities
       (title, account_id, owner_id, outlet_id, category, estimated_value, stage, created_by)
     values ('audit subject', $1, $2, $3, 'TILES', 100, $4, $2)
     returning id`,
    [ACCOUNTS.aOwnedByA1, USERS.salesA1, OUTLETS.a, stage],
  )
  return rows[0].id
}

/**
 * The events on one opportunity.
 *
 * Deliberately NOT ordered by `created_at`: the column defaults to `now()`, which
 * in PostgreSQL is transaction START time, so every event written inside one
 * transaction carries an identical timestamp and their relative order is
 * undefined. Since §16.3 makes multi-event transactions the norm — a stage change
 * and a reassignment in one RPC — that ambiguity is real rather than academic.
 * Raised as SPEC_AUDIT P1-05; these tests assert on content, not on order.
 */
async function events(tx: Db, opportunityId: string) {
  const { rows } = await tx.query(
    `select event_type, from_stage, to_stage, from_owner_id, to_owner_id, reason, actor_id
     from public.opportunity_events where opportunity_id = $1`,
    [opportunityId],
  )
  return rows as Array<Record<string, string | null>>
}

function types(rows: Array<Record<string, string | null>>): string[] {
  return rows.map((row) => String(row.event_type)).sort()
}

function ofType(rows: Array<Record<string, string | null>>, eventType: string) {
  const found = rows.filter((row) => row.event_type === eventType)
  if (found.length !== 1) {
    throw new Error(`Expected exactly one ${eventType} event, found ${found.length}`)
  }
  return found[0]
}

describe('the trigger records every change', () => {
  it('writes CREATED on insert', async () => {
    await asPostgres(db, async (tx) => {
      const id = await newOpportunity(tx)
      const [created] = await events(tx, id)
      expect(created.event_type).toBe('CREATED')
      expect(created.to_stage).toBe('new')
      expect(created.to_owner_id).toBe(USERS.salesA1)
    })
  })

  it('writes STAGE_CHANGED with both stages', async () => {
    await asPostgres(db, async (tx) => {
      const id = await newOpportunity(tx)
      await tx.query(`update public.opportunities set stage = 'qualified' where id = $1`, [id])
      const rows = await events(tx, id)
      expect(types(rows)).toEqual(['CREATED', 'STAGE_CHANGED'])
      expect(ofType(rows, 'STAGE_CHANGED')).toMatchObject({
        from_stage: 'new',
        to_stage: 'qualified',
      })
    })
  })

  it('writes WON and LOST rather than STAGE_CHANGED for the terminal stages', async () => {
    await asPostgres(db, async (tx) => {
      const won = await newOpportunity(tx, 'negotiation')
      await tx.query(
        `update public.opportunities
         set stage = 'won', final_order_value = 500, closed_at = now() where id = $1`,
        [won],
      )
      expect(types(await events(tx, won))).toEqual(['CREATED', 'WON'])

      const lost = await newOpportunity(tx, 'qualified')
      await tx.query(
        `update public.opportunities
         set stage = 'lost', lost_reason = 'PRICE', closed_at = now() where id = $1`,
        [lost],
      )
      expect(types(await events(tx, lost))).toEqual(['CREATED', 'LOST'])
    })
  })

  it('ADR-007: reopening a won opportunity writes REOPENED and preserves the WON event', async () => {
    await asPostgres(db, async (tx) => {
      const id = await newOpportunity(tx, 'negotiation')
      await tx.query(
        `update public.opportunities
         set stage = 'won', final_order_value = 500, closed_at = now() where id = $1`,
        [id],
      )
      await tx.query(`select set_config('app.event_reason', 'entered against the wrong site', true)`)
      await tx.query(
        `update public.opportunities
         set stage = 'qualified', final_order_value = null, closed_at = null where id = $1`,
        [id],
      )

      const rows = await events(tx, id)
      expect(types(rows)).toEqual(['CREATED', 'REOPENED', 'WON'])

      // The historical WON row is still there, untouched.
      expect(ofType(rows, 'WON')).toMatchObject({ to_stage: 'won' })
      expect(ofType(rows, 'REOPENED')).toMatchObject({
        from_stage: 'won',
        to_stage: 'qualified',
        reason: 'entered against the wrong site',
      })

      const { rows: opp } = await tx.query(
        'select final_order_value, closed_at from public.opportunities where id = $1',
        [id],
      )
      expect(opp[0].final_order_value).toBeNull()
      expect(opp[0].closed_at).toBeNull()
    })
  })

  it('ADR-007: reopening does not touch accounts.status', async () => {
    await asPostgres(db, async (tx) => {
      await tx.query(`update public.accounts set status = 'ACTIVE' where id = $1`, [
        ACCOUNTS.aOwnedByA1,
      ])
      const id = await newOpportunity(tx, 'negotiation')
      await tx.query(
        `update public.opportunities
         set stage = 'won', final_order_value = 500, closed_at = now() where id = $1`,
        [id],
      )
      await tx.query(
        `update public.opportunities
         set stage = 'qualified', final_order_value = null, closed_at = null where id = $1`,
        [id],
      )

      // The account may hold other won opportunities; reverting its status would
      // misrepresent the relationship.
      const { rows } = await tx.query('select status from public.accounts where id = $1', [
        ACCOUNTS.aOwnedByA1,
      ])
      expect(rows[0].status).toBe('ACTIVE')
    })
  })

  it('writes OWNER_CHANGED on reassignment', async () => {
    await asPostgres(db, async (tx) => {
      const id = await newOpportunity(tx)
      await tx.query('update public.opportunities set owner_id = $1 where id = $2', [
        USERS.salesA2,
        id,
      ])
      expect(ofType(await events(tx, id), 'OWNER_CHANGED')).toMatchObject({
        from_owner_id: USERS.salesA1,
        to_owner_id: USERS.salesA2,
      })
    })
  })

  it('writes ARCHIVED and RESTORED', async () => {
    await asPostgres(db, async (tx) => {
      const id = await newOpportunity(tx)
      await tx.query('update public.opportunities set archived_at = now() where id = $1', [id])
      await tx.query('update public.opportunities set archived_at = null where id = $1', [id])
      expect(types(await events(tx, id))).toEqual(['ARCHIVED', 'CREATED', 'RESTORED'])
    })
  })
})

describe('ADR-001: the reason arrives through a transaction-local GUC', () => {
  it('records the reason set immediately before the write', async () => {
    await asPostgres(db, async (tx) => {
      const id = await newOpportunity(tx, 'selection')
      await tx.query(
        `update public.opportunities
         set stage = 'quoted', quotation_ref = 'Q1', quoted_value = 1,
             quotation_date = current_date
         where id = $1`,
        [id],
      )
      await tx.query(`select set_config('app.event_reason', 'customer asked to re-select', true)`)
      await tx.query(`update public.opportunities set stage = 'selection' where id = $1`, [id])

      const rows = await events(tx, id)
      const backward = rows.filter(
        (row) => row.event_type === 'STAGE_CHANGED' && row.to_stage === 'selection',
      )
      expect(backward).toHaveLength(1)
      expect(backward[0].reason).toBe('customer asked to re-select')
    })
  })

  it('records null when no reason was set, rather than a stale one', async () => {
    await asPostgres(db, async (tx) => {
      const id = await newOpportunity(tx)
      await tx.query(`update public.opportunities set stage = 'qualified' where id = $1`, [id])
      expect(ofType(await events(tx, id), 'STAGE_CHANGED').reason).toBeNull()
    })
  })
})

describe('ADR-003: the system actor covers writes with no auth.uid()', () => {
  it('attributes a service-role write to the system user, not to nobody', async () => {
    await asPostgres(db, async (tx) => {
      // No `request.jwt.claims` is set, which is exactly the situation a cron
      // route or the import executor is in.
      const { rows } = await tx.query(
        `insert into public.opportunities
           (title, account_id, outlet_id, category, estimated_value)
         values ('automated', $1, $2, 'TILES', 100) returning id`,
        [ACCOUNTS.aOwnedByA1, OUTLETS.a],
      )
      const [created] = await events(tx, rows[0].id)
      const { rows: system } = await tx.query('select public.system_user_id() as id')
      expect(created.actor_id).toBe(system[0].id)
    })
  })

  it('the system user can never authenticate or pass a policy', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        'select is_active from public.users where id = public.system_user_id()',
      )
      expect(rows[0].is_active).toBe(false)
    })
  })
})

describe('append-only, for everyone', () => {
  it('has no INSERT, UPDATE or DELETE policy on opportunity_events', async () => {
    await asPostgres(db, async (tx) => {
      const { rows } = await tx.query(
        `select cmd from pg_policies where schemaname = 'public' and tablename = 'opportunity_events'`,
      )
      expect(rows.map((row: { cmd: string }) => row.cmd)).toEqual(['SELECT'])
    })
  })

  it.each([
    ['the owner', USERS.owner],
    ['a manager', USERS.managerA],
    ['a salesperson', USERS.salesA1],
  ])('%s cannot rewrite history', async (_who, userId) => {
    await asUser(db, userId, async (tx) => {
      const updated = await updateRowCount(
        tx,
        `update public.opportunity_events set reason = 'tampered'`,
      ).catch(() => 0)
      expect(updated).toBe(0)
    })

    await asUser(db, userId, async (tx) => {
      const error = await expectRejected(tx, 'delete from public.opportunity_events')
      expect(error.code).toBe('42501')
    })
  })

  it('a caller cannot forge an event directly', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.opportunity_events (opportunity_id, event_type, actor_id)
         values ($1, 'WON', $2)`,
        [OPPORTUNITIES.aOwnedByA1, USERS.salesA1],
      )
      expect(error.code).toBe('42501')
    })
  })

  it('a salesperson reads the audit trail of an opportunity they own, and no other', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(
        'select opportunity_id from public.opportunity_events group by opportunity_id',
      )
      const ids = rows.map((row: { opportunity_id: string }) => row.opportunity_id)
      expect(ids).toContain(OPPORTUNITIES.aOwnedByA1)
      expect(ids).not.toContain(OPPORTUNITIES.aOwnedByA2)
      expect(ids).not.toContain(OPPORTUNITIES.bOwnedByB1)
    })
  })
})
