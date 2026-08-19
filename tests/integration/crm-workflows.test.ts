import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ACCOUNTS, OPPORTUNITIES, OUTLETS, PROJECTS, USERS,
  asUser, connect, expectRejected, type Db,
} from './harness'

/**
 * The Core CRM workflows, proved against the real database (§19.2).
 *
 * Every test runs as a real role through the same path PostgREST uses, so a
 * policy that would reject a live request rejects it here. Nothing is mocked and
 * nothing is asserted as OWNER unless OWNER is the subject — §23 is explicit that
 * verifying a permission as OWNER proves nothing, because OWNER passes everything.
 */
let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db.end()
})

// ------------------------------------------- create customer + opportunity --

describe('createAccountWithOpportunity (§11.1)', () => {
  it('creates the account, the enquiry and the opening activity in one transaction', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(
        `select * from public.create_account_with_opportunity(
           $1,'HOMEOWNER',$2,'TILES',5000000,$3,$4,null,'Erode',null,null,'WALK_IN',$5,'CALL',current_date + 1)`,
        ['Test Homeowner', OUTLETS.a, 'Test Homeowner — Tiles — Aug 26', '9876543210', 'Wants floor tiles'],
      )

      const { account_id, opportunity_id, activity_id } = rows[0]
      expect(account_id).toBeTruthy()

      const account = await tx.query('select status, owner_id, outlet_id from public.accounts where id = $1', [account_id])
      // §8.4 — owner defaults to the current user, status to PROSPECT.
      expect(account.rows[0].status).toBe('PROSPECT')
      expect(account.rows[0].owner_id).toBe(USERS.salesA1)

      const opportunity = await tx.query(
        'select stage, owner_id, next_action, next_action_date from public.opportunities where id = $1',
        [opportunity_id],
      )
      expect(opportunity.rows[0].stage).toBe('new')
      expect(opportunity.rows[0].owner_id).toBe(USERS.salesA1)
      expect(opportunity.rows[0].next_action).toBe('CALL')

      // §11.1 — the enquiry itself is recorded as history, not left implicit.
      const activity = await tx.query('select type, purpose, summary from public.activities where id = $1', [activity_id])
      expect(activity.rows[0].type).toBe('NOTE')
      expect(activity.rows[0].purpose).toBe('ENQUIRY')
      expect(activity.rows[0].summary).toBe('Wants floor tiles')
    })
  })

  it('writes a CREATED audit event through the trigger', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(
        `select * from public.create_account_with_opportunity(
           $1,'HOMEOWNER',$2,'TILES',5000000,'t','9876543211')`,
        ['Audit Check', OUTLETS.a],
      )
      const events = await tx.query(
        'select event_type, to_stage from public.opportunity_events where opportunity_id = $1',
        [rows[0].opportunity_id],
      )
      expect(events.rows).toEqual([{ event_type: 'CREATED', to_stage: 'new' }])
    })
  })

  it('rejects a customer with neither a phone nor an email (ADR-013)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(
        tx,
        `select public.create_account_with_opportunity($1,'HOMEOWNER',$2,'TILES',1,'t')`,
        ['No Way To Reach', OUTLETS.a],
      )
      expect(error.constraint).toBe('account_reachable')
    })
  })

  it('rejects a next action with a date but no type (next_action_pairing)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(
        tx,
        `select public.create_account_with_opportunity(
           $1,'HOMEOWNER',$2,'TILES',1,'t','9876543212',null,null,null,null,'WALK_IN',null,null,current_date + 1)`,
        ['Half A Next Action', OUTLETS.a],
      )
      expect(error.constraint).toBe('next_action_pairing')
    })
  })

  it('does not block a save when a duplicate exists — advisory only (§8.9)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      // The fixture account Ravi Kumar already holds this number.
      const duplicates = await tx.query(
        `select signal from public.find_account_duplicates(0.6, 0.8, '9843011111')`,
      )
      expect(duplicates.rows[0].signal).toBe('PHONE')

      // Creating anyway must succeed. **Never block creation outright.**
      const { rows } = await tx.query(
        `select * from public.create_account_with_opportunity(
           $1,'HOMEOWNER',$2,'TILES',1,'t','9843011111')`,
        ['Ravi Kumar (second number holder)', OUTLETS.a],
      )
      expect(rows[0].account_id).toBeTruthy()
    })
  })
})

// ---------------------------------------------------------- stage changes --

