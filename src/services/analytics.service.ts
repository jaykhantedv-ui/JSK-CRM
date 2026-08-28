import { businessToday } from '@/lib/dates'
import { AppError, fromPostgrestError } from '@/lib/errors'
import {
  classifyRisk,
  lostReasonShares,
  pipelineValuePaise,
  quoteToOrderConversion,
  weightedPipelinePaise,
  winRate,
  type LostReasonShare,
  type RiskReason,
} from '@/lib/metrics'
import { pageRange, paginate, type PageParams, type Paginated } from '@/lib/pagination'
import type { Period } from '@/lib/period'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireManagementAccess } from '@/services/auth.service'
import { getSetting } from '@/services/settings.service'
import type { LostReason, OpportunityStage, SessionUser } from '@/types/domain'

/**
 * Management analytics (Master Phase 3).
 *
 * **Every figure on a management screen is computed here or in `lib/metrics.ts`,
 * and nowhere else.** A React component that adds two numbers together has
 * created a second definition of a metric, and the two will disagree within a
 * quarter (CLAUDE.md §8).
 *
 * Three rules shape the whole file:
 *
 *   1. **Aggregate in SQL.** Every read below is one RPC from migration 022 that
 *      returns an already-aggregated, already-bounded result. Nothing pulls a
 *      table into Node to reduce it, so no screen can silently truncate and no
 *      report grows a round trip per row (§12.8, §19).
 *   2. **RLS is still the boundary.** The RPCs are SECURITY INVOKER, so a
 *      manager's report is scoped by the same policies as their record list. The
 *      `assertManagement()` check here is a friendly early failure, not the
 *      control — `assert_management_access()` in the database is the control, and
 *      it holds against a direct PostgREST call (§15, §19.4).
 *   3. **Thresholds come from settings.** Stall days, dormancy days and the
 *      high-value threshold are read through the settings service and passed as
 *      parameters. No number from migration 014 is written here (CLAUDE.md §3).
 */

/** Filters every management surface shares. Outlet and owner NARROW; they never widen. */
export type ManagementScope = {
  outletId?: string | null
  ownerId?: string | null
}

function scopeArgs(scope: ManagementScope = {}) {
  return {
    p_outlet: scope.outletId ?? undefined,
    p_owner: scope.ownerId ?? undefined,
  }
}

/**
 * Management reporting is MANAGER and OWNER (§3.1).
 *
 * ADMIN is refused here for the same reason it is refused in the database
 * (ADR-017): it administers users, settings and imports, and system
 * administration is not sales management.
 */
/**
 * The management surfaces — dashboard, team, reports, targets, export.
 *
 * **One helper, four services (ADR-042).** Each of these files used to write its
 * own `isManagerOrAbove()` check, and when ADR-040 admitted ADMIN to management
 * reporting the routes and the database were widened and these four were not.
 * The result was the worst possible shape: the route said yes, the service threw,
 * and an administrator got a Server Components error on Dashboard, Team, Reports
 * and every report beneath them.
 *
 * `requireManagementAccess()` mirrors `assert_management_access()` in the
 * database, which is the control.
 */
async function assertManagement(): Promise<SessionUser> {
  return requireManagementAccess()
}

/**
 * PostgREST may serialise `bigint` as a number or as a string depending on the
 * column and the client. Both are handled deliberately rather than coerced with
 * `Number()`, which would turn a malformed value into `NaN` and put it silently
 * into a total (CLAUDE.md §9).
 */
function big(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  const trimmed = value.trim()
  if (!/^-?\d+$/.test(trimmed)) {
    throw new AppError('INTERNAL', `Expected a whole number from the database, received "${value}".`)
  }
  return Number(trimmed)
}

function maybeNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The thresholds every management query needs, read once per request.
 *
 * `getAllSettings()` is wrapped in React's `cache`, so a dashboard assembling
 * eight tiles reads `system_settings` exactly once.
 */
export type ManagementThresholds = {
  stallDays: Record<string, number>
  dormancyDays: number
  highValueThresholdPaise: number
  slaCutoff: string
  probabilities: Record<string, number>
}

