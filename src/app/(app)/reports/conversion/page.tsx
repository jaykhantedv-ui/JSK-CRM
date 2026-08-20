import type { Metadata } from 'next'
import { Suspense } from 'react'

import { SkeletonTiles } from '@/components/shared/states'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { ProportionBar } from '@/features/management/charts'
import { ManagementFilters } from '@/features/management/filters'
import { MetricTile } from '@/features/management/metric-tile'
import { managementParams } from '@/features/management/params'
import { MetricNote, ReportShell } from '@/features/management/report-shell'
import { formatCount, formatDays, formatPercent, sharePercent } from '@/lib/metrics'
import type { Period } from '@/lib/period'
import {
  getQuotationTurnaround,
  getQuoteConversion,
  type ManagementScope,
} from '@/services/analytics.service'

export const metadata: Metadata = { title: 'Quote to order · JSK CRM' }

/**
 * Quote-to-order conversion and quotation turnaround (§11, §12, §16 report 6).
 *
 * Both metrics read the audit trail that already exists. **Neither invents a
 * quotation table, a quotation workflow or a new event type** — §11 and §12 are
 * explicit about that, and `opportunity_events` already records every stage a
 * record passed through.
 */
export default async function ConversionReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flat, period, scope, query } = managementParams(await searchParams)

  return (
    <ReportShell
      title="Quote to order"
      description="How many quotations convert, and how quickly they go out"
      period={period}
      filters={
        <Suspense fallback={<SkeletonTiles tiles={1} />}>
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
  const [conversion, turnaround] = await Promise.all([
    getQuoteConversion(period, scope),
    getQuotationTurnaround(period, scope),
  ])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Quote to order"
          percent={conversion.conversionPercent}
          hint={`${formatCount(conversion.wonAfterQuoteCount)} of ${formatCount(conversion.reachedQuotedCount)} quoted`}
          emphasis
        />
        <MetricTile
          label="Won after quoting"
          paise={conversion.wonAfterQuoteValuePaise}
          hint={`${formatCount(conversion.wonAfterQuoteCount)} enquiries`}
          emphasis
        />
        <MetricTile
          label="Lost after quoting"
          count={conversion.lostAfterQuoteCount}
          tone={conversion.lostAfterQuoteCount > 0 ? 'alert' : 'default'}
          href={`/reports/lost-reasons${query}`}
        />
        <MetricTile
          label="Reached quotation"
          count={conversion.reachedQuotedCount}
          hint="Closed in this period"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What happened to quoted enquiries</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span>Converted to an order</span>
            <span className="text-xs text-muted-foreground">
              {formatCount(conversion.wonAfterQuoteCount)} ·{' '}
              {formatPercent(conversion.conversionPercent, 1)}
            </span>
          </div>
          <ProportionBar
            percent={conversion.conversionPercent}
            tone="won"
            label={`Converted: ${formatPercent(conversion.conversionPercent)} of quoted enquiries`}
          />
          <div className="mt-2 flex items-baseline justify-between gap-2 text-sm">
            <span>Lost after a quotation</span>
            <span className="text-xs text-muted-foreground">
              {formatCount(conversion.lostAfterQuoteCount)} ·{' '}
              {formatPercent(
                sharePercent(conversion.lostAfterQuoteCount, conversion.reachedQuotedCount),
                1,
              )}
            </span>
          </div>
          <ProportionBar
            percent={sharePercent(conversion.lostAfterQuoteCount, conversion.reachedQuotedCount)}
            tone="overdue"
            label="Lost after quoting, as a share of quoted enquiries"
          />

          {conversion.neverQuotedWonCount > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {formatCount(conversion.neverQuotedWonCount)} enquir
              {conversion.neverQuotedWonCount === 1 ? 'y was' : 'ies were'} won without ever passing
              through the quoted stage, and{' '}
              {conversion.neverQuotedWonCount === 1 ? 'is' : 'are'} not counted above. That is
              usually a recording gap rather than a sale without a quotation.
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* §12 — turnaround, with its own limitation reported beside it. */}
      <Card>
        <CardHeader>
          <CardTitle>Quotation turnaround</CardTitle>
        </CardHeader>
        <CardBody>
          {turnaround.measuredCount === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No quotation in this period has a recorded qualification date to measure from.
              {turnaround.excludedCount > 0
                ? ` ${formatCount(turnaround.excludedCount)} quotation${turnaround.excludedCount === 1 ? '' : 's'} went out but cannot be measured.`
                : ''}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricTile label="Average" value={formatDays(turnaround.averageDays)} />
              <MetricTile label="Median" value={formatDays(turnaround.medianDays)} />
              <MetricTile
                label="Slowest"
                value={formatDays(turnaround.slowestDays)}
                tone={(turnaround.slowestDays ?? 0) > 7 ? 'warn' : 'default'}
              />
              <MetricTile
                label="Within two days"
                percent={sharePercent(turnaround.withinTwoDaysCount, turnaround.measuredCount)}
                hint={`${formatCount(turnaround.withinTwoDaysCount)} of ${formatCount(turnaround.measuredCount)}`}
                tone="good"
              />
            </div>
          )}

          {turnaround.excludedCount > 0 && turnaround.measuredCount > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {formatCount(turnaround.excludedCount)} quotation
              {turnaround.excludedCount === 1 ? '' : 's'} in this period could not be measured, because
              the enquiry has no recorded move into <em>Qualified</em> — imported history, or an
              enquiry created directly at a later stage. Those are excluded rather than estimated.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <MetricNote>
        <strong>Quote to order</strong> is won enquiries that had reached the quoted stage, divided
        by every enquiry that reached quoted and then closed in this period. Whether an enquiry ever
        reached quoted comes from its stage history, not its current stage, so a deal now in
        negotiation still counts as quoted. Still-open work is not in the denominator — a quotation
        under discussion is not a failure to convert.{' '}
        <strong>Turnaround</strong> is calendar days from the first move into <em>Qualified</em> to
        the first move into <em>Quoted</em>, measured in Asia/Kolkata. When nothing qualifies, both
        show an em dash rather than zero.
      </MetricNote>
    </div>
  )
}
