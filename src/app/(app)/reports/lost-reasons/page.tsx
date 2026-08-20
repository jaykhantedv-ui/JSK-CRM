import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { Pagination } from '@/components/shared/pagination'
import { SkeletonRows } from '@/components/shared/states'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { ProportionBar } from '@/features/management/charts'
import { ManagementFilters } from '@/features/management/filters'
import { MetricTile } from '@/features/management/metric-tile'
import { managementParams } from '@/features/management/params'
import { MetricNote, ReportShell } from '@/features/management/report-shell'
import { formatDate } from '@/lib/dates'
import { LOST_REASON_LABELS } from '@/lib/labels'
import { formatCount, formatPercent } from '@/lib/metrics'
import { MOBILE_PAGE_SIZE, parsePageParams } from '@/lib/pagination'
import type { Period } from '@/lib/period'
import { routes, toRoute } from '@/lib/routes'
import { getLostReasonAnalysis, type ManagementScope } from '@/services/analytics.service'
import { listOpportunities } from '@/services/opportunity.service'
import { LOST_REASONS } from '@/services/opportunity.service'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { LostReason } from '@/types/domain'

export const metadata: Metadata = { title: 'Lost reasons · JSK CRM' }

/**
 * Lost-reason analysis (§14, §16 report 4).
 *
 * **Top-level reasons are the existing enum, and nothing else.** No ad-hoc
 * categories and no bucketing of free text: `lost_detail` stays on the record for
 * the drill-down to show, where it has context.
 *
 * Count share and value share are reported separately and deliberately. A reason
 * that is one loss in ten but a quarter of the value lost is the most important
 * line on the page, and a single percentage would hide it.
 */
export default async function LostReasonsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flat, period, scope, query } = managementParams(await searchParams)

  return (
    <ReportShell
      title="Lost reasons"
      description="Why enquiries were lost, by count and by value"
      period={period}
      filters={
        <Suspense fallback={<SkeletonRows rows={1} />}>
          <ManagementFilters period={period} exportDataset="lost-reasons" />
        </Suspense>
      }
    >
      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={5} />}>
        <Body period={period} scope={scope} query={query} flat={flat} />
      </Suspense>
    </ReportShell>
  )
}

async function Body({
  period,
  scope,
  query,
  flat,
}: {
  period: Period
  scope: ManagementScope
  query: string
  flat: Record<string, string | undefined>
}) {
  const analysis = await getLostReasonAnalysis(period, scope)
  const selected = (LOST_REASONS as readonly string[]).includes(flat.reason ?? '')
    ? (flat.reason as LostReason)
    : null

  if (analysis.rows.length === 0) {
    return (
      <Card>
        <CardBody className="py-10 text-center text-sm text-muted-foreground">
          Nothing was lost in this period.
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Enquiries lost" count={analysis.totalCount} tone="alert" emphasis />
        <MetricTile label="Value lost" paise={analysis.totalValuePaise} tone="alert" emphasis />
        <MetricTile label="Distinct reasons" count={analysis.rows.length} />
        <MetricTile
          label="Biggest reason"
          value={LOST_REASON_LABELS[analysis.rows[0].reason]}
          hint={`${formatCount(analysis.rows[0].count)} lost`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By reason</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="flex flex-col gap-3">
            {analysis.rows.map((row) => (
              <li key={row.reason} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={toRoute(reasonHref(query, row.reason))}
                    className="text-sm font-medium hover:underline"
                  >
                    {LOST_REASON_LABELS[row.reason]}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {formatCount(row.count)} lost ({formatPercent(row.countSharePercent, 1)}) ·{' '}
                    <MoneyText paise={row.valuePaise} compact /> (
                    {formatPercent(row.valueSharePercent, 1)} of value)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-[10px] text-muted-foreground">By count</span>
                  <ProportionBar
                    percent={row.countSharePercent}
                    tone="overdue"
                    label={`${LOST_REASON_LABELS[row.reason]}: ${formatPercent(row.countSharePercent)} of losses by count`}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-[10px] text-muted-foreground">By value</span>
                  <ProportionBar
                    percent={row.valueSharePercent}
                    tone="at-risk"
                    label={`${LOST_REASON_LABELS[row.reason]}: ${formatPercent(row.valueSharePercent)} of value lost`}
                  />
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {selected ? <LostDrilldown reason={selected} flat={flat} query={query} /> : null}

      <MetricNote>
        Reasons come from the fixed list a salesperson chooses from when marking an enquiry lost;
        there are no ad-hoc categories. <strong>Share by count</strong> and{' '}
        <strong>share by value</strong> are shown separately because they tell different stories —
        a reason that costs one deal in ten but a quarter of the value lost is the line worth acting
        on. Value is the estimated value of the lost enquiry. Pick a reason to see the enquiries
        behind it.
      </MetricNote>
    </div>
  )
}

/**
 * The drill-down (§14 — "include a drill-down to lost opportunities").
 *
 * Reads through `listOpportunities`, so the same filters, the same policies and
 * the same pagination as every other list. Nothing here is a bespoke query that
 * could disagree with the pipeline list about what a manager may see.
 */
async function LostDrilldown({
  reason,
  flat,
  query,
}: {
  reason: LostReason
  flat: Record<string, string | undefined>
  query: string
}) {
  // The reason is a filter on the QUERY, not a filter applied to the page after
  // it comes back. Paginating everything lost and then discarding the rows that
  // do not match would give a manager half-empty pages and a page count that
  // counts records they cannot see — so `lostReason` is a first-class filter on
  // `listOpportunities`, alongside stage and category.
  const page = await listOpportunities(
    {
      stage: 'lost',
      lostReason: reason,
      outletId: flat.outlet?.trim() || null,
      ownerId: flat.owner?.trim() || null,
      activeOnly: false,
    },
    parsePageParams(flat, MOBILE_PAGE_SIZE),
  )

  const rows = page.rows
  const names = await resolveAccountNames(rows.map((row) => row.account_id as string))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lost to {LOST_REASON_LABELS[reason]}</CardTitle>
        <Link href={toRoute(`/reports/lost-reasons${query}`)} className="text-xs text-primary hover:underline">
          Clear
        </Link>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing was lost to that reason in this period.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id as string} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <Link href={routes.opportunity(row.id as string)} className="font-medium hover:underline">
                    {row.title as string}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {names[row.account_id as string] ?? ''}
                    {row.closed_at ? ` · lost ${formatDate(row.closed_at as string)}` : ''}
                    {row.competitor ? ` · to ${row.competitor as string}` : ''}
                  </p>
                  {row.lost_detail ? (
                    <p className="text-xs text-muted-foreground">{row.lost_detail as string}</p>
                  ) : null}
                </div>
                <MoneyText paise={row.estimated_value} compact className="text-sm font-medium" />
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} basePath="/reports/lost-reasons" searchParams={flat} />
      </CardBody>
    </Card>
  )
}

async function resolveAccountNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return {}
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('accounts').select('id, name').in('id', unique)
  return Object.fromEntries((data ?? []).map((row) => [row.id, row.name]))
}

function reasonHref(query: string, reason: LostReason): string {
  const params = new URLSearchParams(query.replace(/^\?/, ''))
  params.set('reason', reason)
  return `/reports/lost-reasons?${params.toString()}`
}
