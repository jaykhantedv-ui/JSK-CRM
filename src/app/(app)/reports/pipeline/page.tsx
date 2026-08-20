import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { SkeletonRows } from '@/components/shared/states'
import { Card, CardBody } from '@/components/ui/card'
import { ProportionBar } from '@/features/management/charts'
import { Column, DataTable } from '@/features/management/data-table'
import { ManagementFilters } from '@/features/management/filters'
import { MetricTile } from '@/features/management/metric-tile'
import { managementParams } from '@/features/management/params'
import { MetricNote, ReportShell } from '@/features/management/report-shell'
import { STAGE_LABELS } from '@/lib/labels'
import { formatCount, formatPercent, sharePercent } from '@/lib/metrics'
import type { Period } from '@/lib/period'
import { getPipelineSummary, type ManagementScope, type StageBreakdown } from '@/services/analytics.service'

export const metadata: Metadata = { title: 'Pipeline report · JSK CRM' }

/**
 * The pipeline report (§16 report 1).
 *
 * A live state rather than a period: Pipeline Value is what is open **now**, not
 * what was open across a range. The period filter is still offered because the
 * export and the drill-downs carry it, but the figures here are current.
 */
export default async function PipelineReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flat, period, scope, query } = managementParams(await searchParams)

  return (
    <ReportShell
      title="Pipeline"
      description="Open enquiries by stage, with the weighting each stage contributes"
      filters={
        <Suspense fallback={<SkeletonRows rows={1} />}>
          <ManagementFilters period={period} exportDataset="pipeline" showPeriod={false} />
        </Suspense>
      }
    >
      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={5} />}>
        <Body scope={scope} query={query} period={period} />
      </Suspense>
    </ReportShell>
  )
}

async function Body({
  scope,
  query,
}: {
  scope: ManagementScope
  query: string
  period: Period
}) {
  const summary = await getPipelineSummary(scope)

  const columns: Column<StageBreakdown>[] = [
    { key: 'stage', header: 'Stage', cell: (row) => STAGE_LABELS[row.stage] },
    { key: 'count', header: 'Enquiries', cell: (row) => formatCount(row.count), numeric: true },
    {
      key: 'value',
      header: 'Value',
      cell: (row) => <MoneyText paise={row.valuePaise} compact />,
      numeric: true,
    },
    {
      key: 'weighted',
      header: 'Weighted',
      cell: (row) => <MoneyText paise={row.weightedPaise} compact />,
      numeric: true,
    },
    {
      key: 'share',
      header: 'Share of pipeline',
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          <span className="w-12 text-right">
            {row.countsInPipeline
              ? formatPercent(sharePercent(row.valuePaise, summary.pipelineValuePaise))
              : '—'}
          </span>
          <ProportionBar
            className="w-20"
            percent={
              row.countsInPipeline
                ? sharePercent(row.valuePaise, summary.pipelineValuePaise)
                : null
            }
            label={`${STAGE_LABELS[row.stage]} share of Pipeline Value`}
          />
        </div>
      ),
      numeric: true,
      secondary: true,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Pipeline Value" paise={summary.pipelineValuePaise} emphasis />
        <MetricTile label="Weighted Pipeline" paise={summary.weightedPipelinePaise} emphasis />
        <MetricTile
          label="Open enquiries"
          count={summary.activeCount}
          href={`/opportunities${query}`}
        />
        <MetricTile
          label="Stages in use"
          count={summary.byStage.length}
          hint="Excluding won and lost"
        />
      </div>

      <Card>
        <CardBody className="px-0">
          {summary.byStage.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No open enquiries in this scope.
            </p>
          ) : (
            <DataTable
              columns={columns}
              rows={summary.byStage}
              rowKey={(row) => row.stage}
              rowHref={(row) => `/opportunities?stage=${row.stage}`}
              caption="Pipeline by stage"
            />
          )}
        </CardBody>
      </Card>

      <MetricNote>
        <strong>Pipeline Value</strong> is the total estimated value of enquiries whose stage is
        not won, lost or nurture. <strong>Weighted Pipeline</strong> multiplies each enquiry by its
        stage probability, which the owner sets at Settings. Nurture is listed because a manager has
        to be able to see what is parked, and it is excluded from both totals — the share column
        shows an em dash for it rather than a percentage of a total it is not part of.{' '}
        <Link href="/opportunities" className="text-primary hover:underline">
          Open the pipeline list
        </Link>{' '}
        to work the records themselves.
      </MetricNote>
    </div>
  )
}
