import { businessDayStart, businessMonthStart, businessToday, addDays } from '@/lib/dates'
import { fromPostgrestError } from '@/lib/errors'
import type { TargetProgress } from '@/lib/metrics'
import { weightedPaise } from '@/lib/money'
import { UPCOMING_WINDOW_DAYS } from '@/lib/next-action'
import type { Paginated } from '@/lib/pagination'
import type { Period } from '@/lib/period'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireUser } from '@/services/auth.service'
import {
  getAtRiskOpportunities,
  getExceptionCounts,
  getLostReasonAnalysis,
  getOutletComparison,
  getPeriodSummary,
  getPipelineSummary,
  getQuotationTurnaround,
  getQuoteConversion,
  getTeamWorkload,
  getWonByMonth,
  type AtRiskOpportunity,
  type ExceptionCounts,
  type LostReasonAnalysis,
  type ManagementScope,
  type MonthlyWon,
  type OutletComparisonRow,
  type PeriodSummary,
  type PipelineSummary,
  type QuotationTurnaround,
  type QuoteConversion,
  type TeamMemberWorkload,
} from '@/services/analytics.service'
import { getSetting } from '@/services/settings.service'
import { getTargetProgress } from '@/services/target.service'
import type { OpportunityFlagsRow, OpportunityStage, SessionUser } from '@/types/domain'

/**
 * Dashboard metrics (§13.1).
 *
 * **Every number here is computed from a real query against a real table.** No
 * hard-coded figure, no placeholder series, no sample row (CLAUDE.md §15). Where
 * a metric cannot be computed — Win Rate with a zero denominator — the caller
 * gets `null` and the UI renders an em dash, never `0%` (§13.1).
 *
 * Master Phase 2 built `/today` (§13.2) and the small pipeline read below.
 * Master Phase 3 adds the manager screen (§13.3) and the owner screen (§13.4) at
 * the end of this file; both compose `analytics.service.ts` rather than
 * recomputing anything.
 *
 * Thresholds are read through the settings service, never written as constants
 * (CLAUDE.md §3).
 */

/** The columns `/today` and the pipeline tiles need. Never `select('*')` on a list. */
const FLAG_COLUMNS =
  'id, title, account_id, project_id, owner_id, stage, category, estimated_value, ' +
  'final_order_value, next_action, next_action_date, next_action_note, expected_close_date, ' +
  'outlet_id, created_at, closed_at, last_activity_at, is_active, in_pipeline, is_overdue, ' +
  'is_due_today, is_missing_next_action, is_unassigned, days_in_stage, days_since_activity'

export type WorkQueueRow = Pick<
  OpportunityFlagsRow,
  | 'id' | 'title' | 'account_id' | 'stage' | 'category' | 'estimated_value'
  | 'next_action' | 'next_action_date' | 'owner_id' | 'is_overdue' | 'is_due_today'
>

export type SalespersonDashboard = {
  overdue: WorkQueueRow[]
  dueToday: WorkQueueRow[]
  upcoming: WorkQueueRow[]
  missingNextAction: WorkQueueRow[]
  newEnquiriesToContact: WorkQueueRow[]
  pipelineValuePaise: number
  weightedPipelinePaise: number
  wonThisMonth: { count: number; valuePaise: number }
  accountNames: Record<string, string>
}

/** A work-queue list is bounded like every other list (§12.8). */
const QUEUE_LIMIT = 50

/**
 * `/today` (§13.2) — a work queue, not analytics.
 *
 * Scoped to one person's own opportunities. RLS would already stop a salesperson
 * reading anybody else's, but the explicit `owner_id` filter is what makes the
 * screen mean "mine" for a manager too, who can legitimately see their whole
 * outlet and would otherwise open a queue of other people's work.
 *
 * **Not shown here:** other people's numbers, team totals, win rate, leaderboards
 * (§13.2).
 */
