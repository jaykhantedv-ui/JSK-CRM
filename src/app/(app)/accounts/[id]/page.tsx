import type { Metadata } from 'next'
import Link from 'next/link'

import { ActivityTimeline } from '@/components/shared/activity-timeline'
import { MoneyText } from '@/components/shared/money-text'
import { NextActionChip } from '@/components/shared/next-action-chip'
import { PhoneActions } from '@/components/shared/phone-actions'
import { OpportunityCard } from '@/components/shared/record-card'
import { StageBadge } from '@/components/shared/stage-badge'
import { Badge } from '@/components/ui/badge'
import { buttonClass } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { relativeDays } from '@/lib/dates'
import {
  ACCOUNT_STATUS_LABELS, ACCOUNT_TYPE_LABELS, LEAD_SOURCE_LABELS, PROJECT_TYPE_LABELS,
} from '@/lib/labels'
import { formatPhone } from '@/lib/phone'
import { logActivityAction } from '@/features/activities/actions'
import { getAccount360 } from '@/services/account.service'
import { userNames } from '@/services/reference.service'
import type { NextActionType, OpportunityStage, ProductCategory } from '@/types/domain'
import { LogActivityPanel } from '@/features/activities/log-activity-panel'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params
  try {
    const { account } = await getAccount360(id)
    return { title: `${account.name} · JSK CRM` }
  } catch {
    // A title must never confirm that a record exists (§25).
    return { title: 'Customer · JSK CRM' }
  }
}

/**
 * Customer 360 (§12.4) — **the most-used screen in the application**.
 *
 * The layout follows §12.4 exactly: name and phone actions at the top, the next
 * action immediately beneath (red when overdue), then the money line, then open
 * opportunities, then **exactly three** recent activities. Address, GSTIN, source
 * and audit fields sit in Details, below the fold, because they are not what
 * somebody opens this screen for.
 *
 * The next action shown is the soonest across the customer's open opportunities:
 * a salesperson looking at a customer wants "when do I next owe them something?",
 * not a per-deal breakdown.
 */
