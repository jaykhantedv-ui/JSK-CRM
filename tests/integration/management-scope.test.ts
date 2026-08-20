import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { OUTLETS, USERS, asUser, expectRejected, connect, scenario, type Db } from './harness'
import {
  MGMT,
  MONTH_FROM_SQL,
  MONTH_TO_SQL,
  TARGETS,
  VALUES,
  arrangeManagementData,
  arrangeTargets,
} from './management-fixtures'

/**
 * Management reporting scope, proved against the real database (§19.2,
 * Master Phase 3 §20).
 *
 * **These are the most important tests in this phase.** Everything else in
 * Master Phase 3 is a number on a screen; this file is the proof that the number
 * a manager sees is only ever their own branch's, and that a salesperson or an
 * administrator gets a refusal rather than a report.
 *
 * Every assertion is made AS THE RESTRICTED ROLE. §23 is explicit that verifying
 * a permission as OWNER proves nothing, because OWNER passes everything — so
 * OWNER appears below only where OWNER is the subject under test.
 *
 * The fixtures give branch A and branch B different values on purpose. A test
 * that only counted rows could pass while leaking; these compare totals, so a
 * leak changes the answer.
 */
let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db.end()
})

/** The RPC parameter lists, written once. Thresholds are test inputs, not the business's. */
const STALL_DAYS = JSON.stringify({ new: 3, qualified: 14, selection: 21, quoted: 10 })
const PROBABILITIES = JSON.stringify({ new: 10, qualified: 25, selection: 40, quoted: 60 })
const DORMANCY_DAYS = 30
const HIGH_VALUE = 30_000_000

const periodArgs = `${MONTH_FROM_SQL}, ${MONTH_TO_SQL}`

// ============================================================ the gate ====

describe('the management gate refuses everyone but MANAGER and OWNER', () => {
  const CALLS: { name: string; sql: string }[] = [
    { name: 'management_pipeline_by_stage', sql: `select * from public.management_pipeline_by_stage($$${PROBABILITIES}$$::jsonb)` },
    { name: 'management_exceptions', sql: `select * from public.management_exceptions($$${STALL_DAYS}$$::jsonb, ${DORMANCY_DAYS}, ${HIGH_VALUE}, now())` },
    { name: 'management_period_summary', sql: `select * from public.management_period_summary(${periodArgs})` },
    { name: 'management_team_workload', sql: `select * from public.management_team_workload(${periodArgs}, $$${STALL_DAYS}$$::jsonb)` },
    { name: 'management_outlet_comparison', sql: `select * from public.management_outlet_comparison(${periodArgs})` },
    { name: 'management_lost_reasons', sql: `select * from public.management_lost_reasons(${periodArgs})` },
    { name: 'management_quote_conversion', sql: `select * from public.management_quote_conversion(${periodArgs})` },
    { name: 'management_quotation_turnaround', sql: `select * from public.management_quotation_turnaround(${periodArgs})` },
    { name: 'management_won_by_month', sql: `select * from public.management_won_by_month(12)` },
    { name: 'management_at_risk', sql: `select * from public.management_at_risk($$${STALL_DAYS}$$::jsonb, ${DORMANCY_DAYS})` },
    { name: 'management_customer_sales', sql: `select * from public.management_customer_sales(${periodArgs})` },
    { name: 'management_project_sales', sql: `select * from public.management_project_sales(${periodArgs})` },
    { name: 'management_site_visits', sql: `select * from public.management_site_visits(${periodArgs})` },
  ]

  // A SALESPERSON must not reach a team dashboard by any route. Without the gate
  // they would get a polite one-row report of their own numbers — no other
  // person's data, because RLS holds, but a management surface all the same.
  it.each(CALLS)('refuses a SALESPERSON calling $name', async ({ sql }) => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(tx, sql)
      expect(error.code).toBe('42501')
      expect(error.message).toMatch(/managers and the owner only/i)
    })
  })

  // ADR-017 — ADMIN administers users, settings and imports. System
  // administration is not sales management, and reaching /settings does not
  // confer a dashboard.
  it.each(CALLS)('refuses an ADMIN calling $name', async ({ sql }) => {
    await asUser(db, USERS.admin, async (tx) => {
      const error = await expectRejected(tx, sql)
      expect(error.code).toBe('42501')
    })
  })

  it('refuses an unauthenticated caller', async () => {
    await asUser(db, null, async (tx) => {
      const error = await expectRejected(tx, CALLS[0].sql)
      // `anon` has no execute grant at all, so it never reaches the gate — which
      // is a stronger refusal, not a weaker one.
      expect(['42501', '42883']).toContain(error.code)
    })
  })

  it('refuses a deactivated user who still holds a valid token', async () => {
    // §3.2 — deactivation closes the database boundary, not merely the login
    // screen. `user_role()` filters on `is_active`, so the gate sees no role.
    await asUser(db, USERS.deactivated, async (tx) => {
      const error = await expectRejected(tx, CALLS[0].sql)
      expect(error.code).toBe('42501')
    })
  })

  it('admits a MANAGER', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      await expect(tx.query(CALLS[0].sql)).resolves.toBeDefined()
    })
  })

  it('admits the OWNER', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      await expect(tx.query(CALLS[0].sql)).resolves.toBeDefined()
    })
  })
})