describe('changeOpportunityStage (§9.3)', () => {
  it('requires the quotation fields to enter quoted (ADR-006)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(
        tx,
        `select public.change_opportunity_stage($1,'quoted')`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(error.constraint).toBe('quoted_requires_quotation')
    })
  })

  it('sets quotation_status to SENT on entering quoted', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(
        `select stage, quotation_status, quoted_value
           from public.change_opportunity_stage($1,'quoted',null,'Q-1',current_date,4800000)`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows[0].stage).toBe('quoted')
      expect(rows[0].quotation_status).toBe('SENT')
    })
  })

  it('does not require quotation data to enter negotiation (ADR-006)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await tx.query(`select public.change_opportunity_stage($1,'selection')`, [OPPORTUNITIES.aOwnedByA1])
      const { rows } = await tx.query(`select stage from public.change_opportunity_stage($1,'negotiation')`, [
        OPPORTUNITIES.aOwnedByA1,
      ])
      expect(rows[0].stage).toBe('negotiation')
    })
  })

  it('requires a value to mark won (won_requires_value)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await tx.query(`select public.change_opportunity_stage($1,'negotiation')`, [OPPORTUNITIES.aOwnedByA1])
      const error = await expectRejected(tx, `select public.change_opportunity_stage($1,'won')`, [
        OPPORTUNITIES.aOwnedByA1,
      ])
      expect(error.constraint).toBe('won_requires_value')
    })
  })

  it('on won: stores the value, sets closed_at, clears the next action and promotes the account', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await tx.query(
        `update public.opportunities set next_action = 'CALL', next_action_date = current_date where id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      await tx.query(`select public.change_opportunity_stage($1,'negotiation')`, [OPPORTUNITIES.aOwnedByA1])

      const { rows } = await tx.query(
        `select stage, final_order_value, closed_at, next_action, next_action_date
           from public.change_opportunity_stage($1,'won',null,null,null,null,4750000,'SO-77')`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows[0].stage).toBe('won')
      expect(Number(rows[0].final_order_value)).toBe(4750000)
      expect(rows[0].closed_at).not.toBeNull()
      // §8.7 — closing clears the next action, so a won deal cannot sit in an
      // overdue list forever.
      expect(rows[0].next_action).toBeNull()
      expect(rows[0].next_action_date).toBeNull()

      const account = await tx.query('select status from public.accounts where id = $1', [ACCOUNTS.aOwnedByA1])
      expect(account.rows[0].status).toBe('ACTIVE')
    })
  })

  it('requires a reason to mark lost (lost_requires_reason)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(tx, `select public.change_opportunity_stage($1,'lost')`, [
        OPPORTUNITIES.aOwnedByA1,
      ])
      expect(error.constraint).toBe('lost_requires_reason')
    })
  })

  it('on lost: records the reason, sets closed_at and clears the next action', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(
        `select stage, lost_reason, closed_at, next_action_date
           from public.change_opportunity_stage($1,'lost',null,null,null,null,null,null,'PRICE')`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows[0].stage).toBe('lost')
      expect(rows[0].lost_reason).toBe('PRICE')
      expect(rows[0].closed_at).not.toBeNull()
      expect(rows[0].next_action_date).toBeNull()
    })
  })

  it('requires a revisit date for nurture (nurture_needs_date)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(tx, `select public.change_opportunity_stage($1,'nurture')`, [
        OPPORTUNITIES.aOwnedByA1,
      ])
      expect(error.constraint).toBe('nurture_needs_date')
    })
  })

  it('records the reason for a backward move on the audit row (ADR-001)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await tx.query(`select public.change_opportunity_stage($1,'qualified')`, [OPPORTUNITIES.aOwnedByA1])
      await tx.query(`select public.change_opportunity_stage($1,'new',$2)`, [
        OPPORTUNITIES.aOwnedByA1,
        'Customer went quiet, re-qualifying',
      ])

      const { rows } = await tx.query(
        `select event_type, from_stage, to_stage, reason from public.opportunity_events
          where opportunity_id = $1 order by created_at desc limit 1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows[0]).toMatchObject({
        event_type: 'STAGE_CHANGED',
        from_stage: 'qualified',
        to_stage: 'new',
        reason: 'Customer went quiet, re-qualifying',
      })
    })
  })

  it('reopening a won opportunity clears the value and keeps the WON event (ADR-007)', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      await tx.query(`select public.change_opportunity_stage($1,'negotiation')`, [OPPORTUNITIES.aOwnedByA1])
      await tx.query(`select public.change_opportunity_stage($1,'won',null,null,null,null,9000000)`, [
        OPPORTUNITIES.aOwnedByA1,
      ])

      const { rows } = await tx.query(
        `select stage, final_order_value, closed_at
           from public.change_opportunity_stage($1,'qualified',$2)`,
        [OPPORTUNITIES.aOwnedByA1, 'Wrong record marked won'],
      )
      expect(rows[0].stage).toBe('qualified')
      expect(rows[0].final_order_value).toBeNull()
      expect(rows[0].closed_at).toBeNull()

      const events = await tx.query(
        `select event_type from public.opportunity_events where opportunity_id = $1 order by created_at`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      const types = events.rows.map((row: { event_type: string }) => row.event_type)
      // The historical WON is never deleted or rewritten (§9.2).
      expect(types).toContain('WON')
      expect(types).toContain('REOPENED')
    })
  })

  it('reopening a lost opportunity clears the stale lost reason', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      await tx.query(
        `select public.change_opportunity_stage($1,'lost',null,null,null,null,null,null,'PRICE')`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      const { rows } = await tx.query(
        `select stage, lost_reason, closed_at from public.change_opportunity_stage($1,'qualified',$2)`,
        [OPPORTUNITIES.aOwnedByA1, 'Customer came back'],
      )
      expect(rows[0].lost_reason).toBeNull()
      expect(rows[0].closed_at).toBeNull()
    })
  })

  it('a salesperson cannot change an opportunity in another outlet', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      // Invisible under RLS, so it reads as "does not exist" (§25).
      const error = await expectRejected(tx, `select public.change_opportunity_stage($1,'qualified')`, [
        OPPORTUNITIES.bOwnedByB1,
      ])
      expect(error.code).toBe('P0002')
    })
  })
})