export async function getManagementThresholds(): Promise<ManagementThresholds> {
  const [stallDays, dormancyDays, highValueThresholdPaise, slaHours, probabilities] =
    await Promise.all([
      getSetting('stage_stall_days'),
      getSetting('opportunity_dormancy_days'),
      getSetting('high_value_threshold_paise'),
      getSetting('new_enquiry_sla_hours'),
      getSetting('stage_probabilities'),
    ])

  return {
    stallDays,
    dormancyDays,
    highValueThresholdPaise,
    slaCutoff: new Date(Date.now() - slaHours * 3_600_000).toISOString(),
    probabilities,
  }
}

// ------------------------------------------------------------ pipeline ----

export type StageBreakdown = {
  stage: OpportunityStage
  count: number
  valuePaise: number
  weightedPaise: number
  countsInPipeline: boolean
}

export type PipelineSummary = {
  byStage: StageBreakdown[]
  pipelineValuePaise: number
  weightedPipelinePaise: number
  activeCount: number
}

/**
 * Pipeline by stage, with the two headline totals (§13.1).
 *
 * Nurture appears in `byStage` — a manager has to be able to see what is parked
 * — but carries `countsInPipeline: false`, and the totals exclude it.
 */
export async function getPipelineSummary(scope: ManagementScope = {}): Promise<PipelineSummary> {
  await assertManagement()
  const { probabilities } = await getManagementThresholds()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('management_pipeline_by_stage', {
    p_probabilities: probabilities,
    ...scopeArgs(scope),
  })
  if (error) throw fromPostgrestError(error)

  const byStage: StageBreakdown[] = (data ?? []).map((row) => ({
    stage: row.stage,
    count: big(row.opportunity_count),
    valuePaise: big(row.value_paise),
    weightedPaise: big(row.weighted_paise),
    countsInPipeline: row.counts_in_pipeline ?? false,
  }))

  return {
    byStage,
    pipelineValuePaise: pipelineValuePaise(byStage),
    weightedPipelinePaise: weightedPipelinePaise(byStage),
    activeCount: byStage.reduce((sum, row) => sum + row.count, 0),
  }
}

// ---------------------------------------------------------- exceptions ----

export type ExceptionCounts = {
  unassigned: number
  overdue: number
  missingNextAction: number
  slaBreach: number
  stalled: number
  dormant: number
  highValueAtRisk: number
  quotationExpired: number
  activeTotal: number
  overdueValuePaise: number
}

/** §13.3 Panel A — the daily review, in one round trip. */
export async function getExceptionCounts(scope: ManagementScope = {}): Promise<ExceptionCounts> {
  await assertManagement()
  const thresholds = await getManagementThresholds()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('management_exceptions', {
    p_stall_days: thresholds.stallDays,
    p_dormancy_days: thresholds.dormancyDays,
    p_high_value: thresholds.highValueThresholdPaise,
    p_sla_cutoff: thresholds.slaCutoff,
    ...scopeArgs(scope),
  })
  if (error) throw fromPostgrestError(error)

  const row = data?.[0]
  return {
    unassigned: big(row?.unassigned),
    overdue: big(row?.overdue),
    missingNextAction: big(row?.missing_next_action),
    slaBreach: big(row?.sla_breach),
    stalled: big(row?.stalled),
    dormant: big(row?.dormant),
    highValueAtRisk: big(row?.high_value_at_risk),
    quotationExpired: big(row?.quotation_expired),
    activeTotal: big(row?.active_total),
    overdueValuePaise: big(row?.overdue_value_paise),
  }
}

// ------------------------------------------------------ period summary ----

export type PeriodSummary = {
  wonCount: number
  wonValuePaise: number
  lostCount: number
  lostValuePaise: number
  newEnquiryCount: number
  quotedValuePaise: number
  /** Null when nothing closed in the period — displayed as an em dash (§13.1). */
  winRatePercent: number | null
}