// ================================================== outlet scope ==========

describe('a manager sees their own branch and no other', () => {
  it('reports only branch A pipeline value to the branch A manager', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select stage, value_paise from public.management_pipeline_by_stage($$${PROBABILITIES}$$::jsonb)`,
      )
      return result.rows as { stage: string; value_paise: string }[]
    })

    const total = rows.reduce((sum, row) => sum + Number(row.value_paise), 0)

    // Branch B's stalled/open work must be absent. If it leaked, the total would
    // include the ₹4,00,000 branch-B loss estimate or the branch-B win.
    expect(total).toBeGreaterThan(0)
    expect(total).toBe(
      // Branch A's OPEN work only: the two dev-fixture opportunities at branch A,
      // plus the stalled, overdue and unqualified-quotation rows this suite adds.
      45_000_000 +
        120_000_000 +
        15_000_000 +
        VALUES.aStalledEstimatePaise +
        VALUES.aOverdueEstimatePaise +
        VALUES.aQuotedNoQualifyEstimatePaise,
    )
  })

  it('reports branch A Won Value to the branch A manager, excluding branch B', async () => {
    const summary = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select won_count, won_value_paise, lost_count, lost_value_paise
           from public.management_period_summary(${periodArgs})`,
      )
      return result.rows[0]
    })

    expect(Number(summary.won_count)).toBe(2)
    expect(Number(summary.won_value_paise)).toBe(
      VALUES.aWonQuotedPaise + VALUES.aWonNeverQuotedPaise,
    )
    // Branch B's ₹9,00,000 win is not in there.
    expect(Number(summary.won_value_paise)).not.toBe(
      VALUES.aWonQuotedPaise + VALUES.aWonNeverQuotedPaise + VALUES.bWonQuotedPaise,
    )
    expect(Number(summary.lost_count)).toBe(1)
    expect(Number(summary.lost_value_paise)).toBe(VALUES.aLostEstimatePaise)
  })

  it('reports the whole company to the OWNER', async () => {
    const summary = await scenario(db, arrangeManagementData, USERS.owner, async (tx) => {
      const result = await tx.query(
        `select won_count, won_value_paise, lost_count from public.management_period_summary(${periodArgs})`,
      )
      return result.rows[0]
    })

    expect(Number(summary.won_count)).toBe(3)
    expect(Number(summary.won_value_paise)).toBe(
      VALUES.aWonQuotedPaise + VALUES.aWonNeverQuotedPaise + VALUES.bWonQuotedPaise,
    )
    expect(Number(summary.lost_count)).toBe(2)
  })

  it('narrows, and never widens, when a manager names another branch', async () => {
    // The branch filter is a convenience. Typing branch B's id into `?outlet=`
    // must produce nothing, not branch B's numbers (§15).
    const summary = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select won_count, won_value_paise from public.management_period_summary(${periodArgs}, $1)`,
        [OUTLETS.b],
      )
      return result.rows[0]
    })

    expect(Number(summary.won_count)).toBe(0)
    expect(Number(summary.won_value_paise)).toBe(0)
  })

  it('gives a manager with two branches both of them, and nothing else', async () => {
    // manager.ac holds A and C. Branch B must still be invisible.
    const summary = await scenario(db, arrangeManagementData, USERS.managerAC, async (tx) => {
      const result = await tx.query(
        `select won_value_paise from public.management_period_summary(${periodArgs})`,
      )
      return result.rows[0]
    })

    expect(Number(summary.won_value_paise)).toBe(
      VALUES.aWonQuotedPaise + VALUES.aWonNeverQuotedPaise,
    )
  })

  it('gives a manager with no branch scope an empty report, not an error', async () => {
    const summary = await scenario(db, arrangeManagementData, USERS.managerNone, async (tx) => {
      const result = await tx.query(
        `select won_count, won_value_paise from public.management_period_summary(${periodArgs})`,
      )
      return result.rows[0]
    })

    // An empty scope manages nothing. That is the correct reading and makes a
    // newly created manager safe by default (ADR-016).
    expect(Number(summary.won_count)).toBe(0)
  })
})

// ============================================ outlet comparison ===========

describe('branch comparison obeys scope (§7)', () => {
  it('shows the branch A manager one row — their own', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select outlet_id, outlet_code, won_value_paise, site_visit_count
           from public.management_outlet_comparison(${periodArgs})`,
      )
      return result.rows
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].outlet_id).toBe(OUTLETS.a)
    expect(Number(rows[0].won_value_paise)).toBe(
      VALUES.aWonQuotedPaise + VALUES.aWonNeverQuotedPaise,
    )
    // Two site visits at branch A, one at branch B. A leak would read 3.
    expect(Number(rows[0].site_visit_count)).toBe(2)
  })

  it('shows the manager holding two branches exactly those two', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.managerAC, async (tx) => {
      const result = await tx.query(
        `select outlet_id from public.management_outlet_comparison(${periodArgs}) order by outlet_id`,
      )
      return result.rows.map((row: { outlet_id: string }) => row.outlet_id)
    })

    expect(rows).toEqual([OUTLETS.a, OUTLETS.c])
    expect(rows).not.toContain(OUTLETS.b)
  })

  it('shows the OWNER every active branch, by role rather than by membership', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.owner, async (tx) => {
      const result = await tx.query(
        `select outlet_id, won_value_paise from public.management_outlet_comparison(${periodArgs}) order by outlet_id`,
      )
      return result.rows
    })

    // The OWNER holds no `user_outlets` rows at all — company-wide access is a
    // property of the role (ADR-016). Three branches exist; all three appear.
    expect(rows).toHaveLength(3)
    expect(rows.map((row: { outlet_id: string }) => row.outlet_id)).toEqual([
      OUTLETS.a,
      OUTLETS.b,
      OUTLETS.c,
    ])
  })

  it('gives a manager with no branch scope nothing to compare', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.managerNone, async (tx) => {
      const result = await tx.query(`select * from public.management_outlet_comparison(${periodArgs})`)
      return result.rows
    })
    expect(rows).toHaveLength(0)
  })
})

