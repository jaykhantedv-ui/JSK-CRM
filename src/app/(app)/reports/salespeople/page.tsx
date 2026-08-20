import type { Metadata } from 'next'
import { Suspense } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { SkeletonRows } from '@/components/shared/states'
import { Card, CardBody } from '@/components/ui/card'
import { Column, DataTable } from '@/features/management/data-table'
import { ManagementFilters } from '@/features/management/filters'
import { managementParams } from '@/features/management/params'
import { MetricNote, ReportShell } from '@/features/management/report-shell'
import { relativeDays } from '@/lib/dates'
import { formatCount, formatPercent } from '@/lib/metrics'
import type { Period } from '@/lib/period'
import { getTeamWorkload, type ManagementScope, type TeamMemberWorkload } from '@/services/analytics.service'

export const metadata: Metadata = { title: 'Salesperson performance · JSK CRM' }

/**
 * Salesperson performance (§16 report 3).
 *
 * Workload and outcomes side by side, because neither means much alone: a low
 * Won Value with a heavy overdue count is a different problem from a low Won
 * Value with nothing overdue, and only the pair distinguishes them.
 */
export default async function SalespeopleReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flat, period, scope, query } = managementParams(await searchParams)

  return (
    <ReportShell
      title="Salesperson performance"
      description="Workload, outcomes and conversion for every salesperson in your branches"
      period={period}
      filters={
        <Suspense fallback={<SkeletonRows rows={1} />}>
          <ManagementFilters period={period} exportDataset="team" showPeople={false} />
        </Suspense>
      }
    >
      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={6} />}>
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
  const members = await getTeamWorkload(period, scope)

  if (members.length === 0) {
    return (
      <Card>
        <CardBody className="py-10 text-center text-sm text-muted-foreground">
          No salespeople are assigned to the branches you manage.
        </CardBody>
      </Card>
    )
  }

  const columns: Column<TeamMemberWorkload>[] = [
    { key: 'name', header: 'Salesperson', cell: (row) => row.fullName },
    { key: 'open', header: 'Open', cell: (row) => formatCount(row.activeCount), numeric: true },
    {
      key: 'pipeline',
      header: 'Pipeline Value',
      cell: (row) => <MoneyText paise={row.pipelineValuePaise} compact />,
      numeric: true,
    },
    { key: 'won', header: 'Won', cell: (row) => formatCount(row.wonCount), numeric: true },
    {
      key: 'wonvalue',
      header: 'Won Value',
      cell: (row) => <MoneyText paise={row.wonValuePaise} compact />,
      numeric: true,
    },
    { key: 'lost', header: 'Lost', cell: (row) => formatCount(row.lostCount), numeric: true, secondary: true },
    { key: 'winrate', header: 'Win rate', cell: (row) => formatPercent(row.winRatePercent), numeric: true },
    {
      key: 'conversion',
      header: 'Quote → order',
      cell: (row) => formatPercent(row.quoteConversionPercent),
      numeric: true,
    },
    {
      key: 'overdue',
      header: 'Overdue',
      cell: (row) => (
        <span className={row.overdueCount > 0 ? 'font-medium text-state-overdue' : ''}>
          {formatCount(row.overdueCount)}
        </span>
      ),
      numeric: true,
    },
    {
      key: 'missing',
      header: 'No next action',
      cell: (row) => formatCount(row.missingNextActionCount),
      numeric: true,
      secondary: true,
    },
    {
      key: 'stalled',
      header: 'Stalled',
      cell: (row) => formatCount(row.stalledCount),
      numeric: true,
      secondary: true,
    },
    {
      key: 'activities',
      header: 'Activities',
      cell: (row) => formatCount(row.activityCount),
      numeric: true,
      secondary: true,
    },
    {
      key: 'visits',
      header: 'Site visits',
      cell: (row) => formatCount(row.siteVisitCount),
      numeric: true,
      secondary: true,
    },
    {
      key: 'last',
      header: 'Last activity',
      cell: (row) =>
        row.lastActivityAt ? (
          relativeDays(row.lastActivityAt)
        ) : (
          <span className="text-state-at-risk">nothing logged</span>
        ),
      secondary: true,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="px-0">
          <DataTable
            columns={columns}
            rows={members}
            rowKey={(row) => row.userId}
            rowHref={(row) => `/team/${row.userId}${query}`}
            caption="Performance by salesperson"
          />
        </CardBody>
      </Card>

      <MetricNote>
        Counts and Pipeline Value are current; Won, Lost, activities and site visits cover the
        selected period. <strong>Win rate</strong> and <strong>quote to order</strong> are null —
        shown as an em dash — for anyone who closed nothing in the period, which is a quiet month
        rather than a failure. <strong>Stalled</strong> counts enquiries held in one stage longer
        than the threshold the owner set for that stage. Every row opens that person&apos;s detail.
      </MetricNote>
    </div>
  )
}
