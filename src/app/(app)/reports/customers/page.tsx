import type { Metadata } from 'next'
import { Suspense } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { Pagination } from '@/components/shared/pagination'
import { SkeletonRows } from '@/components/shared/states'
import { Card, CardBody } from '@/components/ui/card'
import { Column, DataTable } from '@/features/management/data-table'
import { ManagementFilters } from '@/features/management/filters'
import { MetricTile } from '@/features/management/metric-tile'
import { managementParams } from '@/features/management/params'
import { MetricNote, ReportShell } from '@/features/management/report-shell'
import { relativeDays } from '@/lib/dates'
import { formatCount } from '@/lib/metrics'
import { MOBILE_PAGE_SIZE, parsePageParams } from '@/lib/pagination'
import type { Period } from '@/lib/period'
import { getCustomerSales, type CustomerSalesRow, type ManagementScope } from '@/services/analytics.service'

export const metadata: Metadata = { title: 'Customer sales · JSK CRM' }

/**
 * Customer sales (§15, §16 report 8).
 *
 * Answers the two questions §15 asks: how much has this customer generated in
 * Won Value, and how much active Pipeline Value is still open with them.
 *
 * Won figures cover the selected period; Pipeline Value is current, because
 * "still open" has no meaning inside a past range.
 */
export default async function CustomerSalesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flat, period, scope } = managementParams(await searchParams)

  return (
    <ReportShell
      title="Customer sales"
      description="Won Value generated and pipeline still open, per customer"
      period={period}
      filters={
        <Suspense fallback={<SkeletonRows rows={1} />}>
          <ManagementFilters period={period} exportDataset="customer-sales" />
        </Suspense>
      }
    >
      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={8} />}>
        <Body period={period} scope={scope} flat={flat} />
      </Suspense>
    </ReportShell>
  )
}

async function Body({
  period,
  scope,
  flat,
}: {
  period: Period
  scope: ManagementScope
  flat: Record<string, string | undefined>
}) {
  const page = await getCustomerSales(period, scope, parsePageParams(flat, MOBILE_PAGE_SIZE))

  const wonTotal = page.rows.reduce((sum, row) => sum + row.wonValuePaise, 0)
  const pipelineTotal = page.rows.reduce((sum, row) => sum + row.pipelineValuePaise, 0)

  const columns: Column<CustomerSalesRow>[] = [
    { key: 'name', header: 'Customer', cell: (row) => row.accountName },
    { key: 'won', header: 'Won', cell: (row) => formatCount(row.wonCount), numeric: true },
    {
      key: 'wonvalue',
      header: 'Won Value',
      cell: (row) => <MoneyText paise={row.wonValuePaise} compact />,
      numeric: true,
    },
    { key: 'open', header: 'Open', cell: (row) => formatCount(row.openCount), numeric: true },
    {
      key: 'pipeline',
      header: 'Pipeline Value',
      cell: (row) => <MoneyText paise={row.pipelineValuePaise} compact />,
      numeric: true,
    },
    { key: 'lost', header: 'Lost', cell: (row) => formatCount(row.lostCount), numeric: true, secondary: true },
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Customers" count={page.total} emphasis />
        <MetricTile label="Won Value on this page" paise={wonTotal} emphasis />
        <MetricTile label="Pipeline on this page" paise={pipelineTotal} />
        <MetricTile
          label="Top customer"
          value={page.rows[0]?.accountName ?? '—'}
          hint={page.rows[0] ? `${formatCount(page.rows[0].wonCount)} won` : undefined}
        />
      </div>

      <Card>
        <CardBody className="px-0">
          {page.rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No customer has a won, open or lost enquiry in this scope.
            </p>
          ) : (
            <DataTable
              columns={columns}
              rows={page.rows}
              rowKey={(row) => row.accountId}
              rowHref={(row) => `/accounts/${row.accountId}`}
              caption="Sales by customer"
            />
          )}
          <div className="px-4">
            <Pagination page={page} basePath="/reports/customers" searchParams={flat} />
          </div>
        </CardBody>
      </Card>

      <MetricNote>
        <strong>Won</strong> and <strong>Won Value</strong> cover enquiries closed in the selected
        period. <strong>Open</strong> and <strong>Pipeline Value</strong> are current, because
        &quot;still open&quot; has no meaning inside a past range. Totals shown above are for the
        rows on this page, not the whole customer base — page totals that silently claimed to be
        grand totals would be the easiest number here to misread. Archived customers are excluded.
      </MetricNote>
    </div>
  )
}