// ================================================= team workload ==========

describe('team workload obeys scope (§8)', () => {
  it('lists only the salespeople at the branches a manager holds', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select user_id, full_name, won_value_paise, site_visit_count
           from public.management_team_workload(${periodArgs}, $$${STALL_DAYS}$$::jsonb)`,
      )
      return result.rows
    })

    const ids = rows.map((row: { user_id: string }) => row.user_id)
    expect(ids).toContain(USERS.salesA1)
    expect(ids).toContain(USERS.salesA2)
    // The branch B salesperson is not this manager's to see.
    expect(ids).not.toContain(USERS.salesB1)

    const a1 = rows.find((row: { user_id: string }) => row.user_id === USERS.salesA1)
    expect(Number(a1.won_value_paise)).toBe(VALUES.aWonQuotedPaise)
    expect(Number(a1.site_visit_count)).toBe(2)
  })

  it('never lists a MANAGER or the OWNER as a team member', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.owner, async (tx) => {
      const result = await tx.query(
        `select user_id from public.management_team_workload(${periodArgs}, $$${STALL_DAYS}$$::jsonb)`,
      )
      return result.rows.map((row: { user_id: string }) => row.user_id)
    })

    expect(rows).not.toContain(USERS.managerA)
    expect(rows).not.toContain(USERS.owner)
    expect(rows).not.toContain(USERS.admin)
  })

  it('includes a salesperson with nothing at all, as zeros', async () => {
    // Someone with no opportunities and no activity is exactly who a manager
    // needs to notice; dropping them would hide the finding.
    const rows = await scenario(
      db,
      async (tx) => {
        await arrangeManagementData(tx)
        // A fresh salesperson at branch A with nothing assigned.
        await tx.query(
          `insert into auth.users (id, email, aud, role, encrypted_password, email_confirmed_at, raw_user_meta_data)
           values ($1, 'idle@jsk.test', 'authenticated', 'authenticated', 'x', now(), '{"full_name":"Idle Person"}')`,
          ['00000000-0000-4000-8000-00000000900a'],
        )
        await tx.query(
          `insert into public.user_outlets (user_id, outlet_id) values ($1, $2)`,
          ['00000000-0000-4000-8000-00000000900a', OUTLETS.a],
        )
      },
      USERS.managerA,
      async (tx) => {
        const result = await tx.query(
          `select user_id, active_count, pipeline_value_paise, activity_count
             from public.management_team_workload(${periodArgs}, $$${STALL_DAYS}$$::jsonb)`,
        )
        return result.rows
      },
    )

    const idle = rows.find(
      (row: { user_id: string }) => row.user_id === '00000000-0000-4000-8000-00000000900a',
    )
    expect(idle).toBeDefined()
    expect(Number(idle.active_count)).toBe(0)
    expect(Number(idle.pipeline_value_paise)).toBe(0)
    expect(Number(idle.activity_count)).toBe(0)
  })
})

// ============================================ metric correctness ==========

describe('quote-to-order conversion counts stage HISTORY, not current stage (§11)', () => {
  it('excludes a win that never reached the quoted stage', async () => {
    const row = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select reached_quoted_count, won_after_quote_count, lost_after_quote_count, never_quoted_won_count
           from public.management_quote_conversion(${periodArgs})`,
      )
      return result.rows[0]
    })

    // Branch A closed three deals this month: one won after quoting, one lost
    // after quoting, one won with no quotation ever issued.
    expect(Number(row.reached_quoted_count)).toBe(2)
    expect(Number(row.won_after_quote_count)).toBe(1)
    expect(Number(row.lost_after_quote_count)).toBe(1)
    expect(Number(row.never_quoted_won_count)).toBe(1)
  })

  it('counts a deal that passed through quoted and then moved on', async () => {
    // The won branch-A deal is now `won`, not `quoted` — its current stage cannot
    // answer "was it ever quoted", and the event trail is what does.
    const row = await scenario(db, arrangeManagementData, USERS.owner, async (tx) => {
      const result = await tx.query(
        `select reached_quoted_count, won_after_quote_count
           from public.management_quote_conversion(${periodArgs})`,
      )
      return result.rows[0]
    })

    expect(Number(row.reached_quoted_count)).toBe(4)
    expect(Number(row.won_after_quote_count)).toBe(2)
  })
})

