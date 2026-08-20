import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { OpportunityCard } from '@/components/shared/record-card'
import { EmptyState, SkeletonRows, SkeletonTiles } from '@/components/shared/states'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { ExceptionRow, MetricTile } from '@/features/management/metric-tile'
import { ScopeBar } from '@/features/management/scope-bar'
import { formatDate } from '@/lib/dates'
import { isAppError } from '@/lib/errors'
import { STAGE_LABELS } from '@/lib/labels'
import { formatCount } from '@/lib/metrics'
import { isManagerOrAbove } from '@/lib/permissions'
import { parsePeriod, type Period } from '@/lib/period'
import { toRoute } from '@/lib/routes'
import { requireUser } from '@/services/auth.service'
import { getTeamMemberDetail } from '@/services/team.service'
import type {
  NextActionType,
  OpportunityStage,
  ProductCategory,
} from '@/types/domain'

export const metadata: Metadata = { title: 'Salesperson · JSK CRM' }

/**
 * `/team/:userId` (§12.2, Master Phase 3 §8).
 *
 * One salesperson's workload, pipeline and outcomes for the selected period,
 * ending in their actual enquiries — because §21's chain is exception →
 * explanation → **action**, and the action is always on a record.
 *
 * **A person outside the caller's scope is a 404, not a 403.** `users_select`
 * hides them, the service returns NOT_FOUND, and the page renders "not found" —
 * the same answer as for a person who does not exist, so the URL cannot be used
 * to enumerate staff at other branches (§25, M-03).
 */
export default async function TeamMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireUser()
  if (!isManagerOrAbove(user)) {
    redirect(user.role === 'ADMIN' ? '/settings' : '/today')
  }

  const { userId } = await params
  const raw = await searchParams
  const flat = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  ) as Record<string, string | undefined>

  const period = parsePeriod(flat)

  return (
    <div className="flex flex-col gap-5">
      <Link href={toRoute('/team')} className="text-sm text-muted-foreground hover:underline">
        ← Team
      </Link>

      <Suspense fallback={<SkeletonRows rows={1} />}>
        <ScopeBar showPeriod exportDataset={undefined} />
      </Suspense>

      <Suspense key={`${userId}:${JSON.stringify(flat)}`} fallback={<SkeletonTiles tiles={6} />}>
        <Detail userId={userId} period={period} flat={flat} />
      </Suspense>
    </div>
  )
}

async function Detail({
  userId,
  period,
  flat,
}: {
  userId: string
  period: Period
  flat: Record<string, string | undefined>
}) {
  const detail = await loadDetail(userId, period)
  if (!detail) notFound()

  const query = ownerQuery(flat, userId)

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{detail.member.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {detail.outletNames.length > 0 ? detail.outletNames.join(', ') : 'No branch assigned'}
          {' · '}
          {period.label} · {formatDate(period.fromDate)} to {formatDate(period.toDate)}
          {detail.member.isActive ? '' : ' · deactivated'}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Won Value"
          paise={detail.period.wonValuePaise}
          hint={`${formatCount(detail.period.wonCount)} won · ${formatCount(detail.period.lostCount)} lost`}
          emphasis
        />
        <MetricTile
          label="Pipeline Value"
          paise={detail.pipeline.pipelineValuePaise}
          hint={`${formatCount(detail.pipeline.activeCount)} open`}
          href={`/opportunities?owner=${userId}`}
          emphasis
        />
        <MetricTile
          label="Win rate"
          percent={detail.winRatePercent}
          hint="Closed in this period"
        />
        <MetricTile
          label="Quote to order"
          percent={detail.quoteConversionPercent}
          hint={`${formatCount(detail.conversion.wonAfterQuoteCount)} of ${formatCount(detail.conversion.reachedQuotedCount)} quoted`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
        </CardHeader>
        <CardBody>
          <ExceptionRow
            items={[
              {
                label: 'Overdue',
                count: detail.exceptions.overdue,
                href: `/opportunities?owner=${userId}&overdue=1`,
              },
              {
                label: 'Missing next action',
                count: detail.exceptions.missingNextAction,
                href: `/opportunities?owner=${userId}&missing=1`,
              },
              {
                label: 'Stalled',
                count: detail.exceptions.stalled,
                href: `/reports/at-risk${query}`,
              },
              {
                label: 'No recent activity',
                count: detail.exceptions.dormant,
                href: `/reports/at-risk${query}`,
              },
            ]}
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricTile
          label="Activities logged"
          count={detail.activityCount}
          hint="In this period"
        />
        <MetricTile
          label="Site visits"
          count={detail.siteVisitCount}
          href={`/reports/site-visits${query}`}
        />
        <MetricTile label="Weighted Pipeline" paise={detail.pipeline.weightedPipelinePaise} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline by stage</CardTitle>
        </CardHeader>
        <CardBody>
          {detail.pipeline.byStage.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No open enquiries.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {detail.pipeline.byStage.map((row) => (
                <li key={row.stage}>
                  <Link
                    href={toRoute(`/opportunities?owner=${userId}&stage=${row.stage}`)}
                    className="flex items-center justify-between gap-3 py-2 hover:underline"
                  >
                    <span className="text-sm">{STAGE_LABELS[row.stage as OpportunityStage]}</span>
                    <span className="flex items-center gap-4">
                      <span className="text-sm text-muted-foreground">{formatCount(row.count)}</span>
                      <MoneyText paise={row.valuePaise} compact className="text-sm font-medium" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enquiries</CardTitle>
          <Link
            href={toRoute(`/opportunities?owner=${userId}`)}
            className="text-xs font-medium text-primary hover:underline"
          >
            All enquiries
          </Link>
        </CardHeader>
        <CardBody>
          {detail.recentOpportunities.length === 0 ? (
            <EmptyState
              title="No enquiries"
              description="Nothing is assigned to this person yet."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {detail.recentOpportunities.map((row) => (
                <li key={row.id as string}>
                  <OpportunityCard
                    id={row.id as string}
                    title={row.title as string}
                    stage={row.stage as OpportunityStage}
                    category={row.category as ProductCategory}
                    estimatedValuePaise={row.estimated_value}
                    nextAction={row.next_action as NextActionType | null}
                    nextActionDate={row.next_action_date}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-muted-foreground">
        Win rate is null and shows an em dash until something closes in the period.
      </p>
    </div>
  )
}

/**
 * NOT_FOUND becomes the framework's own not-found page; anything else is a real
 * failure and is left to the error boundary. Swallowing every error here would
 * turn a broken query into a convincing "no such person".
 */
async function loadDetail(userId: string, period: Period) {
  try {
    return await getTeamMemberDetail(userId, period)
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_FAILED')) {
      return null
    }
    throw error
  }
}

function ownerQuery(flat: Record<string, string | undefined>, userId: string): string {
  const params = new URLSearchParams()
  for (const key of ['period', 'from', 'to', 'outlet']) {
    const value = flat[key]
    if (value) params.set(key, value)
  }
  params.set('owner', userId)
  return `?${params.toString()}`
}