// ----------------------------------------------------------- next actions --

describe('next actions (§8.3, §10.3)', () => {
  it('log_activity sets the next action from the same form', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await tx.query(
        `select public.log_activity($1,'CALL','Discussed hall tiles.','FOLLOW_UP','POSITIVE',$2,
           null,null,now(),null,null,null,'SITE_VISIT',current_date + 3)`,
        [ACCOUNTS.aOwnedByA1, OPPORTUNITIES.aOwnedByA1],
      )
      const { rows } = await tx.query(
        'select next_action, next_action_date from public.opportunities where id = $1',
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows[0].next_action).toBe('SITE_VISIT')
    })
  })

  it('"cannot determine yet" clears both fields and surfaces the exception', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await tx.query(
        `update public.opportunities set next_action='CALL', next_action_date=current_date where id=$1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      await tx.query(
        `select public.log_activity($1,'CALL','No answer.','FOLLOW_UP','NO_RESPONSE',$2,
           null,null,now(),null,null,null,null,null,null,true)`,
        [ACCOUNTS.aOwnedByA1, OPPORTUNITIES.aOwnedByA1],
      )
      const { rows } = await tx.query(
        'select next_action, next_action_date, is_missing_next_action from public.v_opportunity_flags where id = $1',
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows[0].next_action).toBeNull()
      expect(rows[0].next_action_date).toBeNull()
      // §8.3 — the exception list is the control, not a block on logging.
      expect(rows[0].is_missing_next_action).toBe(true)
    })
  })

  it('never gives a closed opportunity a next action', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await tx.query(
        `select public.change_opportunity_stage($1,'lost',null,null,null,null,null,null,'NO_RESPONSE')`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      await tx.query(
        `select public.log_activity($1,'NOTE','Closing note.','OTHER','NEUTRAL',$2,
           null,null,now(),null,null,null,'CALL',current_date + 5)`,
        [ACCOUNTS.aOwnedByA1, OPPORTUNITIES.aOwnedByA1],
      )
      const { rows } = await tx.query(
        'select next_action_date from public.opportunities where id = $1',
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows[0].next_action_date).toBeNull()
    })
  })

  it('computes overdue and due-today on the Asia/Kolkata day, not the UTC day (B-10)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await tx.query(
        `update public.opportunities
            set next_action='CALL',
                next_action_date=(now() at time zone 'Asia/Kolkata')::date
          where id=$1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      const { rows } = await tx.query(
        'select is_due_today, is_overdue from public.v_opportunity_flags where id = $1',
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(rows[0].is_due_today).toBe(true)
      expect(rows[0].is_overdue).toBe(false)
    })
  })
})

// ------------------------------------------- system-maintained columns (018) --