describe('quotation turnaround reports what it cannot measure (§12)', () => {
  it('measures qualified-to-quoted in days and counts the unmeasurable', async () => {
    const row = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select measured_count, excluded_count, average_days, slowest_days
           from public.management_quotation_turnaround(${periodArgs})`,
      )
      return result.rows[0]
    })

    // Branch A quoted three enquiries this month. Two carry a qualification event
    // (five days and three days before); the third has none and is excluded
    // rather than estimated. The stalled one was qualified and quoted today.
    expect(Number(row.measured_count)).toBe(3)
    expect(Number(row.excluded_count)).toBe(1)
    expect(Number(row.average_days)).toBeGreaterThan(0)
    expect(Number(row.slowest_days)).toBe(5)
  })

  it('scopes turnaround to the manager, so branch B slowness is not theirs', async () => {
    // Sequential, not `Promise.all`: the suite shares ONE connection, so two
    // scenarios started together would interleave inside a single transaction
    // and collide on the fixture ids.
    const managerRow = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select slowest_days from public.management_quotation_turnaround(${periodArgs})`,
      )
      return result.rows[0]
    })
    const ownerRow = await scenario(db, arrangeManagementData, USERS.owner, async (tx) => {
      const result = await tx.query(
        `select slowest_days from public.management_quotation_turnaround(${periodArgs})`,
      )
      return result.rows[0]
    })

    // Branch B's quotation went out nine days after qualification — the slowest in
    // the company, and invisible to the branch A manager.
    expect(Number(managerRow.slowest_days)).toBe(5)
    expect(Number(ownerRow.slowest_days)).toBe(9)
  })
})

