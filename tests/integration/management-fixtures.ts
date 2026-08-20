import { OUTLETS, PROJECTS, USERS, type Db } from './harness'
import { ACCOUNTS } from './harness'

/**
 * The management data set (Master Phase 3 §20).
 *
 * `supabase/seed/dev-fixtures.sql` gives every opportunity the same shape — new,
 * open, untouched — which is exactly right for proving the permission model and
 * useless for proving a metric. Nothing in it has been won, lost, quoted or
 * visited, so Win Rate, quote-to-order conversion and quotation turnaround would
 * all be tested against a zero denominator and would pass while computing
 * nonsense.
 *
 * This module arranges the missing shape **inside the test's own transaction**,
 * as the database owner, and it is rolled back with everything else. It is
 * deliberately not added to `dev-fixtures.sql`: that file is asserted against by
 * the Phase 2 suites, and changing its row counts would break tests that are
 * about something else entirely.
 *
 * The set is shaped so that every scope assertion is FALSIFIABLE:
 *
 *   Branch A and Branch B both have wins, losses and quotations, with DIFFERENT
 *   values, so "the manager saw their branch" cannot pass by coincidence — a leak
 *   changes the number, not merely the row count.
 *   Two salespeople at branch A, so a per-person figure is distinguishable from a
 *   branch figure.
 *   One deal won WITHOUT ever being quoted, so the conversion denominator is
 *   provably not just "everything won".
 *   One quotation with no recorded qualification, so turnaround's excluded count
 *   is provably not zero.
 */

/** Ids for the rows this module creates. `9xxx` — nothing else in the fixtures uses it. */
export const MGMT = {
  aWonQuoted: '00000000-0000-4000-8000-000000009001',
  aLostQuoted: '00000000-0000-4000-8000-000000009002',
  aWonNeverQuoted: '00000000-0000-4000-8000-000000009003',
  aStalledQuoted: '00000000-0000-4000-8000-000000009004',
  aOverdue: '00000000-0000-4000-8000-000000009005',
  bWonQuoted: '00000000-0000-4000-8000-000000009006',
  bLostQuoted: '00000000-0000-4000-8000-000000009007',
  aQuotedNoQualify: '00000000-0000-4000-8000-000000009008',
  visitA1: '00000000-0000-4000-8000-000000009101',
  visitA2: '00000000-0000-4000-8000-000000009102',
  visitB1: '00000000-0000-4000-8000-000000009103',
} as const

/** Values chosen so no two totals collide by accident. */
export const VALUES = {
  aWonQuotedPaise: 50_000_000,
  aWonNeverQuotedPaise: 20_000_000,
  aLostEstimatePaise: 30_000_000,
  bWonQuotedPaise: 90_000_000,
  bLostEstimatePaise: 40_000_000,
  aStalledEstimatePaise: 70_000_000,
  aOverdueEstimatePaise: 11_000_000,
  aQuotedNoQualifyEstimatePaise: 12_000_000,
} as const

/** The current business month as instants, exactly as `lib/period.ts` computes it. */
export const MONTH_FROM_SQL =
  `(date_trunc('month', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata')`
export const MONTH_TO_SQL =
  `((date_trunc('month', (now() at time zone 'Asia/Kolkata')) + interval '1 month') at time zone 'Asia/Kolkata')`

async function insertOpportunity(
  db: Db,
  row: {
    id: string
    title: string
    accountId: string
    projectId: string | null
    ownerId: string
    outletId: string
    estimated: number
  },
): Promise<void> {
  await db.query(
    `insert into public.opportunities
       (id, title, account_id, project_id, owner_id, outlet_id, category, estimated_value, created_by)
     values ($1,$2,$3,$4,$5,$6,'TILES',$7,$5)`,
    [row.id, row.title, row.accountId, row.projectId, row.ownerId, row.outletId, row.estimated],
  )
}

/**
 * Walk an opportunity through stages so the trigger writes real events.
 *
 * Each move is a separate UPDATE because `log_opportunity_event()` fires per
 * statement and reads `old.stage`; batching them would produce one event and a
 * history that never happened.
 */
async function advance(db: Db, id: string, stages: readonly string[]): Promise<void> {
  for (const stage of stages) {
    if (stage === 'quoted') {
      await db.query(
        `update public.opportunities
            set stage = 'quoted', quotation_ref = 'Q-' || left($1::text, 8),
                quoted_value = estimated_value, quotation_date = (now() at time zone 'Asia/Kolkata')::date,
                quotation_status = 'SENT'
          where id = $1`,
        [id],
      )
    } else {
      await db.query('update public.opportunities set stage = $2 where id = $1', [id, stage])
    }
  }
}