describe('system-maintained columns (ADR-020)', () => {
  it('logging an activity updates recency on an account the salesperson does NOT own', async () => {
    // The work-context case: A1 owns an opportunity on A2's account, so they may
    // insert the activity but may not update the account. Without the definer
    // trigger this silently affected zero rows and recency stopped moving.
    await asUser(db, USERS.salesA1, async (tx) => {
      await tx.query('update public.accounts set last_activity_at = null where id = $1', [ACCOUNTS.aOwnedByA2])
        .catch(() => undefined)

      await tx.query(
        `select public.log_activity($1,'CALL','Spoke to the site engineer.','FOLLOW_UP','POSITIVE',$2)`,
        [ACCOUNTS.aOwnedByA2, OPPORTUNITIES.workContext],
      )

      const { rows } = await tx.query('select last_activity_at from public.accounts where id = $1', [
        ACCOUNTS.aOwnedByA2,
      ])
      expect(rows[0].last_activity_at).not.toBeNull()
    })
  })

  it('a stage change resets the days-in-stage clock', async () => {
    await asUser(db, null, async () => undefined)
    await asUser(db, USERS.managerA, async (tx) => {
      await tx.query(
        `update public.opportunities set stage_changed_at = now() - interval '30 days' where id = $1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      const before = await tx.query('select days_in_stage from public.v_opportunity_flags where id = $1', [
        OPPORTUNITIES.aOwnedByA1,
      ])
      expect(Number(before.rows[0].days_in_stage)).toBe(30)

      await tx.query(`select public.change_opportunity_stage($1,'qualified')`, [OPPORTUNITIES.aOwnedByA1])

      const after = await tx.query('select days_in_stage from public.v_opportunity_flags where id = $1', [
        OPPORTUNITIES.aOwnedByA1,
      ])
      expect(Number(after.rows[0].days_in_stage)).toBe(0)
    })
  })

  it('back-dating an activity never makes an account look staler than it is', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await tx.query(
        `select public.log_activity($1,'CALL','Recent call.','FOLLOW_UP','POSITIVE',$2)`,
        [ACCOUNTS.aOwnedByA1, OPPORTUNITIES.aOwnedByA1],
      )
      const recent = await tx.query('select last_activity_at from public.accounts where id = $1', [
        ACCOUNTS.aOwnedByA1,
      ])

      await tx.query(
        `select public.log_activity($1,'NOTE','Forgot to log last month.','OTHER','NEUTRAL',$2,
           null,null,now() - interval '30 days')`,
        [ACCOUNTS.aOwnedByA1, OPPORTUNITIES.aOwnedByA1],
      )
      const after = await tx.query('select last_activity_at from public.accounts where id = $1', [
        ACCOUNTS.aOwnedByA1,
      ])
      expect(new Date(after.rows[0].last_activity_at).getTime()).toBe(
        new Date(recent.rows[0].last_activity_at).getTime(),
      )
    })
  })

  it('reopening a won opportunity does not demote the account back to PROSPECT', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      await tx.query(`select public.change_opportunity_stage($1,'negotiation')`, [OPPORTUNITIES.aOwnedByA1])
      await tx.query(`select public.change_opportunity_stage($1,'won',null,null,null,null,100)`, [
        OPPORTUNITIES.aOwnedByA1,
      ])
      await tx.query(`select public.change_opportunity_stage($1,'qualified',$2)`, [
        OPPORTUNITIES.aOwnedByA1,
        'reopen',
      ])
      const { rows } = await tx.query('select status from public.accounts where id = $1', [ACCOUNTS.aOwnedByA1])
      // A customer who has bought once has bought (ADR-020).
      expect(rows[0].status).toBe('ACTIVE')
    })
  })
})

// ------------------------------------------------------- one project, many --

describe('one project has many opportunities (§5.5)', () => {
  it('accepts several opportunities on the same site', async () => {
    await asUser(db, USERS.salesA2, async (tx) => {
      for (const category of ['SANITARYWARE', 'CP_FITTINGS']) {
        await tx.query(
          `insert into public.opportunities (title, account_id, project_id, owner_id, outlet_id, category, estimated_value)
           values ($1,$2,$3,$4,$5,$6,1000000)`,
          [`Lakshmi site 4 — ${category}`, ACCOUNTS.aOwnedByA2, PROJECTS.aOwnedByA2, USERS.salesA2, OUTLETS.a, category],
        )
      }
      const { rows } = await tx.query(
        'select count(*)::int as n from public.opportunities where project_id = $1 and archived_at is null',
        [PROJECTS.aOwnedByA2],
      )
      // A2 owns one fixture opportunity on this site and has just added two. The
      // fourth belongs to A1 and is correctly invisible here — which is the point
      // of asserting as the restricted role rather than as a manager (§23).
      expect(rows[0].n).toBe(3)
    })
  })

  it('a manager sees every opportunity on the site, across owners', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const { rows } = await tx.query(
        `select owner_id, count(*)::int as n from public.opportunities
          where project_id = $1 and archived_at is null group by owner_id`,
        [PROJECTS.aOwnedByA2],
      )
      // One site, two salespeople, several deals. This is the arrangement §4.4
      // and §11.3 describe and the one easiest to break by accident.
      expect(rows.length).toBe(2)
      const total = rows.reduce((sum: number, row: { n: number }) => sum + row.n, 0)
      expect(total).toBe(2)
    })
  })

  it('allows an opportunity with no project at all (§8.5)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(
        `insert into public.opportunities (title, account_id, owner_id, outlet_id, category, estimated_value)
         values ('Counter sale — allied',$1,$2,$3,'ALLIED',50000) returning project_id`,
        [ACCOUNTS.aOwnedByA1, USERS.salesA1, OUTLETS.a],
      )
      expect(rows[0].project_id).toBeNull()
    })
  })
})