export async function getSalespersonDashboard(userId?: string): Promise<SalespersonDashboard> {
  const user: SessionUser = await requireUser()
  const ownerId = userId ?? user.id
  const supabase = await createSupabaseServerClient()

  const today = businessToday()
  const horizon = addDays(today, UPCOMING_WINDOW_DAYS)
  const slaHours = await getSetting('new_enquiry_sla_hours')
  const slaCutoff = new Date(Date.now() - slaHours * 3_600_000).toISOString()
  const monthStart = businessDayStart(businessMonthStart(today))

  const base = () =>
    supabase.from('v_opportunity_flags').select(FLAG_COLUMNS).eq('owner_id', ownerId)

  const [overdue, dueToday, upcoming, missing, slaBreach, pipeline, won] = await Promise.all([
    base().eq('is_overdue', true).order('next_action_date', { ascending: true }).limit(QUEUE_LIMIT),
    base().eq('is_due_today', true).order('created_at', { ascending: true }).limit(QUEUE_LIMIT),
    base()
      .eq('is_active', true)
      .gt('next_action_date', today)
      .lte('next_action_date', horizon)
      .order('next_action_date', { ascending: true })
      .limit(QUEUE_LIMIT),
    base()
      .eq('is_missing_next_action', true)
      .order('created_at', { ascending: true })
      .limit(QUEUE_LIMIT),
    // §13.2 tile 5 — a new enquiry nobody has touched inside the SLA window.
    base()
      .eq('stage', 'new')
      .lt('created_at', slaCutoff)
      .order('created_at', { ascending: true })
      .limit(QUEUE_LIMIT),
    // §13.1 Pipeline Value — `in_pipeline` already excludes won, lost and nurture.
    base().eq('in_pipeline', true).limit(1000),
    // §13.1 Won Value — final order value, closed inside the period.
    base().eq('stage', 'won').gte('closed_at', monthStart).limit(1000),
  ])

  for (const result of [overdue, dueToday, upcoming, missing, slaBreach, pipeline, won]) {
    if (result.error) throw fromPostgrestError(result.error)
  }

  const probabilities = await getSetting('stage_probabilities')
  const pipelineRows = (pipeline.data ?? []) as unknown as OpportunityFlagsRow[]
  const wonRows = (won.data ?? []) as unknown as OpportunityFlagsRow[]

  const rows = [overdue, dueToday, upcoming, missing, slaBreach].flatMap(
    (result) => (result.data ?? []) as unknown as WorkQueueRow[],
  )

  return {
    overdue: (overdue.data ?? []) as unknown as WorkQueueRow[],
    dueToday: (dueToday.data ?? []) as unknown as WorkQueueRow[],
    upcoming: (upcoming.data ?? []) as unknown as WorkQueueRow[],
    missingNextAction: (missing.data ?? []) as unknown as WorkQueueRow[],
    newEnquiriesToContact: (slaBreach.data ?? []) as unknown as WorkQueueRow[],
    pipelineValuePaise: pipelineRows.reduce((sum, row) => sum + (row.estimated_value ?? 0), 0),
    weightedPipelinePaise: pipelineRows.reduce(
      (sum, row) => sum + weightedPaise(row.estimated_value ?? 0, probabilities[row.stage as string] ?? 0),
      0,
    ),
    wonThisMonth: {
      count: wonRows.length,
      valuePaise: wonRows.reduce((sum, row) => sum + (row.final_order_value ?? 0), 0),
    },
    accountNames: await resolveAccountNames(rows.map((row) => row.account_id as string)),
  }
}

/**
 * Customer names for a queue, in one round-trip.
 *
 * A missing name means RLS hid the account, which is not an error — the row still
 * renders, without a name it should not show.
 */
async function resolveAccountNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return {}

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('accounts').select('id, name').in('id', unique)
  if (error) throw fromPostgrestError(error)

  return Object.fromEntries((data ?? []).map((row) => [row.id, row.name]))
}

export type StageSummary = {
  stage: OpportunityStage
  count: number
  valuePaise: number
}