export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const query = await searchParams
  const [detail, names] = await Promise.all([getAccount360(id), userNames()])
  const { account, openOpportunities, closedOpportunities, projects, recentActivities } = detail

  // The soonest open next action across this customer's opportunities.
  const nextUp = openOpportunities
    .filter((opportunity) => opportunity.next_action_date)
    .sort((a, b) => (a.next_action_date ?? '').localeCompare(b.next_action_date ?? ''))[0]

  const logAction = logActivityAction.bind(null, {
    accountId: account.id,
    redirectTo: `/accounts/${account.id}`,
  })

  return (
    <div className="flex flex-col gap-4">
      {query.created === '1' ? (
        <p role="status" className="rounded-md bg-state-won/15 px-3 py-2 text-sm">
          Customer and enquiry saved.
        </p>
      ) : null}

      {/* Sticky on mobile: the name and the two actions that get used most (§12.4). */}
      <header className="sticky top-14 z-10 -mx-4 flex flex-col gap-2 border-b border-border bg-background px-4 pb-3 md:static md:mx-0 md:border-0 md:px-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{account.name}</h1>
            <p className="text-sm text-muted-foreground">
              {[ACCOUNT_TYPE_LABELS[account.account_type], account.city].filter(Boolean).join(' · ')}
            </p>
          </div>
          <PhoneActions phone={account.phone} whatsappPhone={account.whatsapp_phone} label={account.name} />
        </div>

        {nextUp ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Next action</span>
            <NextActionChip
              nextAction={nextUp.next_action as NextActionType | null}
              nextActionDate={nextUp.next_action_date}
              stage={nextUp.stage}
            />
            <Link href={`/opportunities/${nextUp.id}`} className="text-xs underline underline-offset-2">
              {nextUp.title}
            </Link>
          </div>
        ) : openOpportunities.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <NextActionChip nextAction={null} nextActionDate={null} stage="new" />
            <span className="text-xs text-muted-foreground">
              No next step set on any open enquiry.
            </span>
          </div>
        ) : null}
      </header>

      {/* §12.4 — Won, Pipeline, recency. The word "Revenue" appears nowhere (§2.4). */}
      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardBody className="pt-3">
            <p className="text-xs text-muted-foreground">Won</p>
            <MoneyText paise={detail.wonValuePaise} compact className="text-base font-semibold" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="pt-3">
            <p className="text-xs text-muted-foreground">Pipeline</p>
            <MoneyText paise={detail.pipelineValuePaise} compact className="text-base font-semibold" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="pt-3">
            <p className="text-xs text-muted-foreground">Last contact</p>
            <p className="text-base font-semibold">
              {account.last_activity_at ? relativeDays(account.last_activity_at) : '—'}
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Open enquiries · {openOpportunities.length}</CardTitle>
          <Link href={`/opportunities/new?account=${account.id}`} className={buttonClass('outline', 'sm')}>
            Add
          </Link>
        </CardHeader>
        <CardBody>
          {openOpportunities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing open. Add an enquiry when they ask about something.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {openOpportunities.map((opportunity) => (
                <li key={opportunity.id}>
                  <OpportunityCard
                    id={opportunity.id}
                    title={opportunity.title}
                    stage={opportunity.stage as OpportunityStage}
                    category={opportunity.category as ProductCategory}
                    estimatedValuePaise={opportunity.estimated_value}
                    nextAction={opportunity.next_action as NextActionType | null}
                    nextActionDate={opportunity.next_action_date}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <LogActivityPanel
            action={logAction}
            opportunities={openOpportunities.map((row) => ({
              id: row.id,
              title: row.title,
              stage: row.stage,
            }))}
          />
        </CardHeader>
        <CardBody>
          <ActivityTimeline
            activities={recentActivities}
            performerNames={names}
            emptyMessage="Nothing logged against this customer yet."
          />
          {recentActivities.length > 0 ? (
            <Link
              href={`/accounts/${account.id}/activity`}
              className="mt-3 inline-block text-sm underline underline-offset-4"
            >
              All activity
            </Link>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sites · {projects.length}</CardTitle>
          <Link href={`/projects/new?account=${account.id}`} className={buttonClass('outline', 'sm')}>
            Add site
          </Link>
        </CardHeader>
        <CardBody>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No site recorded. Add one when you know where the material is going.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-3 hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{project.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[PROJECT_TYPE_LABELS[project.project_type], project.city].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {closedOpportunities.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Closed · {closedOpportunities.length}</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-col gap-2">
              {closedOpportunities.map((opportunity) => (
                <li key={opportunity.id}>
                  <Link
                    href={`/opportunities/${opportunity.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-3 hover:bg-accent"
                  >
                    <span className="min-w-0 truncate text-sm">{opportunity.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <StageBadge stage={opportunity.stage as OpportunityStage} />
                      <MoneyText
                        paise={opportunity.final_order_value ?? opportunity.estimated_value}
                        compact
                        className="text-sm"
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {/* §12.4 — address, GSTIN, source and audit fields live here, not above. */}
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <Link href={`/accounts/${account.id}/edit`} className={buttonClass('outline', 'sm')}>
            Edit
          </Link>
        </CardHeader>
        <CardBody>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Phone" value={formatPhone(account.phone)} />
            <Detail label="Alternate phone" value={formatPhone(account.alt_phone)} />
            <Detail label="Email" value={account.email} />
            <Detail label="Area" value={account.area} />
            <Detail label="Address" value={account.address} />
            <Detail label="GSTIN" value={account.gstin} />
            <Detail label="How they reached us" value={LEAD_SOURCE_LABELS[account.source]} />
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="mt-0.5">
                <Badge tone={account.status === 'ACTIVE' ? 'won' : 'muted'}>
                  {ACCOUNT_STATUS_LABELS[account.status]}
                </Badge>
              </dd>
            </div>
            <Detail label="Owner" value={names[account.owner_id] ?? '—'} />
            <Detail label="Notes" value={account.notes} />
          </dl>
        </CardBody>
      </Card>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      {/* "Not recorded" and "empty" are different facts; an em dash says the first (§12.6). */}
      <dd className="mt-0.5 whitespace-pre-wrap">{value || '—'}</dd>
    </div>
  )
}
