import { forbidden, fromPostgrestError, notFound } from '@/lib/errors'
import { quoteToOrderConversion, winRate } from '@/lib/metrics'
import { DESKTOP_PAGE_SIZE, type PageParams } from '@/lib/pagination'
import { isManagerOrAbove } from '@/lib/permissions'
import type { Period } from '@/lib/period'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'
import { requireUser } from '@/services/auth.service'
import {
  getExceptionCounts,
  getPeriodSummary,
  getPipelineSummary,
  getQuoteConversion,
  getSiteVisits,
  getTeamWorkload,
  type ExceptionCounts,
  type PeriodSummary,
  type PipelineSummary,
  type QuoteConversion,
  type TeamMemberWorkload,
} from '@/services/analytics.service'
import type { OpportunityFlagsRow, SessionUser } from '@/types/domain'

/**
 * `/team` and `/team/:userId` (§12.2, Master Phase 3 §8).
 *
 * A workload surface, not an HR one. **No attendance, no commission, no rating**
 * — §8 is explicit, and §2.3 puts commission out of Version 1 scope entirely.
 * Everything here answers one of two questions: who is carrying too much, and
 * what is slipping.
 *
 * The team a manager sees comes from `management_team_workload`, whose rows are
 * bounded by `scoped_outlet_ids()` — so a manager sees their branches' people and
 * an owner sees everyone. Nothing in this file widens that.
 */

async function assertManagement(): Promise<SessionUser> {
  const user = await requireUser()
  if (!isManagerOrAbove(user)) {
    throw forbidden('The team view is available to managers and the owner only.')
  }
  return user
}

export type TeamOverview = {
  members: TeamMemberWorkload[]
  totals: {
    activeCount: number
    pipelineValuePaise: number
    overdueCount: number
    missingNextActionCount: number
    wonCount: number
    wonValuePaise: number
    siteVisitCount: number
  }
}

/**
 * The team list.
 *
 * Totals are summed from the rows the caller can actually see, so the figure at
 * the top of the screen always equals the figures beneath it. A total fetched
 * separately would eventually disagree with its own list — and a manager who
 * spots that stops trusting every other number on the page.
 */
export async function getTeamOverview(
  period: Period,
  filters: { outletId?: string | null } = {},
): Promise<TeamOverview> {
  await assertManagement()
  const members = await getTeamWorkload(period, { outletId: filters.outletId ?? null })

  return {
    members,
    totals: {
      activeCount: members.reduce((sum, row) => sum + row.activeCount, 0),
      pipelineValuePaise: members.reduce((sum, row) => sum + row.pipelineValuePaise, 0),
      overdueCount: members.reduce((sum, row) => sum + row.overdueCount, 0),
      missingNextActionCount: members.reduce((sum, row) => sum + row.missingNextActionCount, 0),
      wonCount: members.reduce((sum, row) => sum + row.wonCount, 0),
      wonValuePaise: members.reduce((sum, row) => sum + row.wonValuePaise, 0),
      siteVisitCount: members.reduce((sum, row) => sum + row.siteVisitCount, 0),
    },
  }
}

export type TeamMemberDetail = {
  member: { id: string; fullName: string; email: string; isActive: boolean }
  outletNames: string[]
  pipeline: PipelineSummary
  period: PeriodSummary
  exceptions: ExceptionCounts
  conversion: QuoteConversion
  siteVisitCount: number
  activityCount: number
  winRatePercent: number | null
  quoteConversionPercent: number | null
  recentOpportunities: OpportunityFlagsRow[]
}

/** A page of one salesperson's opportunities is still a bounded list (§12.8). */
const RECENT_OPPORTUNITY_LIMIT = 20

/**
 * One salesperson's detail (§8).
 *
 * **The visibility check is the manager's own read of the `users` row**, which is
 * governed by `users_select` and its `manages_user()` clause. A manager asking
 * for a salesperson at a branch they do not manage gets a NOT_FOUND — the same
 * answer as for a person who does not exist, so the route cannot be used to probe
 * for staff at other branches (§25, M-03).
 */
export async function getTeamMemberDetail(
  userId: string,
  period: Period,
): Promise<TeamMemberDetail> {
  await assertManagement()
  const id = uuidSchema.parse(userId)
  const supabase = await createSupabaseServerClient()

  const { data: member, error } = await supabase
    .from('users')
    .select('id, full_name, email, is_active, user_outlets!user_outlets_user_id_fkey(outlet_id, revoked_at, outlets(name))')
    .eq('id', id)
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!member) throw notFound('person')

  const scope = { ownerId: id }

  const [pipeline, periodSummary, exceptions, conversion, visits, activityCount, recent] =
    await Promise.all([
      getPipelineSummary(scope),
      getPeriodSummary(period, scope),
      getExceptionCounts(scope),
      getQuoteConversion(period, scope),
      getSiteVisits(period, scope, { page: 1, pageSize: 1 }),
      countActivities(id, period),
      supabase
        .from('v_opportunity_flags')
        .select(
          'id, title, account_id, project_id, owner_id, stage, category, estimated_value, ' +
            'final_order_value, next_action, next_action_date, closed_at, last_activity_at, ' +
            'is_overdue, is_due_today, is_missing_next_action, days_in_stage, days_since_activity',
        )
        .eq('owner_id', id)
        .order('next_action_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(RECENT_OPPORTUNITY_LIMIT),
    ])

  if (recent.error) throw fromPostgrestError(recent.error)

  return {
    member: {
      id: member.id,
      fullName: member.full_name,
      email: member.email,
      isActive: member.is_active,
    },
    outletNames: (member.user_outlets ?? [])
      .filter((row) => row.revoked_at === null)
      .map((row) => row.outlets?.name)
      .filter((name): name is string => Boolean(name))
      .sort(),
    pipeline,
    period: periodSummary,
    exceptions,
    conversion,
    siteVisitCount: visits.total,
    activityCount,
    winRatePercent: winRate(periodSummary.wonCount, periodSummary.lostCount),
    quoteConversionPercent: quoteToOrderConversion(
      conversion.wonAfterQuoteCount,
      conversion.reachedQuotedCount,
    ),
    recentOpportunities: (recent.data ?? []) as unknown as OpportunityFlagsRow[],
  }
}

/**
 * How much this person logged in the period.
 *
 * `head: true` with an exact count: the number is wanted, the rows are not, and
 * transferring a quarter of somebody's activity history to count it would be a
 * needless round trip (§19).
 */
async function countActivities(userId: string, period: Period): Promise<number> {
  const supabase = await createSupabaseServerClient()
  const { count, error } = await supabase
    .from('activities')
    .select('id', { count: 'exact', head: true })
    .eq('performed_by', userId)
    .gte('occurred_at', period.fromInstant)
    .lt('occurred_at', period.toInstant)

  if (error) throw fromPostgrestError(error)
  return count ?? 0
}

/** The page size the team list uses. Exported so the export route agrees with it. */
export const TEAM_PAGE_SIZE: PageParams = { page: 1, pageSize: DESKTOP_PAGE_SIZE }
