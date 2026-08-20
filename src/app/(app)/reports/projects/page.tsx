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
import { formatCount } from '@/lib/metrics'
import { MOBILE_PAGE_SIZE, parsePageParams } from '@/lib/pagination'
import type { Period } from '@/lib/period'
import { getProjectSales, type ManagementScope, type ProjectSalesRow } from '@/services/analytics.service'

export const metadata: Metadata = { title: 'Project sales · JSK CRM' }

/**
 * Project sales (§15, §16 report 9).
 *
 * **ONE PROJECT HAS MANY OPPORTUNITIES** (§4.3) — an apartment block may buy
 * tiles, then granite, then sanitaryware, each as its own enquiry. §15 is
 * explicit: do not accidentally aggregate a project as one sale. The
 * `Enquiries` column is on every row for exactly that reason, and every row
 * opens the project rather than a single deal.
 */
export default async function ProjectSalesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flat, period, scope } = managementParams(await searchParams)

  return (
    <ReportShell
      title="Project sales"
      description="What has been won on each project, and what is still open"
      period={period}
      filters={
        <Suspense fallback={<SkeletonRows rows={1} />}>
          <ManagementFilters period={period} exportDataset="project-sales" />
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
  const page = await getProjectSales(period, scope, parsePageParams(flat, MOBILE_PAGE_SIZE))

  const columns: Column<ProjectSalesRow>[] = [
    { key: 'name', header: 'Project', cell: (row) => row.projectName },
    { key: 'customer', header: 'Customer', cell: (row) => row.accountName ?? '—', secondary: true },
    // The count that stops a project reading as one sale.
    {
      key: 'enquiries',
      header: 'Enquiries',
      cell: (row) => formatCount(row.opportunityCount),
      numeric: true,
    },
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
  ]

  const wonTotal = page.rows.reduce((sum, row) => sum + row.wonValuePaise, 0)
  const enquiryTotal = page.rows.reduce((sum, row) => sum + row.opportunityCount, 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Projects" count={page.total} emphasis />
        <MetricTile label="Enquiries on this page" count={enquiryTotal} />
        <MetricTile label="Won Value on this page" paise={wonTotal} emphasis />
        <MetricTile
          label="Top project"
          value={page.rows[0]?.projectName ?? '—'}
          hint={page.rows[0] ? `${formatCount(page.rows[0].opportunityCount)} enquiries` : undefined}
        />
      </div>

      <Card>
        <CardBody className="px-0">
          {page.rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No project has an enquiry in this scope.
            </p>
          ) : (
            <DataTable
              columns={columns}
              rows={page.rows}
              rowKey={(row) => row.projectId}
              rowHref={(row) => `/projects/${row.projectId}`}
              caption="Sales by project"
            />
          )}
          <div className="px-4">
            <Pagination page={page} basePath="/reports/projects" searchParams={flat} />
          </div>
        </CardBody>
      </Card>

      <MetricNote>
        A project holds <strong>many enquiries</strong> — tiles, then granite, then sanitaryware are
        three enquiries on one site, and each is won or lost on its own. The Enquiries column is the
        count of them, so a row is never mistaken for a single sale. Won figures cover the selected
        period; open figures are current. Archived projects are excluded.
      </MetricNote>
    </div>
  )
}