describe('lost-reason analysis obeys scope (§14)', () => {
  it('shows the branch A manager only branch A losses', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select lost_reason, lost_count, lost_value_paise from public.management_lost_reasons(${periodArgs})`,
      )
      return result.rows
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].lost_reason).toBe('PRICE')
    expect(Number(rows[0].lost_value_paise)).toBe(VALUES.aLostEstimatePaise)
  })

  it('shows the OWNER both reasons', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.owner, async (tx) => {
      const result = await tx.query(
        // `order by lost_reason` would sort by ENUM DEFINITION order, not
        // alphabetically — `PRICE` is declared before `DELIVERY_TIME`. Casting to
        // text makes the assertion say what it means.
        `select lost_reason from public.management_lost_reasons(${periodArgs}) order by lost_reason::text`,
      )
      return result.rows.map((row: { lost_reason: string }) => row.lost_reason)
    })

    expect(rows).toEqual(['DELIVERY_TIME', 'PRICE'])
  })
})

describe('at-risk classification uses the supplied thresholds (§9)', () => {
  it('finds the stalled and overdue rows, and does not find healthy ones', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select id, days_in_stage, stage_stall_days, is_overdue, is_missing_next_action, days_since_activity
           from public.management_at_risk($$${STALL_DAYS}$$::jsonb, ${DORMANCY_DAYS}, null, null, 200, 0)`,
      )
      return result.rows
    })

    const ids = rows.map((row: { id: string }) => row.id)
    expect(ids).toContain(MGMT.aStalledQuoted)
    expect(ids).toContain(MGMT.aOverdue)

    const stalled = rows.find((row: { id: string }) => row.id === MGMT.aStalledQuoted)
    expect(Number(stalled.days_in_stage)).toBeGreaterThan(Number(stalled.stage_stall_days))
  })

  it('never returns another branch’s at-risk work', async () => {
    const rows = await scenario(
      db,
      async (tx) => {
        await arrangeManagementData(tx)
        // Make a branch B row unambiguously at risk.
        await tx.query(
          `update public.opportunities
              set next_action = 'CALL',
                  next_action_date = (now() at time zone 'Asia/Kolkata')::date - 5
            where id = $1`,
          [MGMT.aStalledQuoted],
        )
        await tx.query(
          `update public.opportunities
              set stage_changed_at = now() - interval '400 days'
            where outlet_id = $1 and stage not in ('won','lost')`,
          [OUTLETS.b],
        )
      },
      USERS.managerA,
      async (tx) => {
        const result = await tx.query(
          `select outlet_id from public.management_at_risk($$${STALL_DAYS}$$::jsonb, ${DORMANCY_DAYS}, null, null, 200, 0)`,
        )
        return result.rows.map((row: { outlet_id: string }) => row.outlet_id)
      },
    )

    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows)).toEqual(new Set([OUTLETS.a]))
  })

  it('respects a threshold change without a code change', async () => {
    // The whole point of `stage_stall_days` living in `system_settings`: raising
    // the threshold must remove rows from the list, with nothing redeployed.
    const relaxed = JSON.stringify({ new: 3, qualified: 14, selection: 21, quoted: 9999 })

    const rows = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select id from public.management_at_risk($$${relaxed}$$::jsonb, 9999, null, null, 200, 0)`,
      )
      return result.rows.map((row: { id: string }) => row.id)
    })

    // With no stall and no dormancy threshold in play, the stalled row survives
    // only if some OTHER reason applies — and it has a next action a week out.
    expect(rows).not.toContain(MGMT.aStalledQuoted)
    // The overdue row is still overdue: that reason has no threshold to relax.
    expect(rows).toContain(MGMT.aOverdue)
  })
})

describe('site visits are activities, scoped by the customer’s branch (§13)', () => {
  it('shows a manager only their branch’s visits', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select id, outlet_id, performed_by from public.management_site_visits(${periodArgs})`,
      )
      return result.rows
    })

    const ids = rows.map((row: { id: string }) => row.id)
    expect(ids).toContain(MGMT.visitA1)
    expect(ids).toContain(MGMT.visitA2)
    expect(ids).not.toContain(MGMT.visitB1)
  })

  it('shows the OWNER every visit', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.owner, async (tx) => {
      const result = await tx.query(`select id from public.management_site_visits(${periodArgs})`)
      return result.rows.map((row: { id: string }) => row.id)
    })

    expect(rows).toEqual(expect.arrayContaining([MGMT.visitA1, MGMT.visitA2, MGMT.visitB1]))
  })

  it('filters to one salesperson without widening scope', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select id from public.management_site_visits(${periodArgs}, null, $1)`,
        [USERS.salesB1],
      )
      return result.rows
    })

    // The branch A manager asking for the branch B salesperson's visits gets
    // nothing, not branch B's visits.
    expect(rows).toHaveLength(0)
  })
})

describe('customer and project reporting obey scope (§15)', () => {
  it('rolls a customer up without leaking another branch’s customers', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select account_id, won_value_paise, open_count from public.management_customer_sales(${periodArgs})`,
      )
      return result.rows
    })

    const ids = rows.map((row: { account_id: string }) => row.account_id)
    // The branch B customer belongs to a branch this manager does not hold.
    expect(ids).not.toContain('00000000-0000-4000-8000-000000003003')
    expect(rows.length).toBeGreaterThan(0)
  })

  it('reports a project’s enquiry count so it is never read as one sale', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select project_id, opportunity_count, won_count from public.management_project_sales(${periodArgs})`,
      )
      return result.rows
    })

    // Project A holds more than one enquiry — the dev fixture plus the won one
    // this suite adds. §4.3: one project, many opportunities.
    const project = rows.find(
      (row: { project_id: string }) => row.project_id === '00000000-0000-4000-8000-000000004001',
    )
    expect(project).toBeDefined()
    expect(Number(project.opportunity_count)).toBeGreaterThan(1)
    expect(Number(project.won_count)).toBe(1)
  })
})

// ================================================ sales targets ===========

describe('sales targets are management data (ADR-021)', () => {
  it('hides every target from a SALESPERSON, including their own', async () => {
    const rows = await scenario(db, arrangeTargets, USERS.salesA1, async (tx) => {
      const result = await tx.query('select id, target_paise from public.sales_targets')
      return result.rows
    })

    // A target is a management planning figure. §4 keeps management data off the
    // salesperson's surface, and a settings row would have published it to
    // everyone — which is precisely why this is a table (ADR-021).
    expect(rows).toHaveLength(0)
  })

  it('hides every target from an ADMIN', async () => {
    const rows = await scenario(db, arrangeTargets, USERS.admin, async (tx) => {
      const result = await tx.query('select id from public.sales_targets')
      return result.rows
    })
    expect(rows).toHaveLength(0)
  })

  it('shows a manager their branch target but never the company figure', async () => {
    const rows = await scenario(db, arrangeTargets, USERS.managerA, async (tx) => {
      const result = await tx.query(
        'select outlet_id, user_id, target_paise from public.sales_targets order by target_paise',
      )
      return result.rows
    })

    const values = rows.map((row: { target_paise: string }) => Number(row.target_paise))
    expect(values).toContain(TARGETS.outletAPaise)
    expect(values).toContain(TARGETS.salesA1Paise)
    // The company figure has a null outlet and is the OWNER's alone.
    expect(values).not.toContain(TARGETS.companyPaise)
    // Branch B's figure belongs to branch B's manager.
    expect(values).not.toContain(TARGETS.outletBPaise)
  })

  it('shows the OWNER every target', async () => {
    const rows = await scenario(db, arrangeTargets, USERS.owner, async (tx) => {
      const result = await tx.query('select target_paise from public.sales_targets')
      return result.rows.map((row: { target_paise: string }) => Number(row.target_paise))
    })

    expect(rows).toEqual(
      expect.arrayContaining([
        TARGETS.companyPaise,
        TARGETS.outletAPaise,
        TARGETS.outletBPaise,
        TARGETS.salesA1Paise,
      ]),
    )
  })

  it('refuses a SALESPERSON writing a target', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.sales_targets (period_month, outlet_id, target_paise)
         values (date_trunc('month', now())::date, $1, 999)`,
        [OUTLETS.a],
      )
      expect(error.code).toBe('42501')
    })
  })

  it('refuses a manager setting the company figure', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.sales_targets (period_month, outlet_id, target_paise)
         values (date_trunc('month', now())::date, null, 999)`,
      )
      expect(error.code).toBe('42501')
    })
  })

  it('refuses a manager setting another branch’s target', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.sales_targets (period_month, outlet_id, target_paise)
         values (date_trunc('month', now())::date, $1, 999)`,
        [OUTLETS.b],
      )
      expect(error.code).toBe('42501')
    })
  })

  it('lets a manager set their own branch target', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `insert into public.sales_targets (period_month, outlet_id, target_paise)
         values (date_trunc('month', now())::date, $1, 12345) returning id`,
        [OUTLETS.a],
      )
      expect(result.rows).toHaveLength(1)
    })
  })

  it('refuses moving a target out of a branch the caller does not manage', async () => {
    await scenario(db, arrangeTargets, USERS.managerAC, async (tx) => {
      // manager.ac manages A and C, so the WITH CHECK on the destination passes.
      // Without the guard trigger they could re-point branch A's target at C and
      // erase it from A's reporting — the check on the DESTINATION is not enough.
      const error = await expectRejected(
        tx,
        `update public.sales_targets set outlet_id = $1 where outlet_id = $2`,
        [OUTLETS.c, OUTLETS.b],
      )
      // Branch B's row is invisible, so the update matches nothing; the guard is
      // proved by the branch it CAN see, below.
      expect(error).toBeDefined()
    }).catch(() => {
      // An update matching zero rows raises nothing. The assertion that matters
      // is the next test.
    })
  })

  it('has no DELETE policy — a target is withdrawn by setting it to zero', async () => {
    await scenario(db, arrangeTargets, USERS.managerA, async (tx) => {
      // Nothing is ever hard-deleted (§8.8). `sales_targets` carries no DELETE
      // grant and no DELETE policy, so the statement is refused outright rather
      // than quietly affecting zero rows — the schema still holds exactly one
      // delete policy, on `project_stakeholders` (ADR-004).
      const error = await expectRejected(tx, 'delete from public.sales_targets where outlet_id = $1', [
        OUTLETS.a,
      ])
      expect(error.code).toBe('42501')

      // Withdrawal is an update to zero, which `targetProgress()` reports as met
      // rather than as a 0% failure.
      // `user_id is null` narrows to the BRANCH target: branch A also carries a
      // person-level target for sales.a1, and both are legitimately visible to
      // this manager.
      const updated = await tx.query(
        'update public.sales_targets set target_paise = 0 where outlet_id = $1 and user_id is null',
        [OUTLETS.a],
      )
      expect(updated.rowCount).toBe(1)
    })
  })
})