/**
 * Back-date an event so a turnaround has something to measure.
 *
 * Written directly as the table owner. `opportunity_events` has no UPDATE policy
 * for any role (§9.2) and that is not being relaxed — the owner bypasses RLS, and
 * this is fixture arrangement rather than an application path.
 */
async function backdateEvent(db: Db, id: string, toStage: string, daysAgo: number): Promise<void> {
  await db.query(
    `update public.opportunity_events
        set created_at = now() - make_interval(days => $3)
      where opportunity_id = $1 and to_stage = $2`,
    [id, toStage, daysAgo],
  )
}

export async function arrangeManagementData(db: Db): Promise<void> {
  // ---------------------------------------------------------- branch A ----

  // Won after a quotation. Qualified five days before the quotation went out.
  await insertOpportunity(db, {
    id: MGMT.aWonQuoted,
    title: 'A — won after quoting',
    accountId: ACCOUNTS.aOwnedByA1,
    projectId: PROJECTS.aOwnedByA1,
    ownerId: USERS.salesA1,
    outletId: OUTLETS.a,
    estimated: VALUES.aWonQuotedPaise,
  })
  await advance(db, MGMT.aWonQuoted, ['qualified', 'selection', 'quoted', 'negotiation'])
  await db.query(
    `update public.opportunities
        set stage = 'won', final_order_value = $2, closed_at = now()
      where id = $1`,
    [MGMT.aWonQuoted, VALUES.aWonQuotedPaise],
  )
  await backdateEvent(db, MGMT.aWonQuoted, 'qualified', 5)

  // Lost after a quotation, on price.
  await insertOpportunity(db, {
    id: MGMT.aLostQuoted,
    title: 'A — lost after quoting',
    accountId: ACCOUNTS.aOwnedByA1,
    projectId: null,
    ownerId: USERS.salesA1,
    outletId: OUTLETS.a,
    estimated: VALUES.aLostEstimatePaise,
  })
  await advance(db, MGMT.aLostQuoted, ['qualified', 'quoted'])
  await db.query(
    `update public.opportunities
        set stage = 'lost', lost_reason = 'PRICE', closed_at = now()
      where id = $1`,
    [MGMT.aLostQuoted],
  )
  await backdateEvent(db, MGMT.aLostQuoted, 'qualified', 3)

  // Won without ever reaching quotation — the row that proves the conversion
  // denominator is not simply "everything won".
  await insertOpportunity(db, {
    id: MGMT.aWonNeverQuoted,
    title: 'A — won without a quotation',
    accountId: ACCOUNTS.aOwnedByA2,
    projectId: PROJECTS.aOwnedByA2,
    ownerId: USERS.salesA2,
    outletId: OUTLETS.a,
    estimated: VALUES.aWonNeverQuotedPaise,
  })
  await advance(db, MGMT.aWonNeverQuoted, ['qualified'])
  await db.query(
    `update public.opportunities
        set stage = 'won', final_order_value = $2, closed_at = now()
      where id = $1`,
    [MGMT.aWonNeverQuoted, VALUES.aWonNeverQuotedPaise],
  )

  // Stalled: quoted 60 days ago and untouched since. `stage_changed_at` is set
  // AFTER the stage move, because `touch_stage_changed_at()` overwrites it on the
  // move itself — writing it first would be silently undone.
  await insertOpportunity(db, {
    id: MGMT.aStalledQuoted,
    title: 'A — stalled in quoted',
    accountId: ACCOUNTS.aOwnedByA2,
    projectId: null,
    ownerId: USERS.salesA2,
    outletId: OUTLETS.a,
    estimated: VALUES.aStalledEstimatePaise,
  })
  await advance(db, MGMT.aStalledQuoted, ['qualified', 'quoted'])
  await db.query(
    `update public.opportunities
        set stage_changed_at = now() - interval '60 days',
            last_activity_at = now() - interval '60 days',
            next_action = 'QUOTATION_FOLLOWUP',
            next_action_date = (now() at time zone 'Asia/Kolkata')::date + 7
      where id = $1`,
    [MGMT.aStalledQuoted],
  )

  // Overdue: a next action that was due yesterday.
  await insertOpportunity(db, {
    id: MGMT.aOverdue,
    title: 'A — overdue follow-up',
    accountId: ACCOUNTS.aOwnedByA1,
    projectId: null,
    ownerId: USERS.salesA1,
    outletId: OUTLETS.a,
    estimated: VALUES.aOverdueEstimatePaise,
  })
  await db.query(
    `update public.opportunities
        set next_action = 'CALL',
            next_action_date = (now() at time zone 'Asia/Kolkata')::date - 1
      where id = $1`,
    [MGMT.aOverdue],
  )

  // A quotation issued with no recorded qualification — the row that makes
  // turnaround's excluded count provably non-zero. Its CREATED event is deleted
  // so the record looks like imported history: quoted, but with no trail of how
  // it got there.
  await insertOpportunity(db, {
    id: MGMT.aQuotedNoQualify,
    title: 'A — quoted with no qualification recorded',
    accountId: ACCOUNTS.aOwnedByA1,
    projectId: null,
    ownerId: USERS.salesA1,
    outletId: OUTLETS.a,
    estimated: VALUES.aQuotedNoQualifyEstimatePaise,
  })
  await advance(db, MGMT.aQuotedNoQualify, ['quoted'])
  await db.query(
    `delete from public.opportunity_events
      where opportunity_id = $1 and to_stage = 'qualified'`,
    [MGMT.aQuotedNoQualify],
  )

  // ---------------------------------------------------------- branch B ----

  await insertOpportunity(db, {
    id: MGMT.bWonQuoted,
    title: 'B — won after quoting',
    accountId: ACCOUNTS.bOwnedByB1,
    projectId: PROJECTS.bOwnedByB1,
    ownerId: USERS.salesB1,
    outletId: OUTLETS.b,
    estimated: VALUES.bWonQuotedPaise,
  })
  await advance(db, MGMT.bWonQuoted, ['qualified', 'quoted', 'negotiation'])
  await db.query(
    `update public.opportunities
        set stage = 'won', final_order_value = $2, closed_at = now()
      where id = $1`,
    [MGMT.bWonQuoted, VALUES.bWonQuotedPaise],
  )
  await backdateEvent(db, MGMT.bWonQuoted, 'qualified', 9)

  await insertOpportunity(db, {
    id: MGMT.bLostQuoted,
    title: 'B — lost after quoting',
    accountId: ACCOUNTS.bOwnedByB1,
    projectId: null,
    ownerId: USERS.salesB1,
    outletId: OUTLETS.b,
    estimated: VALUES.bLostEstimatePaise,
  })
  await advance(db, MGMT.bLostQuoted, ['qualified', 'quoted'])
  await db.query(
    `update public.opportunities
        set stage = 'lost', lost_reason = 'DELIVERY_TIME', closed_at = now()
      where id = $1`,
    [MGMT.bLostQuoted],
  )

  // ------------------------------------------------------- site visits ----
  // Site visits are activities, not a table (§13). Two at branch A, one at B, so
  // a branch-scoped count is falsifiable.
  await db.query(
    `insert into public.activities (id, account_id, opportunity_id, type, summary, performed_by, occurred_at)
     values
       ($1, $4, $7,   'SITE_VISIT', 'Measured the first floor.',   $9,  now() - interval '2 days'),
       ($2, $5, null, 'SITE_VISIT', 'Second visit, tile layout.',  $9,  now() - interval '1 day'),
       ($3, $6, $8,   'SITE_VISIT', 'Bathroom measurements.',      $10, now() - interval '1 day')`,
    [
      MGMT.visitA1, MGMT.visitA2, MGMT.visitB1,
      ACCOUNTS.aOwnedByA1, ACCOUNTS.aOwnedByA1, ACCOUNTS.bOwnedByB1,
      MGMT.aWonQuoted, MGMT.bWonQuoted,
      USERS.salesA1, USERS.salesB1,
    ],
  )
}

/** Targets for the current month, one per scope. Values chosen not to collide. */
export const TARGETS = {
  companyPaise: 300_000_000,
  outletAPaise: 120_000_000,
  outletBPaise: 150_000_000,
  salesA1Paise: 60_000_000,
} as const

export async function arrangeTargets(db: Db): Promise<void> {
  await db.query(
    `insert into public.sales_targets (period_month, outlet_id, user_id, target_paise)
     values
       (date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date, null,  null, $1),
       (date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date, $2,    null, $3),
       (date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date, $4,    null, $5),
       (date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date, $2,    $6,   $7)`,
    [
      TARGETS.companyPaise,
      OUTLETS.a, TARGETS.outletAPaise,
      OUTLETS.b, TARGETS.outletBPaise,
      USERS.salesA1, TARGETS.salesA1Paise,
    ],
  )
}
