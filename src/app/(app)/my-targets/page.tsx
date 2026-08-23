import type { Metadata } from 'next'

import { MoneyText } from '@/components/shared/money-text'
import { EmptyState } from '@/components/shared/states'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { formatPercent, targetProgress } from '@/lib/metrics'
import { parsePeriod } from '@/lib/period'
import { requireUser } from '@/services/auth.service'
import { getSalespersonDashboard } from '@/services/dashboard.service'
import { listMyTargets, sumTargets } from '@/services/target.service'

export const metadata: Metadata = { title: 'My Targets · JSK CRM' }

/**
 * `/my-targets` — one person's target and their own progress against it
 * (ADR-040).
 *
 * **The only target a salesperson can read is the one set for them.** The branch
 * figure and the company figure are management planning data and stay that way
 * (ADR-021); `sales_targets_select` grants exactly `user_id =
 * current_user_id()`, so this page cannot show more than it should even if it
 * tried.
 *
 * With no target row it shows an empty state, never a zero. "No target set" and
 * "a target of zero" are different facts and rendering them alike would report a
 * shortfall that does not exist (§13.1).
 */
export default async function MyTargetsPage() {
  const user = await requireUser()
  const period = parsePeriod({})

  const [dashboard, targets] = await Promise.all([
    getSalespersonDashboard(user.id),
    listMyTargets(period),
  ])

  const target = sumTargets(targets)
  const progress = targetProgress(dashboard.wonThisMonth.valuePaise, target)

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">My Targets</h1>
        <p className="text-sm text-muted-foreground">
          {user.fullName.split(' ')[0]} — this month, and how you are tracking against it.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Target</CardTitle>
          </CardHeader>
          <CardBody className="pt-0">
            {target === null ? (
              <p className="text-sm text-muted-foreground">Not set — ask your sales head.</p>
            ) : (
              <MoneyText paise={target} className="text-2xl font-semibold" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Won this month</CardTitle>
          </CardHeader>
          <CardBody className="pt-0">
            <MoneyText paise={dashboard.wonThisMonth.valuePaise} className="text-2xl font-semibold" />
            <p className="text-xs text-muted-foreground">
              {dashboard.wonThisMonth.count} {dashboard.wonThisMonth.count === 1 ? 'order' : 'orders'}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Progress</CardTitle>
          </CardHeader>
          <CardBody className="pt-0">
            {/* An unmeasurable ratio renders as an em dash, never as 0% (§13.1). */}
            <p className="text-2xl font-semibold tabular-nums">
              {progress.achievementPercent === null ? '—' : formatPercent(progress.achievementPercent)}
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your open pipeline</CardTitle>
        </CardHeader>
        <CardBody className="pt-0">
          {dashboard.pipelineValuePaise === 0 ? (
            <EmptyState
              title="Nothing open"
              description="Opportunities you own that are still in play appear here."
            />
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Pipeline Value</dt>
                <dd>
                  <MoneyText paise={dashboard.pipelineValuePaise} className="text-lg font-medium" />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Weighted Pipeline</dt>
                <dd>
                  <MoneyText paise={dashboard.weightedPipelinePaise} className="text-lg font-medium" />
                </dd>
              </div>
            </dl>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