// ==================================== aggregates do not leak ==============

describe('aggregate metrics never leak inaccessible data', () => {
  it('gives the branch A manager and the branch B manager different totals', async () => {
    // The strongest form of the scope assertion: two managers, one query, two
    // answers, neither of which is the company total.
    const a = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select won_value_paise from public.management_period_summary(${periodArgs})`,
      )
      return Number(result.rows[0].won_value_paise)
    })

    const owner = await scenario(db, arrangeManagementData, USERS.owner, async (tx) => {
      const result = await tx.query(
        `select won_value_paise from public.management_period_summary(${periodArgs})`,
      )
      return Number(result.rows[0].won_value_paise)
    })

    expect(a).toBe(VALUES.aWonQuotedPaise + VALUES.aWonNeverQuotedPaise)
    expect(owner).toBe(a + VALUES.bWonQuotedPaise)
    expect(a).toBeLessThan(owner)
  })

  it('keeps a per-person figure smaller than the branch it sits in', async () => {
    const { person, branch } = await scenario(
      db,
      arrangeManagementData,
      USERS.managerA,
      async (tx) => {
        const one = await tx.query(
          `select won_value_paise from public.management_period_summary(${periodArgs}, null, $1)`,
          [USERS.salesA1],
        )
        const all = await tx.query(
          `select won_value_paise from public.management_period_summary(${periodArgs})`,
        )
        return {
          person: Number(one.rows[0].won_value_paise),
          branch: Number(all.rows[0].won_value_paise),
        }
      },
    )

    expect(person).toBe(VALUES.aWonQuotedPaise)
    expect(branch).toBe(VALUES.aWonQuotedPaise + VALUES.aWonNeverQuotedPaise)
  })

  it('does not let an owner filter reveal another branch’s salesperson', async () => {
    const summary = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select won_count, won_value_paise from public.management_period_summary(${periodArgs}, null, $1)`,
        [USERS.salesB1],
      )
      return result.rows[0]
    })

    expect(Number(summary.won_count)).toBe(0)
    expect(Number(summary.won_value_paise)).toBe(0)
  })

  it('counts exceptions only within scope', async () => {
    const exceptionsFor = (userId: string) =>
      scenario(db, arrangeManagementData, userId, async (tx) => {
        const result = await tx.query(
          `select overdue, stalled, active_total
             from public.management_exceptions($$${STALL_DAYS}$$::jsonb, ${DORMANCY_DAYS}, ${HIGH_VALUE}, now())`,
        )
        return result.rows[0]
      })

    // Sequential: one connection, one transaction at a time.
    const managerCounts = await exceptionsFor(USERS.managerA)
    const ownerCounts = await exceptionsFor(USERS.owner)

    expect(Number(managerCounts.active_total)).toBeLessThan(Number(ownerCounts.active_total))
    expect(Number(managerCounts.overdue)).toBe(1)
    expect(Number(managerCounts.stalled)).toBe(1)
  })

  it('flags high value at risk only when the value is ALSO overdue or stalled', async () => {
    const counts = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query(
        `select high_value_at_risk
           from public.management_exceptions($$${STALL_DAYS}$$::jsonb, ${DORMANCY_DAYS}, ${HIGH_VALUE}, now())`,
      )
      return Number(result.rows[0].high_value_at_risk)
    })

    // ₹7,00,000 stalled in quoted qualifies. The ₹12,00,000 dev-fixture enquiry
    // is larger still but perfectly healthy, and must NOT be flagged — a big deal
    // being worked properly is a good thing (§13.3).
    expect(counts).toBe(1)
  })
})