export async function getPeriodSummary(
  period: Period,
  scope: ManagementScope = {},
): Promise<PeriodSummary> {
  await assertManagement()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('management_period_summary', {
    p_from: period.fromInstant,
    p_to: period.toInstant,
    ...scopeArgs(scope),
  })
  if (error) throw fromPostgrestError(error)

  const row = data?.[0]
  const wonCount = big(row?.won_count)
  const lostCount = big(row?.lost_count)

  return {
    wonCount,
    wonValuePaise: big(row?.won_value_paise),
    lostCount,
    lostValuePaise: big(row?.lost_value_paise),
    newEnquiryCount: big(row?.new_enquiry_count),
    quotedValuePaise: big(row?.quoted_value_paise),
    winRatePercent: winRate(wonCount, lostCount),
  }
}

// ------------------------------------------------------- team workload ----

export type TeamMemberWorkload = {
  userId: string
  fullName: string
  isActive: boolean
  activeCount: number
  pipelineValuePaise: number
  overdueCount: number
  dueTodayCount: number
  missingNextActionCount: number
  stalledCount: number
  wonCount: number
  wonValuePaise: number
  lostCount: number
  winRatePercent: number | null
  quoteConversionPercent: number | null
  activityCount: number
  siteVisitCount: number
  lastActivityAt: string | null
}

/**
 * One row per salesperson in the caller's outlet scope (§8).
 *
 * A salesperson with nothing at all still appears, with zeros — they are exactly
 * who a manager needs to notice.
 */
export async function getTeamWorkload(
  period: Period,
  scope: ManagementScope = {},
): Promise<TeamMemberWorkload[]> {
  await assertManagement()
  const { stallDays } = await getManagementThresholds()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('management_team_workload', {
    p_from: period.fromInstant,
    p_to: period.toInstant,
    p_stall_days: stallDays,
    p_outlet: scope.outletId ?? undefined,
  })
  if (error) throw fromPostgrestError(error)

  return (data ?? []).map((row) => {
    const wonCount = big(row.won_count)
    const lostCount = big(row.lost_count)
    return {
      userId: row.user_id,
      fullName: row.full_name,
      isActive: row.is_active,
      activeCount: big(row.active_count),
      pipelineValuePaise: big(row.pipeline_value_paise),
      overdueCount: big(row.overdue_count),
      dueTodayCount: big(row.due_today_count),
      missingNextActionCount: big(row.missing_next_action),
      stalledCount: big(row.stalled_count),
      wonCount,
      wonValuePaise: big(row.won_value_paise),
      lostCount,
      winRatePercent: winRate(wonCount, lostCount),
      quoteConversionPercent: quoteToOrderConversion(
        big(row.quoted_won_count),
        big(row.quoted_reached_count),
      ),
      activityCount: big(row.activity_count),
      siteVisitCount: big(row.site_visit_count),
      lastActivityAt: row.last_activity_at,
    }
  })
}

// --------------------------------------------------- outlet comparison ----

export type OutletComparisonRow = {
  outletId: string
  code: string
  name: string
  newEnquiryCount: number
  activeCount: number
  pipelineValuePaise: number
  quotedValuePaise: number
  wonCount: number
  wonValuePaise: number
  lostCount: number
  winRatePercent: number | null
  quoteConversionPercent: number | null
  overdueCount: number
  siteVisitCount: number
}

/**
 * Branch comparison (§7).
 *
 * Rows come from `scoped_outlet_ids()`, so a manager compares the branches they
 * manage and an owner compares all of them. **No outlet name is written
 * anywhere** — outlets are data (ADR-016), and a business heading for ten of them
 * cannot have their names in the source.
 */
export async function getOutletComparison(period: Period): Promise<OutletComparisonRow[]> {
  await assertManagement()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('management_outlet_comparison', {
    p_from: period.fromInstant,
    p_to: period.toInstant,
  })
  if (error) throw fromPostgrestError(error)

  return (data ?? []).map((row) => {
    const wonCount = big(row.won_count)
    const lostCount = big(row.lost_count)
    return {
      outletId: row.outlet_id,
      code: row.outlet_code,
      name: row.outlet_name,
      newEnquiryCount: big(row.new_enquiry_count),
      activeCount: big(row.active_count),
      pipelineValuePaise: big(row.pipeline_value_paise),
      quotedValuePaise: big(row.quoted_value_paise),
      wonCount,
      wonValuePaise: big(row.won_value_paise),
      lostCount,
      winRatePercent: winRate(wonCount, lostCount),
      quoteConversionPercent: quoteToOrderConversion(
        big(row.quoted_won_count),
        big(row.quoted_reached_count),
      ),
      overdueCount: big(row.overdue_count),
      siteVisitCount: big(row.site_visit_count),
    }
  })
}

