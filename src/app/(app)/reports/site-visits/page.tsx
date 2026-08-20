import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { Pagination } from '@/components/shared/pagination'
import { SkeletonRows } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody } from '@/components/ui/card'
import { ManagementFilters } from '@/features/management/filters'
import { MetricTile } from '@/features/management/metric-tile'
import { managementParams } from '@/features/management/params'
import { MetricNote, ReportShell } from '@/features/management/report-shell'
import { formatDateTime } from '@/lib/dates'
import { ACTIVITY_OUTCOME_LABELS, ACTIVITY_PURPOSE_LABELS } from '@/lib/labels'
import { formatCount } from '@/lib/metrics'
import { MOBILE_PAGE_SIZE, parsePageParams } from '@/lib/pagination'
import type { Period } from '@/lib/period'
import { routes } from '@/lib/routes'
import { getSiteVisits, type ManagementScope, type SiteVisitRow } from '@/services/analytics.service'
import type { ActivityOutcome, ActivityPurpose } from '@/types/domain'

export const metadata: Metadata = { title: 'Site visits · JSK CRM' }

/**
 * Site visits (§13, §16 report 5).
 *
 * **There is no site-visits table and none is added.** A site visit is an
 * activity whose type is `SITE_VISIT` (§5.8), and this report is a filtered view
 * of `activities`. The branch a visit belongs to comes from the customer it was
 * logged against, because an activity has no branch of its own.
 */
export default async function SiteVisitsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flat, period, scope } = managementParams(await searchParams)

  return (
    <ReportShell
      title="Site visits"
      description="Every site visit logged, by salesperson, branch and project"
      period={period}
      filters={
        <Suspense fallback={<SkeletonRows rows={1} />}>
          <ManagementFilters period={period} exportDataset="site-visits" />
        </Suspense>
      }
    >
      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={8} />}>
        <Body period={period} scope={scope} flat={flat} />
      </Suspense>
    </ReportShell>
  )
}

const OUTCOME_TONE: Record<ActivityOutcome, 'won' | 'muted' | 'overdue' | 'at-risk'> = {
  POSITIVE: 'won',
  NEUTRAL: 'muted',
  NEGATIVE: 'overdue',
  NO_RESPONSE: 'at-risk',
  RESCHEDULED: 'at-risk',
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
  const page = await getSiteVisits(
    period,
    { ...scope, projectId: flat.project?.trim() || null },
    parsePageParams(flat, MOBILE_PAGE_SIZE),
  )

  const people = new Set(page.rows.map((row) => row.performedBy))
  const projects = new Set(page.rows.map((row) => row.projectId).filter(Boolean))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Site visits" count={page.total} emphasis />
        <MetricTile label="Salespeople on this page" count={people.size} />
        <MetricTile label="Projects on this page" count={projects.size} />
        <MetricTile
          label="Period"
          value={period.label}
          hint={`${page.rows.length} shown of ${formatCount(page.total)}`}
        />
      </div>

      <Card>
        <CardBody>
          {page.rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No site visits were logged in this period for this scope.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {page.rows.map((visit) => (
                <VisitRow key={visit.id} visit={visit} />
              ))}
            </ul>
          )}
          <Pagination page={page} basePath="/reports/site-visits" searchParams={flat} />
        </CardBody>
      </Card>

      <MetricNote>
        A site visit is an activity logged with type <strong>Site visit</strong>. The branch shown
        is the customer&apos;s branch, since an activity carries no branch of its own. Measurements
        and location notes are shown where the salesperson recorded them. Filter by period, branch,
        salesperson or project; the export gives you the filtered list.
      </MetricNote>
    </div>
  )
}

function VisitRow({ visit }: { visit: SiteVisitRow }) {
  return (
    <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={routes.account(visit.accountId)} className="font-medium hover:underline">
            {visit.accountName}
          </Link>
          <p className="text-xs text-muted-foreground">
            {visit.projectName ? (
              <>
                <Link href={routes.project(visit.projectId as string)} className="hover:underline">
                  {visit.projectName}
                </Link>
                {' · '}
              </>
            ) : null}
            {visit.performedByName ?? 'Unknown'}
            {visit.outletName ? ` · ${visit.outletName}` : ''}
            {' · '}
            {formatDateTime(visit.occurredAt)}
          </p>
        </div>
        <Badge tone={OUTCOME_TONE[visit.outcome as ActivityOutcome] ?? 'muted'}>
          {ACTIVITY_OUTCOME_LABELS[visit.outcome as ActivityOutcome] ?? visit.outcome}
        </Badge>
      </div>

      <p className="text-sm">{visit.summary}</p>

      {visit.measurements || visit.locationNote ? (
        <p className="text-xs text-muted-foreground">
          {visit.measurements ? `Measurements: ${visit.measurements}` : ''}
          {visit.measurements && visit.locationNote ? ' · ' : ''}
          {visit.locationNote ?? ''}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {ACTIVITY_PURPOSE_LABELS[visit.purpose as ActivityPurpose] ?? visit.purpose}
        {visit.opportunityId ? (
          <>
            {' · '}
            <Link href={routes.opportunity(visit.opportunityId)} className="text-primary hover:underline">
              Open the enquiry
            </Link>
          </>
        ) : null}
      </p>
    </li>
  )
}
