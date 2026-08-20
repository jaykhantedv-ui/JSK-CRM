import type { Metadata } from 'next'
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
import { formatCount, formatPercent, sharePercent } from '@/lib/metrics'
import type { Period } from '@/lib/period'
import { getOutletComparison, type OutletComparisonRow } from '@/services/analytics.service'

export const metadata: Metadata = { title: 'Branch comparison · JSK CRM' }

/**
 * Branch comparison (§7, §16 report 10).
 *
 * The business runs two branches and plans five to ten, so comparison is a
 * surface rather than a filter.
 *
 * **Rows come from the caller's own scope.** A manager compares the branches they
 * manage; an owner compares every active one. A manager assigned to one branch
 * sees one row, and that is the correct answer rather than a bug — comparing
 * against a branch they cannot see would leak exactly what §4 forbids.
 *
 * No branch name appears anywhere in this file. Branches are data (ADR-016).
 */
export default async function OutletComparisonReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flat, period } = managementParams(await searchParams)

  return (
    <ReportShell
      title="Branch comparison"
      description="Every branch you manage, side by side"
      period={period}
      filters={
        <Suspense fallback={<SkeletonRows rows={1} />}>
          <ManagementFilters period={period} exportDataset="outlets" showPeople={false} />
        </Suspense>
      }
    >
      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={4} />}>
        <Body period={period} query={buildQuery(flat)} />
      </Suspense>
    </ReportShell>
  )
}

async function Body({ period, query }: { period: Period; query: string }) {
  const rows = await getOutletComparison(period)

  if (rows.length === 0) {
    return (
      <Card>
        <CardBody className="py-10 text-center text-sm text-muted-foreground">
          You do not manage any branch yet. Ask the owner to assign you one.
        </CardBody>
      </Card>
    )
  }

  const wonTotal = rows.reduce((sum, row) => sum + row.wonValuePaise, 0)
  const pipelineTotal = rows.reduce((sum, row) => sum + row.pipelineValuePaise, 0)
  const enquiryTotal = rows.reduce((sum, row) => sum + row.newEnquiryCount, 0)
  const overdueTotal = rows.reduce((sum, row) => sum + row.overdueCount, 0)

  const columns: Column<OutletComparisonRow>[] = [
    { key: 'name', header: 'Branch', cell: (row) => row.name },
    {
      key: 'enquiries',
      header: 'Enquiries',
      cell: (row) => formatCount(row.newEnquiryCount),
      numeric: true,
    },
    { key: 'active', header: 'Open', cell: (row) => formatCount(row.activeCount), numeric: true },
    {
      key: 'pipeline',
      header: 'Pipeline Value',
      cell: (row) => <MoneyText paise={row.pipelineValuePaise} compact />,
      numeric: true,
    },
    {
      key: 'quoted',
      header: 'Quoted Value',
      cell: (row) => <MoneyText paise={row.quotedValuePaise} compact />,
      numeric: true,
      secondary: true,
    },
    {
      key: 'won',
      header: 'Won Value',
      cell: (row) => <MoneyText paise={row.wonValuePaise} compact />,
      numeric: true,
    },
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
      key: 'visits',
      header: 'Site visits',
      cell: (row) => formatCount(row.siteVisitCount),
      numeric: true,
      secondary: true,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Branches compared" count={rows.length} />
        <MetricTile label="New enquiries" count={enquiryTotal} emphasis />
        <MetricTile label="Won Value" paise={wonTotal} emphasis />
        <MetricTile
          label="Overdue follow-ups"
          count={overdueTotal}
          tone={overdueTotal > 0 ? 'alert' : 'default'}
          href="/opportunities?overdue=1"
        />
      </div>

      <Card>
        <CardBody className="px-0">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.outletId}
            rowHref={(row) => `/dashboard${withOutlet(query, row.outletId)}`}
            caption="Comparison by branch"
          />
        </CardBody>
      </Card>

      {rows.length > 1 ? (
        <Card>
          <CardBody className="flex flex-col gap-3 pt-3">
            <p className="text-xs font-medium text-muted-foreground">Share of Won Value</p>
            {rows.map((row) => (
              <div key={row.outletId} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{row.name}</span>
                  <span className="text-xs text-muted-foreground">
                    <MoneyText paise={row.wonValuePaise} compact /> ·{' '}
                    {formatPercent(sharePercent(row.wonValuePaise, wonTotal), 1)}
                  </span>
                </div>
                <ProportionBar
                  percent={sharePercent(row.wonValuePaise, wonTotal)}
                  tone="won"
                  label={`${row.name}: ${formatPercent(sharePercent(row.wonValuePaise, wonTotal))} of Won Value`}
                />
              </div>
            ))}
            <p className="pt-1 text-xs font-medium text-muted-foreground">Share of Pipeline Value</p>
            {rows.map((row) => (
              <div key={row.outletId} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{row.name}</span>
                  <span className="text-xs text-muted-foreground">
                    <MoneyText paise={row.pipelineValuePaise} compact /> ·{' '}
                    {formatPercent(sharePercent(row.pipelineValuePaise, pipelineTotal), 1)}
                  </span>
                </div>
                <ProportionBar
                  percent={sharePercent(row.pipelineValuePaise, pipelineTotal)}
                  tone="active"
                  label={`${row.name}: ${formatPercent(sharePercent(row.pipelineValuePaise, pipelineTotal))} of Pipeline Value`}
                />
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <MetricNote>
        Enquiries, Quoted Value, Won Value, win rate, conversion and site visits cover the selected
        period; Open and Pipeline Value are current. <strong>You see only the branches you
        manage</strong> — an owner sees every active branch, a manager sees theirs, and shares are
        computed against the branches shown rather than the whole company. Win rate and conversion
        are an em dash where nothing closed. Opening a row filters the dashboard to that branch.
      </MetricNote>
    </div>
  )
}

function buildQuery(flat: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const key of ['period', 'from', 'to']) {
    const value = flat[key]
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

function withOutlet(query: string, outletId: string): string {
  const params = new URLSearchParams(query.replace(/^\?/, ''))
  params.set('outlet', outletId)
  return `?${params.toString()}`
}