// -------------------------------------------------------- lost reasons ----

export type LostReasonAnalysis = {
  rows: LostReasonShare<LostReason>[]
  totalCount: number
  totalValuePaise: number
}

/** §14 — count, value and share by reason, from the existing enum only. */
export async function getLostReasonAnalysis(
  period: Period,
  scope: ManagementScope = {},
): Promise<LostReasonAnalysis> {
  await assertManagement()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('management_lost_reasons', {
    p_from: period.fromInstant,
    p_to: period.toInstant,
    ...scopeArgs(scope),
  })
  if (error) throw fromPostgrestError(error)

  return lostReasonShares(
    (data ?? []).map((row) => ({
      reason: row.lost_reason as LostReason,
      count: big(row.lost_count),
      valuePaise: big(row.lost_value_paise),
    })),
  )
}

// -------------------------------------------- quote-to-order conversion ----

export type QuoteConversion = {
  reachedQuotedCount: number
  wonAfterQuoteCount: number
  lostAfterQuoteCount: number
  wonAfterQuoteValuePaise: number
  /** Wins that never passed through a quotation — a recording signal, not a metric. */
  neverQuotedWonCount: number
  conversionPercent: number | null
}

export async function getQuoteConversion(
  period: Period,
  scope: ManagementScope = {},
): Promise<QuoteConversion> {
  await assertManagement()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('management_quote_conversion', {
    p_from: period.fromInstant,
    p_to: period.toInstant,
    ...scopeArgs(scope),
  })
  if (error) throw fromPostgrestError(error)

  const row = data?.[0]
  const reached = big(row?.reached_quoted_count)
  const won = big(row?.won_after_quote_count)

  return {
    reachedQuotedCount: reached,
    wonAfterQuoteCount: won,
    lostAfterQuoteCount: big(row?.lost_after_quote_count),
    wonAfterQuoteValuePaise: big(row?.won_after_quote_value_paise),
    neverQuotedWonCount: big(row?.never_quoted_won_count),
    conversionPercent: quoteToOrderConversion(won, reached),
  }
}

// --------------------------------------------------- quotation turnaround ----

export type QuotationTurnaround = {
  measuredCount: number
  /** Quotations whose start point is not in the audit trail. Reported, never hidden. */
  excludedCount: number
  averageDays: number | null
  medianDays: number | null
  slowestDays: number | null
  withinTwoDaysCount: number
}

/**
 * §12 — days from a requirement being qualified to its quotation going out.
 *
 * **The limitation is part of the result.** An opportunity imported straight into
 * a later stage has no `qualified` event, so it cannot be measured; it is counted
 * in `excludedCount` and the UI shows that count beside the average. Reporting an
 * average without saying how much of the data it covers is how a metric becomes
 * quietly wrong.
 */
export async function getQuotationTurnaround(
  period: Period,
  scope: ManagementScope = {},
): Promise<QuotationTurnaround> {
  await assertManagement()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('management_quotation_turnaround', {
    p_from: period.fromInstant,
    p_to: period.toInstant,
    ...scopeArgs(scope),
  })
  if (error) throw fromPostgrestError(error)

  const row = data?.[0]
  return {
    measuredCount: big(row?.measured_count),
    excludedCount: big(row?.excluded_count),
    averageDays: maybeNumber(row?.average_days),
    medianDays: maybeNumber(row?.median_days),
    slowestDays: maybeNumber(row?.slowest_days),
    withinTwoDaysCount: big(row?.within_two_days),
  }
}

// ---------------------------------------------------------------- trend ----

export type MonthlyWon = { monthStart: string; wonCount: number; wonValuePaise: number }

