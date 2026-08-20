import type { Metadata } from 'next'
import { Suspense } from 'react'

import { Pagination } from '@/components/shared/pagination'
import { SkeletonRows } from '@/components/shared/states'
import { Card, CardBody } from '@/components/ui/card'
import { AtRiskList } from '@/features/management/at-risk-list'
import { ManagementFilters } from '@/features/management/filters'
import { MetricTile } from '@/features/management/metric-tile'
import { managementParams } from '@/features/management/params'
import { MetricNote, ReportShell } from '@/features/management/report-shell'
import { formatCount } from '@/lib/metrics'
import { MOBILE_PAGE_SIZE, parsePageParams } from '@/lib/pagination'
import type { Period } from '@/lib/period'
import {
  getAtRiskOpportunities,
  getExceptionCounts,
  type ManagementScope,
} from '@/services/analytics.service'

export const metadata: Metadata = { title: 'Stalled and at risk · JSK CRM' }

/**
 * Stalled and at-risk (§9, §16 report 7).
 *
 * **Every row says why it is here.** The reasons come from `classifyRisk()`, the
 * same pure function the unit tests pin, driven by the thresholds the owner sets
 * — `stage_stall_days`, `opportunity_dormancy_days` and the high-value threshold.
 * Nothing on this page hard-codes any of them.
 *
 * The list is a live state, not a period: an enquiry is at risk today or it is
 * not. The period filter is still carried so a drill-down into another report
 * keeps its context.
 */
export default async function AtRiskReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flat, period, scope } = managementParams(await searchParams)

  return (
    <ReportShell
      title="Stalled and at risk"
      description="Open enquiries that are slipping, with the reason for each"
      filters={
        <Suspense fallback={<SkeletonRows rows={1} />}>
          <ManagementFilters period={period} exportDataset="at-risk" showPeriod={false} />
        </Suspense>
      }
    >
      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={8} />}>
        <Body scope={scope} flat={flat} period={period} />
      </Suspense>
    </ReportShell>
  )
}

async function Body({
  scope,
  flat,
}: {
  scope: ManagementScope
  flat: Record<string, string | undefined>
  period: Period
}) {
  const params = parsePageParams(flat, MOBILE_PAGE_SIZE)
  const [page, exceptions] = await Promise.all([
    getAtRiskOpportunities(scope, params),
    getExceptionCounts(scope),
  ])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Overdue follow-ups"
          count={exceptions.overdue}
          tone={exceptions.overdue > 0 ? 'alert' : 'default'}
          href="/opportunities?overdue=1"
        />
        <MetricTile
          label="Missing next action"
          count={exceptions.missingNextAction}
          tone={exceptions.missingNextAction > 0 ? 'warn' : 'default'}
          href="/opportunities?missing=1"
        />
        <MetricTile
          label="Stalled in stage"
          count={exceptions.stalled}
          tone={exceptions.stalled > 0 ? 'warn' : 'default'}
        />
        <MetricTile
          label="High value at risk"
          count={exceptions.highValueAtRisk}
          tone={exceptions.highValueAtRisk > 0 ? 'alert' : 'default'}
        />
      </div>

      <Card>
        <CardBody>
          <p className="pb-3 text-xs text-muted-foreground">
            {formatCount(page.total)} at-risk enquir{page.total === 1 ? 'y' : 'ies'}, biggest first.
          </p>
          <AtRiskList rows={page.rows} />
          <Pagination page={page} basePath="/reports/at-risk" searchParams={flat} />
        </CardBody>
      </Card>

      <MetricNote>
        An enquiry is at risk when any of these hold: its next action is{' '}
        <strong>overdue</strong>; it has <strong>no next action at all</strong>; it has been in one
        stage longer than that stage&apos;s threshold (<strong>stalled</strong>); or nothing has been
        logged against it for longer than the dormancy setting (<strong>no recent activity</strong>).
        A <strong>high value</strong> enquiry is flagged only when it is also overdue or stalled — a
        large deal being worked properly is a good thing, not a risk. Every threshold is set by the
        owner at Settings and none is written into this screen. Ordered by value, so the most
        expensive problem is first.
      </MetricNote>
    </div>
  )
}
