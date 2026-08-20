import type { Metadata } from 'next'
import { Suspense } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { SkeletonRows } from '@/components/shared/states'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { managementParams } from '@/features/management/params'
import { MetricNote, ReportShell } from '@/features/management/report-shell'
import { TargetForm } from '@/features/management/target-form'
import { formatDate } from '@/lib/dates'
import { isOwner } from '@/lib/permissions'
import { targetMonthFor, type Period } from '@/lib/period'
import { getTeamWorkload } from '@/services/analytics.service'
import { requireUser } from '@/services/auth.service'
import { listOutlets } from '@/services/outlet.service'
import { listTargetsForMonth, sumTargets, type SalesTarget } from '@/services/target.service'

export const metadata: Metadata = { title: 'Sales targets · JSK CRM' }

/**
 * Sales targets (§10, ADR-021).
 *
 * Three scopes on one screen: the company figure, one per branch, one per
 * salesperson. **A target is a management planning figure, not an accounting
 * record** (§2.2) — nothing in the CRM depends on one existing, and a screen with
 * no target set reports an em dash rather than inventing a denominator.
 *
 * Who may edit what is the RLS policy on `sales_targets`: the company figure is
 * the OWNER's, a branch figure belongs to that branch's managers. This page hides
 * the controls a caller cannot use, which is a courtesy — the database refuses
 * the write regardless (CLAUDE.md §6).
 */
export default async function TargetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flat, period } = managementParams(await searchParams)

  return (
    <ReportShell
      title="Sales targets"
      description="Monthly Won Value targets for the business, each branch and each salesperson"
      period={period}
    >
      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={5} />}>
        <Body period={period} />
      </Suspense>
    </ReportShell>
  )
}

async function Body({ period }: { period: Period }) {
  const month = targetMonthFor(period)
  const user = await requireUser()

  const [targets, outlets, team] = await Promise.all([
    listTargetsForMonth(month),
    listOutlets(),
    getTeamWorkload(period),
  ])

  const mine = isOwner(user)
    ? outlets
    : outlets.filter((outlet) => user.outletIds.includes(outlet.id))

  const find = (outletId: string | null, userId: string | null): SalesTarget | undefined =>
    targets.find(
      (target) => (target.outletId ?? null) === outletId && (target.userId ?? null) === userId,
    )

  const branchTotal = sumTargets(
    mine.map((outlet) => find(outlet.id, null)).filter((target): target is SalesTarget => Boolean(target)),
  )

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Month</CardTitle>
          <span className="text-xs text-muted-foreground">{formatDate(month)}</span>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-muted-foreground">
            Targets are set per calendar month. Choosing a longer period on another report sums the
            months it covers, so a quarter is compared against three monthly targets rather than
            one.
          </p>
        </CardBody>
      </Card>

      {isOwner(user) ? (
        <Card>
          <CardHeader>
            <CardTitle>Company</CardTitle>
          </CardHeader>
          <CardBody>
            <TargetForm
              periodMonth={month}
              outletId={null}
              userId={null}
              label="Company target for the month"
              currentPaise={find(null, null)?.targetPaise ?? null}
              hint="Only the owner sets this. Leave it empty to withdraw it."
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
          {branchTotal !== null ? (
            <span className="text-xs text-muted-foreground">
              Branch targets total <MoneyText paise={branchTotal} compact />
            </span>
          ) : null}
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You do not manage any branch yet.
            </p>
          ) : (
            mine.map((outlet) => (
              <TargetForm
                key={outlet.id}
                periodMonth={month}
                outletId={outlet.id}
                userId={null}
                label={outlet.name}
                currentPaise={find(outlet.id, null)?.targetPaise ?? null}
              />
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Salespeople</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {team.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No salespeople are assigned to the branches you manage.
            </p>
          ) : (
            team.map((member) => {
              // A person's target is always a target AT a branch
              // (`target_user_requires_outlet`). With several branches in scope
              // the page cannot guess which one, so the control is offered only
              // where the answer is unambiguous.
              const outletId = mine.length === 1 ? mine[0].id : null
              if (!outletId) {
                return (
                  <p key={member.userId} className="text-sm text-muted-foreground">
                    {member.fullName} — filter to a single branch to set a personal target.
                  </p>
                )
              }
              return (
                <TargetForm
                  key={member.userId}
                  periodMonth={month}
                  outletId={outletId}
                  userId={member.userId}
                  label={member.fullName}
                  currentPaise={find(outletId, member.userId)?.targetPaise ?? null}
                />
              )
            })
          )}
        </CardBody>
      </Card>

      <MetricNote>
        A target is a <strong>planning figure, not an accounting record</strong> — nothing else in
        the CRM depends on one existing, and every metric works with or without it. Amounts are
        entered in rupees and stored in paise. An <strong>empty box saves a target of zero</strong>,
        which is how a target is withdrawn: nothing here is ever deleted, and a zero target reports
        as met rather than as a 0% failure. A scope with <em>no</em> target row at all reports an em
        dash, because &quot;no target&quot; and &quot;a target of zero&quot; are different facts.
      </MetricNote>
    </div>
  )
}