/** §13.4 — Won Value by month. Empty months are zeros, not gaps. */
export async function getWonByMonth(
  months = 12,
  scope: ManagementScope = {},
): Promise<MonthlyWon[]> {
  await assertManagement()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('management_won_by_month', {
    p_months: months,
    p_outlet: scope.outletId ?? undefined,
  })
  if (error) throw fromPostgrestError(error)

  return (data ?? []).map((row) => ({
    monthStart: row.month_start,
    wonCount: big(row.won_count),
    wonValuePaise: big(row.won_value_paise),
  }))
}

// -------------------------------------------------------------- at risk ----

export type AtRiskOpportunity = {
  id: string
  title: string
  accountId: string
  accountName: string | null
  projectId: string | null
  projectName: string | null
  ownerId: string | null
  ownerName: string | null
  outletId: string
  outletName: string | null
  stage: OpportunityStage
  estimatedValuePaise: number
  daysInStage: number
  daysSinceActivity: number
  nextActionDate: string | null
  lastActivityAt: string | null
  /** Why this record is here. An at-risk row without a reason is a mood, not a task. */
  reasons: RiskReason[]
}

/**
 * The at-risk list (§9), paginated in SQL and explained in TypeScript.
 *
 * The database answers "which rows carry at least one risk signal" — that is the
 * part a bounded, paginated query has to know. `classifyRisk()` then names the
 * reasons from the same thresholds, so the rule lives in one place and the list
 * can say *why* about every row it shows.
 */
export async function getAtRiskOpportunities(
  scope: ManagementScope = {},
  params: PageParams,
): Promise<Paginated<AtRiskOpportunity>> {
  await assertManagement()
  const thresholds = await getManagementThresholds()
  const supabase = await createSupabaseServerClient()
  const { from } = pageRange(params)

  const { data, error } = await supabase.rpc('management_at_risk', {
    p_stall_days: thresholds.stallDays,
    p_dormancy_days: thresholds.dormancyDays,
    p_limit: params.pageSize,
    p_offset: from,
    ...scopeArgs(scope),
  })
  if (error) throw fromPostgrestError(error)

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    accountId: row.account_id,
    accountName: row.account_name,
    projectId: row.project_id,
    projectName: row.project_name,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    outletId: row.outlet_id,
    outletName: row.outlet_name,
    stage: row.stage,
    estimatedValuePaise: big(row.estimated_value),
    daysInStage: big(row.days_in_stage),
    daysSinceActivity: big(row.days_since_activity),
    nextActionDate: row.next_action_date,
    lastActivityAt: row.last_activity_at,
    reasons: classifyRisk(
      {
        isOverdue: row.is_overdue,
        isMissingNextAction: row.is_missing_next_action,
        daysInStage: big(row.days_in_stage),
        daysSinceActivity: big(row.days_since_activity),
        // The SQL sends `2147483647` for a stage with no configured threshold,
        // which is the same statement as "no threshold" and is normalised back to
        // null so `classifyRisk` reads it the way its tests do.
        stageStallDays: big(row.stage_stall_days) >= 2_147_483_647 ? null : big(row.stage_stall_days),
        estimatedValuePaise: big(row.estimated_value),
      },
      {
        dormancyDays: thresholds.dormancyDays,
        highValueThresholdPaise: thresholds.highValueThresholdPaise,
      },
    ),
  }))

  return paginate(rows, big(data?.[0]?.total_count), params)
}

// ------------------------------------------------- customer and project ----

export type CustomerSalesRow = {
  accountId: string
  accountName: string
  outletId: string | null
  wonCount: number
  wonValuePaise: number
  openCount: number
  pipelineValuePaise: number
  lostCount: number
  lastActivityAt: string | null
}

