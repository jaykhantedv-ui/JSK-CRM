import type { Metadata } from 'next'
import { Suspense } from 'react'

import { SkeletonRows, SkeletonTiles } from '@/components/shared/states'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendLine } from '@/features/management/charts'
import { ManagementFilters } from '@/features/management/filters'
import { MetricTile } from '@/features/management/metric-tile'
import { managementParams } from '@/features/management/params'
import { MetricNote, ReportShell } from '@/features/management/report-shell'
import { formatDate } from '@/lib/dates'
import { averageOpportunityValuePaise, formatCount } from '@/lib/metrics'
import type { Period } from '@/lib/period'
import {
  getPeriodSummary,
  getWonByMonth,
  type ManagementScope,
} from '@/services/analytics.service'
import { getTargetProgress } from '@/services/target.service'

export const metadata: Metadata = { title: 'Won and lost · JSK CRM' }

/** Twelve months of history beside the period's own figures. */
const TREND_MONTHS = 12

/**
 * The won/lost report (§16 report 2) — outcomes for the period, against target.
 *
 * §2.4 — the word "Revenue" is not used here or anywhere. Won Value.
 */
export default async function WonLostReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flat, period, scope, query } = managementParams(await searchParams)

  return (
    <ReportShell
      title="Won and lost"
      description="What closed, what it was worth, and how it compares with target"
      period={period}
      filters={
        <Suspense fallback={<SkeletonRows rows={1} />}>
          <ManagementFilters period={period} exportDataset="opportunities" />
        </Suspense>
      }
    >
      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonTiles tiles={6} />}>
        <Body period={period} scope={scope} query={query} />
      </Suspense>
    </ReportShell>
  )
}

async function Body({
  period,
  scope,
  query,
}: {
  period: Period
  scope: ManagementScope
  query: string
}) {
  const summary = await getPeriodSummary(period, scope)

  const [target, trend] = await Promise.all([
    getTargetProgress(period, summary.wonValuePaise, {
      outletId: scope.outletId ?? undefined,
      userId: scope.ownerId ?? undefined,
    }),
    getWonByMonth(TREND_MONTHS, scope),
  ])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Won Value"
          paise={summary.wonValuePaise}
          hint={`${formatCount(summary.wonCount)} won`}
          emphasis
        />
        <MetricTile
          label="Lost Value"
          paise={summary.lostValuePaise}
          hint={`${formatCount(summary.lostCount)} lost`}
          tone={summary.lostCount > 0 ? 'alert' : 'default'}
          href={`/reports/lost-reasons${query}`}
          emphasis
        />
        <MetricTile label="Win rate" percent={summary.winRatePercent} hint="Of what closed" />
        <MetricTile
          label="Average won deal"
          paise={averageOpportunityValuePaise(summary.wonValuePaise, summary.wonCount)}
        />
      </div>

      {/* Sales versus target (§10). "No target set" is stated plainly rather than
          shown as a 0% shortfall against a target nobody set. */}
      <Card>
        <CardHeader>
          <CardTitle>Against target</CardTitle>
        </CardHeader>
        <CardBody>
          {target.targetPaise === null ? (
            <p className="text-sm text-muted-foreground">
              No target is set for this period and scope. Set one at{' '}
              <a href="/reports/targets" className="text-primary hover:underline">
                Sales targets
              </a>
              .
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricTile label="Target" paise={target.targetPaise} />
              <MetricTile label="Achieved" paise={target.achievedPaise} />
              <MetricTile
                label="Achievement"
                percent={target.achievementPercent}
                tone={target.isMet ? 'good' : 'warn'}
              />
              <MetricTile
                label={target.isMet ? 'Beyond target' : 'Still needed'}
                paise={
                  target.isMet
                    ? target.achievedPaise - target.targetPaise
                    : (target.gapPaise ?? 0)
                }
                tone={target.isMet ? 'good' : 'warn'}
              />
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Won Value by month</CardTitle>
          <span className="text-xs text-muted-foreground">Last {TREND_MONTHS} months</span>
        </CardHeader>
        <CardBody>
          <TrendLine
            points={trend.map((point) => ({
              label: formatDate(point.monthStart).slice(3).replace(/ 20/, ' '),
              valuePaise: point.wonValuePaise,
            }))}
          />
        </CardBody>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="New enquiries"
          count={summary.newEnquiryCount}
          hint="Created in this period"
          href={`/opportunities${query}`}
        />
        <MetricTile
          label="Quoted Value"
          paise={summary.quotedValuePaise}
          hint="Quotations dated in this period"
        />
        <MetricTile
          label="Closed"
          count={summary.wonCount + summary.lostCount}
          hint="Won plus lost"
        />
      </div>

      <MetricNote>
        <strong>Won Value</strong> is the confirmed order value of enquiries whose close date falls
        in this period. <strong>Lost Value</strong> is the <em>estimated</em> value of what was
        lost, because a lost enquiry has no order value and using the quoted figure would silently
        drop everything lost before a quotation went out. <strong>Win rate</strong> is won ÷ (won +
        lost) over what closed in the period; open work is not counted as a loss, and when nothing
        closed the rate is shown as an em dash rather than 0%.
      </MetricNote>
    </div>
  )
}
