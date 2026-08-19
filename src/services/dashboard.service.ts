import { businessDayStart, businessMonthStart, businessToday, addDays } from '@/lib/dates'
import { fromPostgrestError } from '@/lib/errors'
import { weightedPaise } from '@/lib/money'
import { UPCOMING_WINDOW_DAYS } from '@/lib/next-action'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireUser } from '@/services/auth.service'
import { getSetting } from '@/services/settings.service'
import type { OpportunityFlagsRow, OpportunityStage, SessionUser } from '@/types/domain'

/**
 * Dashboard metrics (§13.1).
 *
 * **Every number here is computed from a real query against a real table.** No
 * hard-coded figure, no placeholder series, no sample row (CLAUDE.md §15). Where
 * a metric cannot be computed — Win Rate with a zero denominator — the caller
 * gets `null` and the UI renders an em dash, never `0%` (§13.1).
 *
 * Master Phase 2 builds `/today` (§13.2) and basic pipeline visibility for a
 * manager. The team-workload and pipeline-health panels of §13.3, the owner
 * blocks of §13.4 and every chart belong to a later phase and are not stubbed
 * here.
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
 * role. Deliberately small: §13.3's team-workload and pipeline-health panels,
 * every chart and every per-salesperson comparison belong to a later phase, and
 * inventing them here would be a dashboard nobody asked for yet.
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