/** §15 — Won Value generated and Pipeline Value still open, per customer. */
export async function getCustomerSales(
  period: Period,
  scope: ManagementScope,
  params: PageParams,
): Promise<Paginated<CustomerSalesRow>> {
  await assertManagement()
  const supabase = await createSupabaseServerClient()
  const { from } = pageRange(params)

  const { data, error } = await supabase.rpc('management_customer_sales', {
    p_from: period.fromInstant,
    p_to: period.toInstant,
    p_limit: params.pageSize,
    p_offset: from,
    ...scopeArgs(scope),
  })
  if (error) throw fromPostgrestError(error)

  const rows = (data ?? []).map((row) => ({
    accountId: row.account_id,
    accountName: row.account_name,
    outletId: row.outlet_id,
    wonCount: big(row.won_count),
    wonValuePaise: big(row.won_value_paise),
    openCount: big(row.open_count),
    pipelineValuePaise: big(row.pipeline_value_paise),
    lostCount: big(row.lost_count),
    lastActivityAt: row.last_activity_at,
  }))

  return paginate(rows, big(data?.[0]?.total_count), params)
}

export type ProjectSalesRow = {
  projectId: string
  projectName: string
  accountId: string
  accountName: string | null
  outletId: string | null
  opportunityCount: number
  wonCount: number
  wonValuePaise: number
  openCount: number
  pipelineValuePaise: number
  lostCount: number
}

/**
 * §15 — per project.
 *
 * **One project has many opportunities** (§4.3). `opportunityCount` is on every
 * row so the surface cannot be read as one project meaning one sale, which is the
 * misreading this report exists to prevent.
 */
export async function getProjectSales(
  period: Period,
  scope: ManagementScope,
  params: PageParams,
): Promise<Paginated<ProjectSalesRow>> {
  await assertManagement()
  const supabase = await createSupabaseServerClient()
  const { from } = pageRange(params)

  const { data, error } = await supabase.rpc('management_project_sales', {
    p_from: period.fromInstant,
    p_to: period.toInstant,
    p_limit: params.pageSize,
    p_offset: from,
    ...scopeArgs(scope),
  })
  if (error) throw fromPostgrestError(error)

  const rows = (data ?? []).map((row) => ({
    projectId: row.project_id,
    projectName: row.project_name,
    accountId: row.account_id,
    accountName: row.account_name,
    outletId: row.outlet_id,
    opportunityCount: big(row.opportunity_count),
    wonCount: big(row.won_count),
    wonValuePaise: big(row.won_value_paise),
    openCount: big(row.open_count),
    pipelineValuePaise: big(row.pipeline_value_paise),
    lostCount: big(row.lost_count),
  }))

  return paginate(rows, big(data?.[0]?.total_count), params)
}

// --------------------------------------------------------- site visits ----

export type SiteVisitRow = {
  id: string
  occurredAt: string
  summary: string
  outcome: string
  purpose: string
  measurements: string | null
  locationNote: string | null
  accountId: string
  accountName: string
  projectId: string | null
  projectName: string | null
  opportunityId: string | null
  performedBy: string
  performedByName: string | null
  outletId: string | null
  outletName: string | null
}

/**
 * §13 — site visits are `activities.type = 'SITE_VISIT'` and nothing else. No
 * site-visit table exists and none is added.
 */
export async function getSiteVisits(
  period: Period,
  scope: ManagementScope & { projectId?: string | null },
  params: PageParams,
): Promise<Paginated<SiteVisitRow>> {
  await assertManagement()
  const supabase = await createSupabaseServerClient()
  const { from } = pageRange(params)

  const { data, error } = await supabase.rpc('management_site_visits', {
    p_from: period.fromInstant,
    p_to: period.toInstant,
    p_project: scope.projectId ?? undefined,
    p_limit: params.pageSize,
    p_offset: from,
    ...scopeArgs(scope),
  })
  if (error) throw fromPostgrestError(error)

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    summary: row.summary,
    outcome: row.outcome,
    purpose: row.purpose,
    measurements: row.measurements,
    locationNote: row.location_note,
    accountId: row.account_id,
    accountName: row.account_name,
    projectId: row.project_id,
    projectName: row.project_name,
    opportunityId: row.opportunity_id,
    performedBy: row.performed_by,
    performedByName: row.performed_by_name,
    outletId: row.outlet_id,
    outletName: row.outlet_name,
  }))

  return paginate(rows, big(data?.[0]?.total_count), params)
}

/** Today, as the business reckons it. Used for export filenames and headings. */
export function reportingToday(): string {
  return businessToday()
}