export type PipelineOverview = {
  byStage: StageSummary[]
  pipelineValuePaise: number
  weightedPipelinePaise: number
  activeCount: number
  exceptions: {
    unassigned: number
    overdue: number
    missingNextAction: number
    dormant: number
  }
}

/**
 * Basic pipeline visibility for a manager — count and value by stage, plus the
 * four exception counts that follow directly from the next-action model.
 *
 * Scoped by RLS to the outlets the caller manages; an OWNER sees everything by
 * role. Deliberately small, and kept as it was: `/opportunities/board` and the
 * Phase 2 pipeline card still call it, and the Phase 3 management surfaces go
 * through `getPipelineSummary()` in `analytics.service.ts`, which aggregates in
 * SQL instead of reducing rows here.
 */
export async function getPipelineOverview(filters?: {
  outletId?: string | null
  ownerId?: string | null
}): Promise<PipelineOverview> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('v_opportunity_flags')
    .select('id, stage, estimated_value, owner_id, is_active, in_pipeline, is_overdue, is_missing_next_action, is_unassigned, days_since_activity')
    .eq('is_active', true)
    .limit(5000)

  if (filters?.outletId) query = query.eq('outlet_id', filters.outletId)
  if (filters?.ownerId) query = query.eq('owner_id', filters.ownerId)

  const { data, error } = await query
  if (error) throw fromPostgrestError(error)

  const rows = (data ?? []) as unknown as OpportunityFlagsRow[]
  const probabilities = await getSetting('stage_probabilities')
  const dormancyDays = await getSetting('opportunity_dormancy_days')

  const stages: OpportunityStage[] = [
    'new', 'qualified', 'selection', 'quoted', 'negotiation', 'verbal_confirmation', 'nurture',
  ]

  const byStage = stages.map((stage) => {
    const inStage = rows.filter((row) => row.stage === stage)
    return {
      stage,
      count: inStage.length,
      valuePaise: inStage.reduce((sum, row) => sum + (row.estimated_value ?? 0), 0),
    }
  })

  // §13.1 — Pipeline Value excludes `nurture` as well as the terminal stages.
  const inPipeline = rows.filter((row) => row.in_pipeline)

  return {
    byStage,
    pipelineValuePaise: inPipeline.reduce((sum, row) => sum + (row.estimated_value ?? 0), 0),
    weightedPipelinePaise: inPipeline.reduce(
      (sum, row) => sum + weightedPaise(row.estimated_value ?? 0, probabilities[row.stage as string] ?? 0),
      0,
    ),
    activeCount: rows.length,
    exceptions: {
      unassigned: rows.filter((row) => row.is_unassigned).length,
      overdue: rows.filter((row) => row.is_overdue).length,
      missingNextAction: rows.filter((row) => row.is_missing_next_action).length,
      dormant: rows.filter((row) => (row.days_since_activity ?? 0) > dormancyDays).length,
    },
  }
}

// ===========================================================================
// Master Phase 3 — the management dashboards (§13.3, §13.4)
// ===========================================================================
//
// `getPipelineOverview()` above stays exactly as Master Phase 2 left it: it is
// the small, unscoped pipeline read, and other things still call it. Everything
// below composes the aggregate services in `analytics.service.ts` — one RPC per
// block, all issued together — rather than adding another way to compute a
// number that is already defined once (CLAUDE.md §8).
//
// **These are assembly functions. They contain no arithmetic.** Every figure
// they return was computed by a metric function in `lib/metrics.ts` or an
// aggregate in migration 022. A sum written here would be a second definition of
// a metric, which is how two screens come to disagree.

/**
 * §13.3 — the manager's screen, scoped to the branches they manage.
 *
 * Deliberately assembled in one `Promise.all`: eight blocks, eight round trips
 * issued concurrently rather than sequentially, and no block waiting on another
 * (§19 — management tiles must not make dozens of serial database calls).
 */
