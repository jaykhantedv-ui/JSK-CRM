import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { OpportunityCard } from '@/components/shared/record-card'
import { EmptyState, SkeletonRows, SkeletonTiles } from '@/components/shared/states'
import { buttonClass } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { getCurrentUser } from '@/services/auth.service'
import { getSalespersonDashboard, type WorkQueueRow } from '@/services/dashboard.service'
import type { NextActionType, OpportunityStage, ProductCategory } from '@/types/domain'

export const metadata: Metadata = { title: 'Today · JSK CRM' }

/**
 * `/today` — the salesperson's home (§13.2).
 *
 * **A work queue, not analytics.** The stated business problem is salespeople
 * forgetting follow-ups, so this screen answers one question — *what do I need to
 * do today?* — in the order §13.2 fixes: overdue, due today, upcoming, missing
 * next action, new enquiries breaching SLA, then two of the user's own numbers.
 *
 * Deliberately absent (§13.2): other people's numbers, team totals, win rate,
 * leaderboards. A salesperson comparing themselves to a colleague is not doing
 * the work this screen exists to prompt.
 *
 * Each section streams independently under Suspense, so a slow tile never holds
 * up the overdue list — the one thing that has to be on screen fast (§12.8).
 */
export default async function TodayPage() {
  const user = await getCurrentUser()

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Today</h1>
          <p className="text-sm text-muted-foreground">
            {user ? `${user.fullName.split(' ')[0]} — here's what's waiting on you.` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/accounts/new" className={buttonClass('primary', 'sm')}>
            New customer
          </Link>
          <Link href="/accounts" className={buttonClass('outline', 'sm')}>
            Log activity
          </Link>
        </div>
      </header>

      <Suspense
        fallback={
          <div className="flex flex-col gap-4">
            <SkeletonTiles tiles={2} />
            <SkeletonRows rows={4} />
          </div>
        }
      >
        <TodayQueues />
      </Suspense>
    </div>
  )
}

function QueueSection({
  title,
  rows,
  accountNames,
  tone,
  emptyMessage,
  collapsed = false,
}: {
  title: string
  rows: WorkQueueRow[]
  accountNames: Record<string, string>
  tone?: 'overdue' | 'at-risk'
  emptyMessage: string
  collapsed?: boolean
}) {
  const heading = (
    <CardHeader>
      <CardTitle
        className={
          rows.length === 0
            ? undefined
            : tone === 'overdue'
              ? 'text-destructive'
              : tone === 'at-risk'
                ? 'text-state-at-risk'
                : undefined
        }
      >
        {title} · {rows.length}
      </CardTitle>
    </CardHeader>
  )

  const body =
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground">{emptyMessage}</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id}>
            <OpportunityCard
              id={row.id as string}
              title={row.title as string}
              accountName={accountNames[row.account_id as string]}
              stage={row.stage as OpportunityStage}
              category={row.category as ProductCategory}
              estimatedValuePaise={row.estimated_value}
              nextAction={row.next_action as NextActionType | null}
              nextActionDate={row.next_action_date}
            />
          </li>
        ))}
      </ul>
    )

  if (collapsed && rows.length > 0) {
    return (
      <Card>
        <details>
          <summary className="cursor-pointer list-none">{heading}</summary>
          <CardBody>{body}</CardBody>
        </details>
      </Card>
    )
  }

  return (
    <Card>
      {heading}
      <CardBody>{body}</CardBody>
    </Card>
  )
}

async function TodayQueues() {
  const dashboard = await getSalespersonDashboard()
  const { accountNames } = dashboard

  const nothingWaiting =
    dashboard.overdue.length === 0 &&
    dashboard.dueToday.length === 0 &&
    dashboard.upcoming.length === 0 &&
    dashboard.missingNextAction.length === 0 &&
    dashboard.newEnquiriesToContact.length === 0

  if (nothingWaiting && dashboard.pipelineValuePaise === 0) {
    return (
      <EmptyState
        title="Nothing assigned to you yet"
        description="When a customer is added against your name, everything waiting on you shows up here."
        action={{ href: '/accounts/new', label: 'Add a customer' }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* §13.2 tiles 6 and 7 — the salesperson's own two numbers, and no more. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>My pipeline</CardTitle>
          </CardHeader>
          <CardBody>
            <MoneyText paise={dashboard.pipelineValuePaise} compact className="text-2xl font-semibold" />
            <p className="mt-1 text-xs text-muted-foreground">
              Weighted <MoneyText paise={dashboard.weightedPipelinePaise} compact />
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Won this month</CardTitle>
          </CardHeader>
          <CardBody>
            <MoneyText paise={dashboard.wonThisMonth.valuePaise} compact className="text-2xl font-semibold" />
            <p className="mt-1 text-xs text-muted-foreground">
              {dashboard.wonThisMonth.count} {dashboard.wonThisMonth.count === 1 ? 'order' : 'orders'}
            </p>
          </CardBody>
        </Card>
      </div>

      <QueueSection
        title="Overdue"
        tone="overdue"
        rows={dashboard.overdue}
        accountNames={accountNames}
        emptyMessage="Nothing overdue. Good."
      />
      <QueueSection
        title="Due today"
        rows={dashboard.dueToday}
        accountNames={accountNames}
        emptyMessage="Nothing due today."
      />
      <QueueSection
        title="Missing next action"
        tone="at-risk"
        rows={dashboard.missingNextAction}
        accountNames={accountNames}
        emptyMessage="Every open enquiry has a next step."
      />
      <QueueSection
        title="New enquiries to contact"
        tone="at-risk"
        rows={dashboard.newEnquiriesToContact}
        accountNames={accountNames}
        emptyMessage="No new enquiry is waiting too long."
      />
      <QueueSection
        title="Upcoming (7 days)"
        rows={dashboard.upcoming}
        accountNames={accountNames}
        emptyMessage="Nothing scheduled in the next week."
        collapsed
      />
    </div>
  )
}
