import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { SkeletonTiles } from '@/components/shared/states'
import { buttonClass } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { AtRiskList, PreviewFooter } from '@/features/management/at-risk-list'
import { ProportionBar, TrendLine } from '@/features/management/charts'
import { Column, DataTable } from '@/features/management/data-table'
import { ExceptionRow, MetricTile } from '@/features/management/metric-tile'
import { ScopeBar } from '@/features/management/scope-bar'
import { formatDate } from '@/lib/dates'
import { LOST_REASON_LABELS, STAGE_LABELS } from '@/lib/labels'
import { formatCount, formatDays, formatPercent } from '@/lib/metrics'
import { isManagerOrAbove, isOwner } from '@/lib/permissions'
import { parsePeriod, type Period } from '@/lib/period'
import { toRoute } from '@/lib/routes'
import { requireUser } from '@/services/auth.service'
import type { ManagementScope, OutletComparisonRow, TeamMemberWorkload } from '@/services/analytics.service'
import {
  DASHBOARD_AT_RISK_PREVIEW,
  OWNER_OVERDUE_ALERT_THRESHOLD,
  OWNER_TOP_LOST_REASONS,
  getManagerDashboard,
  getOwnerDashboard,
  type ManagerDashboard,
  type OwnerDashboard,
} from '@/services/dashboard.service'
import { listOutlets } from '@/services/outlet.service'
import type { OpportunityStage, SessionUser } from '@/types/domain'

export const metadata: Metadata = { title: 'Dashboard · JSK CRM' }

/**
 * `/dashboard` — the management screen (§13.3 for MANAGER, §13.4 for OWNER).
 *
 * **Exception → explanation → action** (§21). Every count on this page links to
 * the list it counts, and every list leads to a record where something can be
 * done. There are no dead-end charts here: the one visual, the owner's trend
 * line, sits beside the figures it draws.
 *
 * Scope is not a decision this page makes. A MANAGER's numbers cover the branches
 * they manage and an OWNER's cover the company, because `scoped_outlet_ids()` and
 * the RLS policies say so (§15, ADR-016). The branch dropdown narrows within that;
 * it cannot widen it.
 *
 * ADMIN is redirected rather than shown empty tiles. ADR-017 — system
 * administration carries no business-data visibility — and empty tiles would
 * suggest the data was merely missing.
 */
