import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { SkeletonTiles } from '@/components/shared/states'
import { buttonClass } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { STAGE_LABELS } from '@/lib/labels'
import { toRoute } from '@/lib/routes'
import { isManagerOrAbove } from '@/lib/permissions'
import { requireUser } from '@/services/auth.service'
import { getPipelineOverview } from '@/services/dashboard.service'
import type { OpportunityStage } from '@/types/domain'

export const metadata: Metadata = { title: 'Dashboard · JSK CRM' }

/**
 * The manager landing screen — **basic pipeline visibility only**.
 *
 * Count and value by stage, plus the four exception counts that fall directly out
 * of the next-action model. Each exception links to the filtered pipeline list,
 * so the number is a way into the work rather than a number to admire.
 *
 * §13.3's team-workload and pipeline-health panels, §13.4's owner blocks, win
 * rate, lost-reason analysis and every chart belong to a later master phase. They
 * are **not stubbed here**: an unbuilt screen shows nothing rather than a mock
 * (CLAUDE.md §15).
 *
 * Everything below is computed from a real query, scoped by RLS to the outlets
 * this manager holds. An OWNER sees the whole company by role (ADR-016).
 */
export default async function DashboardPage() {
  const user = await requireUser()

  // ADMIN administers users, outlets and settings, and carries no business-data
  // visibility at all (ADR-017). Sending them to their own surface is honest;
  // rendering empty tiles would suggest the data was merely missing.
  if (!isManagerOrAbove(user)) {
    redirect(user.role === 'ADMIN' ? '/settings' : '/today')
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            {user.role === 'OWNER' ? 'Every branch.' : 'The branches you manage.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/opportunities/board" className={buttonClass('outline', 'sm', 'hidden lg:inline-flex')}>
            Board
          </Link>
          <Link href="/today" className={buttonClass('outline', 'sm')}>
            My day
          </Link>
        </div>
      </header>

      <Suspense fallback={<SkeletonTiles tiles={4} />}>
        <Overview />
      </Suspense>
    </div>
  )
}

async function Overview() {
  const overview = await getPipelineOverview()

  const exceptions = [
    { label: 'Unassigned', count: overview.exceptions.unassigned, href: '/opportunities?unassigned=1' },
    { label: 'Overdue', count: overview.exceptions.overdue, href: '/opportunities?overdue=1' },
    { label: 'Missing next action', count: overview.exceptions.missingNextAction, href: '/opportunities?missing=1' },
    { label: 'Dormant', count: overview.exceptions.dormant, href: '/opportunities' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardBody className="pt-3">
            <p className="text-xs text-muted-foreground">Pipeline Value</p>
            <MoneyText paise={overview.pipelineValuePaise} compact className="text-2xl font-semibold" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="pt-3">
            <p className="text-xs text-muted-foreground">Weighted Pipeline</p>
            <MoneyText paise={overview.weightedPipelinePaise} compact className="text-2xl font-semibold" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="pt-3">
            <p className="text-xs text-muted-foreground">Open enquiries</p>
            <p className="text-2xl font-semibold">{overview.activeCount}</p>
          </CardBody>
        </Card>
      </div>

      {/* The daily review. Every tile is a link into the work it counts. */}
      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="grid gap-2 sm:grid-cols-4">
            {exceptions.map((row) => (
              <li key={row.label}>
                <Link
                  href={toRoute(row.href)}
                  className="flex flex-col rounded-md border border-border p-3 hover:bg-accent"
                >
                  <span
                    className={
                      row.count > 0 ? 'text-xl font-semibold text-state-at-risk' : 'text-xl font-semibold'
                    }
                  >
                    {row.count}
                  </span>
                  <span className="text-xs text-muted-foreground">{row.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By stage</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="flex flex-col divide-y divide-border">
            {overview.byStage.map((row) => (
              <li key={row.stage}>
                <Link
                  href={toRoute(`/opportunities?stage=${row.stage}`)}
                  className="flex items-center justify-between gap-3 py-2.5 hover:underline"
                >
                  <span className="text-sm">{STAGE_LABELS[row.stage as OpportunityStage]}</span>
                  <span className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">{row.count}</span>
                    <MoneyText paise={row.valuePaise} compact className="text-sm font-medium" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Nurture is shown here but excluded from Pipeline Value, which counts active stages only.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