export type ManagerDashboard = {
  period: Period
  pipeline: PipelineSummary
  summary: PeriodSummary
  exceptions: ExceptionCounts
  team: TeamMemberWorkload[]
  conversion: QuoteConversion
  turnaround: QuotationTurnaround
  lostReasons: LostReasonAnalysis
  outlets: OutletComparisonRow[]
  target: TargetProgress
  atRisk: Paginated<AtRiskOpportunity>
}

/** How many at-risk rows the dashboard previews before sending the manager to the full list. */
export const DASHBOARD_AT_RISK_PREVIEW = 8

export async function getManagerDashboard(
  period: Period,
  scope: ManagementScope = {},
): Promise<ManagerDashboard> {
  const [
    pipeline,
    summary,
    exceptions,
    team,
    conversion,
    turnaround,
    lostReasons,
    outlets,
    atRisk,
  ] = await Promise.all([
    getPipelineSummary(scope),
    getPeriodSummary(period, scope),
    getExceptionCounts(scope),
    getTeamWorkload(period, scope),
    getQuoteConversion(period, scope),
    getQuotationTurnaround(period, scope),
    getLostReasonAnalysis(period, scope),
    getOutletComparison(period),
    getAtRiskOpportunities(scope, { page: 1, pageSize: DASHBOARD_AT_RISK_PREVIEW }),
  ])

  // The target follows the summary because it needs the achieved figure, and it
  // is scoped the same way the numbers beside it are: a branch-filtered
  // dashboard compares against that branch's target, not the company's.
  const target = await getTargetProgress(period, summary.wonValuePaise, {
    outletId: scope.outletId ?? undefined,
    userId: scope.ownerId ?? undefined,
  })

  return {
    period,
    pipeline,
    summary,
    exceptions,
    team,
    conversion,
    turnaround,
    lostReasons,
    outlets,
    target,
    atRisk,
  }
}

/**
 * §13.4 — the owner's screen. **Deliberately small. Do not add tiles.**
 *
 * The specification says so in those words, and the Master Phase 3 brief repeats
 * it: every tile must answer an actual management question, and "we have the
 * data" is not one. What is here is this month against target, the pipeline,
 * the trend, the exceptions worth waking up for, and where the losses are going.
 */
export type OwnerDashboard = {
  period: Period
  pipeline: PipelineSummary
  summary: PeriodSummary
  exceptions: ExceptionCounts
  conversion: QuoteConversion
  outlets: OutletComparisonRow[]
  team: TeamMemberWorkload[]
  lostReasons: LostReasonAnalysis
  trend: MonthlyWon[]
  target: TargetProgress
  atRisk: Paginated<AtRiskOpportunity>
}

/** §13.4's "any salesperson with more than ten overdue" line. */
export const OWNER_OVERDUE_ALERT_THRESHOLD = 10

/** §13.4 shows the top three lost reasons, not the whole list. */
export const OWNER_TOP_LOST_REASONS = 3

/** The trend block is twelve months (§13.4). */
export const OWNER_TREND_MONTHS = 12

export async function getOwnerDashboard(
  period: Period,
  scope: ManagementScope = {},
): Promise<OwnerDashboard> {
  const [pipeline, summary, exceptions, conversion, outlets, team, lostReasons, trend, atRisk] =
    await Promise.all([
      getPipelineSummary(scope),
      getPeriodSummary(period, scope),
      getExceptionCounts(scope),
      getQuoteConversion(period, scope),
      getOutletComparison(period),
      getTeamWorkload(period, scope),
      getLostReasonAnalysis(period, scope),
      getWonByMonth(OWNER_TREND_MONTHS, scope),
      getAtRiskOpportunities(scope, { page: 1, pageSize: DASHBOARD_AT_RISK_PREVIEW }),
    ])

  const target = await getTargetProgress(period, summary.wonValuePaise, {
    outletId: scope.outletId ?? null,
    userId: null,
  })

  return {
    period,
    pipeline,
    summary,
    exceptions,
    conversion,
    outlets,
    team,
    lostReasons,
    trend,
    target,
    atRisk,
  }
}