export default async function DashboardPage({
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
  const scope: ManagementScope = {
    outletId: flat.outlet?.trim() || null,
    ownerId: flat.owner?.trim() || null,
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {isOwner(user) ? 'Business' : 'Branch'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {period.label} · {formatDate(period.fromDate)} to {formatDate(period.toDate)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/team" className={buttonClass('outline', 'sm')}>
            Team
          </Link>
          <Link href="/reports" className={buttonClass('outline', 'sm')}>
            Reports
          </Link>
          <Link href="/today" className={buttonClass('outline', 'sm')}>
            My day
          </Link>
        </div>
      </header>

      <Suspense fallback={<SkeletonTiles tiles={4} />}>
        <Filters user={user} />
      </Suspense>

      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonTiles tiles={8} />}>
        {isOwner(user) ? (
          <OwnerView period={period} scope={scope} flat={flat} />
        ) : (
          <ManagerView period={period} scope={scope} flat={flat} />
        )}
      </Suspense>
    </div>
  )
}

/**
 * The branch selector lists only branches the caller manages.
 *
 * For a manager that is `user.outletIds`; for an owner it is every active
 * branch. Listing branches a manager cannot see would offer a filter that
 * returns nothing and read as a bug.
 */
async function Filters({ user }: { user: SessionUser }) {
  const outlets = await listOutlets()
  const mine = isOwner(user)
    ? outlets
    : outlets.filter((outlet) => user.outletIds.includes(outlet.id))

  return (
    <ScopeBar
      outlets={mine.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
      exportDataset="pipeline"
    />
  )
}

// ------------------------------------------------------------- manager ----

async function ManagerView({
  period,
  scope,
  flat,
}: {
  period: Period
  scope: ManagementScope
  flat: Record<string, string | undefined>
}) {
  const data = await getManagerDashboard(period, scope)
  const query = linkQuery(flat)

  return (
    <div className="flex flex-col gap-4">
      <HeadlineTiles data={data} query={query} />

      {/* §13.3 Panel A — the daily review, and the most prominent block on the
          page. The business's single biggest problem is missed follow-ups (§1). */}
      <Card>
        <CardHeader>
          <CardTitle>Needs attention today</CardTitle>
          {data.exceptions.overdueValuePaise > 0 ? (
            <span className="text-xs text-muted-foreground">
              <MoneyText paise={data.exceptions.overdueValuePaise} compact /> overdue
            </span>
          ) : null}
        </CardHeader>
        <CardBody>
          <ExceptionRow items={exceptionItems(data, query)} />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>At risk</CardTitle>
            <Link href={toRoute(`/reports/at-risk${query}`)} className="text-xs font-medium text-primary hover:underline">
              All at-risk
            </Link>
          </CardHeader>
          <CardBody>
            <AtRiskList rows={data.atRisk.rows} />
            <PreviewFooter
              shown={Math.min(DASHBOARD_AT_RISK_PREVIEW, data.atRisk.rows.length)}
              total={data.atRisk.total}
              href={`/reports/at-risk${query}`}
              label="See every at-risk enquiry"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline by stage</CardTitle>
          </CardHeader>
          <CardBody>
            <StageList byStage={data.pipeline.byStage} total={data.pipeline.pipelineValuePaise} query={query} />
          </CardBody>
        </Card>
      </div>

      {/* §13.3 Panel B — team workload. */}
      <Card>
        <CardHeader>
          <CardTitle>Team workload</CardTitle>
          <Link href={toRoute(`/team${query}`)} className="text-xs font-medium text-primary hover:underline">
            Open team
          </Link>
        </CardHeader>
        <CardBody className="px-0">
          <TeamTable members={data.team} query={query} />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Why we are losing</CardTitle>
            <Link href={toRoute(`/reports/lost-reasons${query}`)} className="text-xs font-medium text-primary hover:underline">
              Full analysis
            </Link>
          </CardHeader>
          <CardBody>
            <LostReasonBars analysis={data.lostReasons} query={query} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quotations</CardTitle>
            <Link href={toRoute(`/reports/conversion${query}`)} className="text-xs font-medium text-primary hover:underline">
              Conversion report
            </Link>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <MetricTile
                label="Quote to order"
                percent={data.conversion.conversionPercent}
                hint={`${formatCount(data.conversion.wonAfterQuoteCount)} of ${formatCount(data.conversion.reachedQuotedCount)} quoted`}
              />
              <MetricTile
                label="Quotation turnaround"
                value={formatDays(data.turnaround.averageDays)}
                hint={turnaroundHint(data.turnaround)}
              />
            </div>
            {data.exceptions.quotationExpired > 0 ? (
              <Link
                href={toRoute(`/reports/at-risk${query}`)}
                className="text-xs font-medium text-state-at-risk hover:underline"
              >
                {formatCount(data.exceptions.quotationExpired)} quotation
                {data.exceptions.quotationExpired === 1 ? '' : 's'} past validity
              </Link>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {data.outlets.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Branches</CardTitle>
            <Link href={toRoute(`/reports/outlets${query}`)} className="text-xs font-medium text-primary hover:underline">
              Compare
            </Link>
          </CardHeader>
          <CardBody className="px-0">
            <OutletTable rows={data.outlets} query={query} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}

// --------------------------------------------------------------- owner ----

/**
 * §13.4 — **deliberately small. Do not add tiles.**
 *
 * The specification says so in those words. Every block below answers a question
 * an owner actually asks: are we hitting the number, what is coming, which branch
 * is behind, who needs help, and where is the money going.
 */
async function OwnerView({
  period,
  scope,
  flat,
}: {
  period: Period
  scope: ManagementScope
  flat: Record<string, string | undefined>
}) {
  const data = await getOwnerDashboard(period, scope)
  const query = linkQuery(flat)

  // §13.4 — "any salesperson with more than ten overdue" is a line worth an
  // owner's attention; a full leaderboard is not.
  const strugglers = data.team.filter(
    (member) => member.overdueCount > OWNER_OVERDUE_ALERT_THRESHOLD,
  )

  return (
    <div className="flex flex-col gap-4">
      <HeadlineTiles data={data} query={query} />

      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <ExceptionRow items={exceptionItems(data, query).slice(0, 4)} />
          {strugglers.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {strugglers.map((member) => (
                <li key={member.userId}>
                  <Link
                    href={toRoute(`/team/${member.userId}${query}`)}
                    className="text-state-overdue hover:underline"
                  >
                    {member.fullName} has {formatCount(member.overdueCount)} overdue follow-ups
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Won Value by month</CardTitle>
          <span className="text-xs text-muted-foreground">Last 12 months</span>
        </CardHeader>
        <CardBody>
          <TrendLine
            points={data.trend.map((point) => ({
              label: monthLabel(point.monthStart),
              valuePaise: point.wonValuePaise,
            }))}
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Branches</CardTitle>
            <Link href={toRoute(`/reports/outlets${query}`)} className="text-xs font-medium text-primary hover:underline">
              Compare
            </Link>
          </CardHeader>
          <CardBody className="px-0">
            <OutletTable rows={data.outlets} query={query} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top lost reasons</CardTitle>
            <Link href={toRoute(`/reports/lost-reasons${query}`)} className="text-xs font-medium text-primary hover:underline">
              Full analysis
            </Link>
          </CardHeader>
          <CardBody>
            <LostReasonBars
              analysis={{
                ...data.lostReasons,
                rows: data.lostReasons.rows.slice(0, OWNER_TOP_LOST_REASONS),
              }}
              query={query}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Salespeople</CardTitle>
          <Link href={toRoute(`/team${query}`)} className="text-xs font-medium text-primary hover:underline">
            Open team
          </Link>
        </CardHeader>
        <CardBody className="px-0">
          <TeamTable members={data.team} query={query} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>At-risk pipeline</CardTitle>
          <Link href={toRoute(`/reports/at-risk${query}`)} className="text-xs font-medium text-primary hover:underline">
            All at-risk
          </Link>
        </CardHeader>
        <CardBody>
          <AtRiskList rows={data.atRisk.rows} />
          <PreviewFooter
            shown={Math.min(DASHBOARD_AT_RISK_PREVIEW, data.atRisk.rows.length)}
            total={data.atRisk.total}
            href={`/reports/at-risk${query}`}
            label="See every at-risk enquiry"
          />
        </CardBody>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------- shared bits ----

/**
 * The headline row, shared by both dashboards.
 *
 * §2.4 — **the word "Revenue" appears nowhere.** Won Value, Pipeline Value,
 * Weighted Pipeline.
 */
function HeadlineTiles({
  data,
  query,
}: {
  data: ManagerDashboard | OwnerDashboard
  query: string
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricTile
        label="Won Value"
        paise={data.summary.wonValuePaise}
        hint={targetHint(data.target)}
        tone={data.target.isMet ? 'good' : 'default'}
        emphasis
      />
      <MetricTile
        label="Pipeline Value"
        paise={data.pipeline.pipelineValuePaise}
        hint={`${formatCount(data.pipeline.activeCount)} open`}
        href={`/opportunities${query}`}
        emphasis
      />
      <MetricTile
        label="Weighted Pipeline"
        paise={data.pipeline.weightedPipelinePaise}
        hint="By stage probability"
      />
      <MetricTile
        label="New enquiries"
        count={data.summary.newEnquiryCount}
        hint={`Win rate ${formatPercent(data.summary.winRatePercent)}`}
        href={`/opportunities${query}`}
      />
    </div>
  )
}

/**
 * Progress against target, as a hint under Won Value.
 *
 * "No target set" and "0% of target" are different statements, and a business
 * that has not set a target must not be told it is failing to meet one (§10).
 */
function targetHint(target: ManagerDashboard['target']): string {
  if (target.targetPaise === null) return 'No target set'
  if (target.isMet) return `Target met · ${formatPercent(target.achievementPercent)}`
  return `${formatPercent(target.achievementPercent)} of target`
}

function turnaroundHint(turnaround: ManagerDashboard['turnaround']): string {
  if (turnaround.measuredCount === 0) return 'No quotations to measure'
  const base = `${formatCount(turnaround.measuredCount)} measured`
  // The excluded count is shown, always. An average that silently covers half the
  // data is worse than no average (§12).
  return turnaround.excludedCount > 0
    ? `${base} · ${formatCount(turnaround.excludedCount)} unmeasurable`
    : base
}

function exceptionItems(
  data: ManagerDashboard | OwnerDashboard,
  query: string,
): { label: string; count: number; href: string }[] {
  return [
    { label: 'Overdue follow-ups', count: data.exceptions.overdue, href: `/opportunities?overdue=1` },
    { label: 'Missing next action', count: data.exceptions.missingNextAction, href: `/opportunities?missing=1` },
    { label: 'Unassigned', count: data.exceptions.unassigned, href: `/opportunities?unassigned=1` },
    { label: 'High value at risk', count: data.exceptions.highValueAtRisk, href: `/reports/at-risk${query}` },
    { label: 'Stalled', count: data.exceptions.stalled, href: `/reports/at-risk${query}` },
    { label: 'No recent activity', count: data.exceptions.dormant, href: `/reports/at-risk${query}` },
    { label: 'New enquiries past SLA', count: data.exceptions.slaBreach, href: `/opportunities?stage=new` },
    { label: 'Quotations expired', count: data.exceptions.quotationExpired, href: `/reports/conversion${query}` },
  ]
}

function StageList({
  byStage,
  total,
  query,
}: {
  byStage: ManagerDashboard['pipeline']['byStage']
  total: number
  query: string
}) {
  if (byStage.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No open enquiries.</p>
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-border">
        {byStage.map((row) => (
          <li key={row.stage}>
            <Link
              href={toRoute(`/opportunities?stage=${row.stage}`)}
              className="flex items-center justify-between gap-3 py-2 hover:underline"
            >
              <span className="text-sm">{STAGE_LABELS[row.stage as OpportunityStage]}</span>
              <span className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">{formatCount(row.count)}</span>
                <MoneyText paise={row.valuePaise} compact className="text-sm font-medium" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Nurture is listed but excluded from Pipeline Value (<MoneyText paise={total} compact />),
        which counts active stages only. <Link href={toRoute(`/reports/pipeline${query}`)} className="text-primary hover:underline">Pipeline report</Link>
      </p>
    </>
  )
}

function TeamTable({ members, query }: { members: TeamMemberWorkload[]; query: string }) {
  if (members.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        No salespeople are assigned to the branches you manage.
      </p>
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
      key: 'won',
      header: 'Won Value',
      cell: (row) => <MoneyText paise={row.wonValuePaise} compact />,
      numeric: true,
    },
    {
      key: 'winrate',
      header: 'Win rate',
      cell: (row) => formatPercent(row.winRatePercent),
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
  ]

  return (
    <DataTable
      columns={columns}
      rows={members}
      rowKey={(row) => row.userId}
      rowHref={(row) => `/team/${row.userId}${query}`}
      caption="Workload by salesperson"
    />
  )
}

function OutletTable({ rows, query }: { rows: OutletComparisonRow[]; query: string }) {
  const columns: Column<OutletComparisonRow>[] = [
    { key: 'name', header: 'Branch', cell: (row) => row.name },
    { key: 'enquiries', header: 'Enquiries', cell: (row) => formatCount(row.newEnquiryCount), numeric: true },
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
    { key: 'winrate', header: 'Win rate', cell: (row) => formatPercent(row.winRatePercent), numeric: true },
    {
      key: 'overdue',
      header: 'Overdue',
      cell: (row) => (
        <span className={row.overdueCount > 0 ? 'font-medium text-state-overdue' : ''}>
          {formatCount(row.overdueCount)}
        </span>
      ),
      numeric: true,
      secondary: true,
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.outletId}
      rowHref={(row) => withParam(query, 'outlet', row.outletId, '/dashboard')}
      caption="Comparison by branch"
    />
  )
}

function LostReasonBars({
  analysis,
  query,
}: {
  analysis: ManagerDashboard['lostReasons']
  query: string
}) {
  if (analysis.rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nothing was lost in this period.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {analysis.rows.map((row) => (
        <li key={row.reason} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <Link
              href={toRoute(withParam(query, 'reason', row.reason, '/reports/lost-reasons'))}
              className="truncate hover:underline"
            >
              {LOST_REASON_LABELS[row.reason]}
            </Link>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatCount(row.count)} · <MoneyText paise={row.valuePaise} compact />
            </span>
          </div>
          <ProportionBar
            percent={row.countSharePercent}
            tone="overdue"
            label={`${LOST_REASON_LABELS[row.reason]}: ${formatPercent(row.countSharePercent)} of losses`}
          />
        </li>
      ))}
    </ul>
  )
}

// ------------------------------------------------------------- helpers ----

/** The current period and scope as a query string, so a drill-down keeps them. */
function linkQuery(flat: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const key of ['period', 'from', 'to', 'outlet', 'owner']) {
    const value = flat[key]
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

function withParam(query: string, key: string, value: string, path: string): string {
  const params = new URLSearchParams(query.replace(/^\?/, ''))
  params.set(key, value)
  return `${path}?${params.toString()}`
}

/** `Aug 26` — short enough for twelve of them on a phone. */
function monthLabel(monthStart: string): string {
  return formatDate(monthStart).slice(3).replace(/ 20/, ' ')
}
