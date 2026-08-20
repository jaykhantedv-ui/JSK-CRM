import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { SkeletonRows } from '@/components/shared/states'
import { buttonClass } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Column, DataTable } from '@/features/management/data-table'
import { MetricTile } from '@/features/management/metric-tile'
import { ScopeBar } from '@/features/management/scope-bar'
import { formatDate, relativeDays } from '@/lib/dates'
import { formatCount, formatPercent } from '@/lib/metrics'
import { isManagerOrAbove, isOwner } from '@/lib/permissions'
import { parsePeriod, type Period } from '@/lib/period'
import { toRoute } from '@/lib/routes'
import type { TeamMemberWorkload } from '@/services/analytics.service'
import { requireUser } from '@/services/auth.service'
import { listOutlets } from '@/services/outlet.service'
import { getTeamOverview } from '@/services/team.service'
import type { SessionUser } from '@/types/domain'

export const metadata: Metadata = { title: 'Team · JSK CRM' }

/**
 * `/team` (§12.2, Master Phase 3 §8).
 *
 * **A workload surface, not an HR one.** No attendance, no commission, no
 * ratings — §8 says so and §2.3 puts commission outside Version 1 entirely.
 * Everything here answers one of two questions: who is carrying too much, and
 * what is slipping.
 *
 * The list is bounded by `scoped_outlet_ids()` in the database, so a manager sees
 * their branches' salespeople and an owner sees everybody. Nothing on this page
 * widens that, and typing another branch's id into `?outlet=` narrows to nothing.
 */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireUser()
  if (!isManagerOrAbove(user)) {
    redirect(user.role === 'ADMIN' ? '/settings' : '/today')
  }

  const params = await searchParams
  const flat = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  ) as Record<string, string | undefined>

  const period = parsePeriod(flat)

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Team</h1>
          <p className="text-sm text-muted-foreground">
            {period.label} · {formatDate(period.fromDate)} to {formatDate(period.toDate)}
          </p>
        </div>
        <Link href="/dashboard" className={buttonClass('outline', 'sm')}>
          Dashboard
        </Link>
      </header>

      <Suspense fallback={<SkeletonRows rows={1} />}>
        <Filters user={user} />
      </Suspense>

      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={6} />}>
        <TeamList period={period} flat={flat} />
      </Suspense>
    </div>
  )
}

async function Filters({ user }: { user: SessionUser }) {
  const outlets = await listOutlets()
  const mine = isOwner(user)
    ? outlets
    : outlets.filter((outlet) => user.outletIds.includes(outlet.id))

  return (
    <ScopeBar
      outlets={mine.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
      exportDataset="team"
    />
  )
}

async function TeamList({
  period,
  flat,
}: {
  period: Period
  flat: Record<string, string | undefined>
}) {
  const overview = await getTeamOverview(period, { outletId: flat.outlet?.trim() || null })
  const query = linkQuery(flat)

  if (overview.members.length === 0) {
    return (
      <Card>
        <CardBody className="py-10 text-center text-sm text-muted-foreground">
          No salespeople are assigned to the branches you manage. Assign someone at Settings, or
          ask the owner to.
        </CardBody>
      </Card>
    )
  }

  const columns: Column<TeamMemberWorkload>[] = [
    { key: 'name', header: 'Salesperson', cell: (row) => row.fullName },
    { key: 'active', header: 'Open', cell: (row) => formatCount(row.activeCount), numeric: true },
    {
      key: 'pipeline',
      header: 'Pipeline Value',
      cell: (row) => <MoneyText paise={row.pipelineValuePaise} compact />,
      numeric: true,
    },
    {
      key: 'won',
      header: 'Won Value',
      cell: (row) => <MoneyText paise={row.wonValuePaise} compact />,
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
      cell: (row) => (
        <span className={row.missingNextActionCount > 0 ? 'font-medium text-state-at-risk' : ''}>
          {formatCount(row.missingNextActionCount)}
        </span>
      ),
      numeric: true,
    },
    {
      key: 'today',
      header: 'Due today',
      cell: (row) => formatCount(row.dueTodayCount),
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
      key: 'conversion',
      header: 'Quote → order',
      cell: (row) => formatPercent(row.quoteConversionPercent),
      numeric: true,
      secondary: true,
    },
    {
      key: 'recent',
      header: 'Last activity',
      cell: (row) =>
        row.lastActivityAt ? (
          relativeDays(row.lastActivityAt)
        ) : (
          // "Nothing logged" is a finding, not a blank. It is exactly the person a
          // manager should open next.
          <span className="text-state-at-risk">nothing logged</span>
        ),
      secondary: true,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Open enquiries" count={overview.totals.activeCount} />
        <MetricTile label="Pipeline Value" paise={overview.totals.pipelineValuePaise} />
        <MetricTile
          label="Overdue follow-ups"
          count={overview.totals.overdueCount}
          tone={overview.totals.overdueCount > 0 ? 'alert' : 'default'}
          href="/opportunities?overdue=1"
        />
        <MetricTile
          label="Missing next action"
          count={overview.totals.missingNextActionCount}
          tone={overview.totals.missingNextActionCount > 0 ? 'warn' : 'default'}
          href="/opportunities?missing=1"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workload</CardTitle>
          <span className="text-xs text-muted-foreground">
            {overview.members.length} {overview.members.length === 1 ? 'person' : 'people'}
          </span>
        </CardHeader>
        <CardBody className="px-0">
          <DataTable
            columns={columns}
            rows={overview.members}
            rowKey={(row) => row.userId}
            rowHref={(row) => `/team/${row.userId}${query}`}
            caption="Workload by salesperson"
            footer={
              <tr>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCount(overview.totals.activeCount)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <MoneyText paise={overview.totals.pipelineValuePaise} compact />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <MoneyText paise={overview.totals.wonValuePaise} compact />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCount(overview.totals.overdueCount)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCount(overview.totals.missingNextActionCount)}
                </td>
                <td className="hidden px-3 py-2 sm:table-cell" />
                <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                  {formatCount(overview.totals.siteVisitCount)}
                </td>
                <td className="hidden px-3 py-2 sm:table-cell" />
                <td className="hidden px-3 py-2 sm:table-cell" />
              </tr>
            }
          />
        </CardBody>
      </Card>

      <p className="text-xs text-muted-foreground">
        Reassigning work is done from the enquiry itself.{' '}
        <Link href={toRoute('/opportunities?unassigned=1')} className="text-primary hover:underline">
          Unassigned enquiries
        </Link>
      </p>
    </div>
  )
}

function linkQuery(flat: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const key of ['period', 'from', 'to', 'outlet']) {
    const value = flat[key]
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}