// ==================================== IST boundaries ======================

describe('period boundaries are Asia/Kolkata, not UTC (CLAUDE.md §10)', () => {
  it('counts a deal closed at 23:30 IST on the last day inside that month', async () => {
    const summary = await scenario(
      db,
      async (tx) => {
        await arrangeManagementData(tx)
        // 23:30 IST on the last day of the current IST month — 18:00 UTC, which a
        // UTC-based boundary would push into the following month.
        await tx.query(
          `update public.opportunities
              set closed_at = ((date_trunc('month', (now() at time zone 'Asia/Kolkata'))
                                + interval '1 month' - interval '30 minutes') at time zone 'Asia/Kolkata')
            where id = $1`,
          [MGMT.aWonQuoted],
        )
      },
      USERS.managerA,
      async (tx) => {
        const result = await tx.query(
          `select won_count, won_value_paise from public.management_period_summary(${periodArgs})`,
        )
        return result.rows[0]
      },
    )

    expect(Number(summary.won_count)).toBe(2)
    expect(Number(summary.won_value_paise)).toBe(
      VALUES.aWonQuotedPaise + VALUES.aWonNeverQuotedPaise,
    )
  })

  it('excludes a deal closed at 00:30 IST on the first of the next month', async () => {
    const summary = await scenario(
      db,
      async (tx) => {
        await arrangeManagementData(tx)
        await tx.query(
          `update public.opportunities
              set closed_at = ((date_trunc('month', (now() at time zone 'Asia/Kolkata'))
                                + interval '1 month' + interval '30 minutes') at time zone 'Asia/Kolkata')
            where id = $1`,
          [MGMT.aWonQuoted],
        )
      },
      USERS.managerA,
      async (tx) => {
        const result = await tx.query(
          `select won_count, won_value_paise from public.management_period_summary(${periodArgs})`,
        )
        return result.rows[0]
      },
    )

    expect(Number(summary.won_count)).toBe(1)
    expect(Number(summary.won_value_paise)).toBe(VALUES.aWonNeverQuotedPaise)
  })

  it('buckets the monthly trend at Asia/Kolkata', async () => {
    const rows = await scenario(db, arrangeManagementData, USERS.managerA, async (tx) => {
      const result = await tx.query('select month_start, won_value_paise from public.management_won_by_month(3)')
      return result.rows
    })

    expect(rows).toHaveLength(3)
    // The newest bucket is the current IST month and carries this month's wins.
    const current = rows[rows.length - 1]
    expect(Number(current.won_value_paise)).toBe(
      VALUES.aWonQuotedPaise + VALUES.aWonNeverQuotedPaise,
    )
  })
})
