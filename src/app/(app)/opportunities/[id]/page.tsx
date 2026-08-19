import type { Metadata } from 'next'
import Link from 'next/link'

import { ActivityTimeline } from '@/components/shared/activity-timeline'
import { MoneyText } from '@/components/shared/money-text'
import { PhoneActions } from '@/components/shared/phone-actions'
import { buttonClass } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatDateTime } from '@/lib/dates'
import {
  ACCOUNT_TYPE_LABELS, LOST_REASON_LABELS, QUOTATION_STATUS_LABELS, STAGE_LABELS,
} from '@/lib/labels'
import { CATEGORY_LABELS } from '@/lib/opportunity/title'
import { isManagerOrAbove } from '@/lib/permissions'
import { logActivityAction } from '@/features/activities/actions'
import { NextActionControl } from '@/features/opportunities/next-action-control'
import { ReassignControl, ReopenControl } from '@/features/opportunities/reassign-control'
import { StageControl } from '@/features/opportunities/stage-control'
import { requireUser } from '@/services/auth.service'
import { getOpportunityDetail } from '@/services/opportunity.service'
import { assignableUserOptions, userNames } from '@/services/reference.service'
import type { NextActionType, OpportunityStage, ProductCategory } from '@/types/domain'
import { LogActivityPanel } from '@/features/activities/log-activity-panel'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params
  try {
    const { opportunity } = await getOpportunityDetail(id)
    return { title: `${opportunity.title} · JSK CRM` }
  } catch {
    return { title: 'Opportunity · JSK CRM' }
  }
}

/**
 * Opportunity detail (§12.2) — stage control, next action, timeline, quotation.
 *
 * The next-action control sits above everything except the customer, because
 * updating it is the single most frequent thing anybody does on this screen
 * (§11.6).
 *
 * The stage picker only offers moves this user's role may make: the server built
 * the list from the transition matrix. That is a rendering courtesy — the service
 * validates the move again, and the check constraints refuse an invalid row
 * whatever either of them thinks (CLAUDE.md §5, §8).
 */
export default async function OpportunityDetailPage({ params }: { params: Params }) {
  const { id } = await params
  const user = await requireUser()
  const detail = await getOpportunityDetail(id)
  const { opportunity, account, project, activities, events, allowedStages } = detail

  const [names, teammates] = await Promise.all([
    userNames(),
    isManagerOrAbove(user) ? assignableUserOptions() : Promise.resolve([]),
  ])

  const stage = opportunity.stage as OpportunityStage
  const closed = stage === 'won' || stage === 'lost'

  const logAction = logActivityAction.bind(null, {
    accountId: account.id,
    opportunityId: opportunity.id as string,
    projectId: opportunity.project_id,
    redirectTo: `/opportunities/${opportunity.id}`,
  })

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <Link href={`/accounts/${account.id}`} className="text-sm underline underline-offset-4">
          ← {account.name}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{opportunity.title}</h1>
            <p className="text-sm text-muted-foreground">
              {[
                ACCOUNT_TYPE_LABELS[account.account_type as keyof typeof ACCOUNT_TYPE_LABELS],
                CATEGORY_LABELS[opportunity.category as ProductCategory],
                project ? project.name : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <PhoneActions phone={account.phone} label={account.name} size="sm" />
        </div>
      </header>

      {/* §11.6 — the most-used control on the page, and hidden once closed. */}
      {!closed ? (
        <Card>
          <CardHeader>
            <CardTitle>Next action</CardTitle>
          </CardHeader>
          <CardBody>
            <NextActionControl
              opportunityId={opportunity.id as string}
              stage={stage}
              nextAction={opportunity.next_action as NextActionType | null}
              nextActionDate={opportunity.next_action_date}
              nextActionNote={opportunity.next_action_note}
            />
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardBody className="pt-3">
            <p className="text-xs text-muted-foreground">Estimated</p>
            <MoneyText paise={opportunity.estimated_value} className="text-base font-semibold" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="pt-3">
            <p className="text-xs text-muted-foreground">Quoted</p>
            <MoneyText paise={opportunity.quoted_value} className="text-base font-semibold" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="pt-3">
            <p className="text-xs text-muted-foreground">
              {stage === 'won' ? 'Order value' : 'Days in stage'}
            </p>
            {stage === 'won' ? (
              <MoneyText paise={opportunity.final_order_value} className="text-base font-semibold" />
            ) : (
              <p className="text-base font-semibold">{opportunity.days_in_stage ?? 0}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stage</CardTitle>
          <div className="flex gap-2">
            {closed && isManagerOrAbove(user) ? <ReopenControl opportunityId={opportunity.id as string} /> : null}
            <Link href={`/opportunities/${opportunity.id}/edit`} className={buttonClass('outline', 'sm')}>
              Edit
            </Link>
          </div>
        </CardHeader>
        <CardBody>
          <StageControl
            opportunityId={opportunity.id as string}
            currentStage={stage}
            allowedStages={allowedStages}
            quotationRef={opportunity.quotation_ref}
            quotationDate={opportunity.quotation_date}
          />

          {stage === 'lost' && opportunity.lost_reason ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Lost: {LOST_REASON_LABELS[opportunity.lost_reason]}
              {opportunity.lost_detail ? ` — ${opportunity.lost_detail}` : ''}
              {opportunity.competitor ? ` (${opportunity.competitor})` : ''}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <LogActivityPanel
            action={logAction}
            opportunities={[{ id: opportunity.id as string, title: opportunity.title as string, stage }]}
            defaultOpportunityId={opportunity.id as string}
          />
        </CardHeader>
        <CardBody>
          <ActivityTimeline
            activities={activities}
            performerNames={names}
            emptyMessage="Nothing logged against this enquiry yet."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quotation</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Reference" value={opportunity.quotation_ref} />
            <Detail
              label="Date"
              value={opportunity.quotation_date ? formatDate(opportunity.quotation_date) : null}
            />
            <Detail
              label="Status"
              value={QUOTATION_STATUS_LABELS[opportunity.quotation_status as keyof typeof QUOTATION_STATUS_LABELS]}
            />
            <Detail
              label="Valid until"
              value={
                opportunity.quotation_valid_until ? formatDate(opportunity.quotation_valid_until) : null
              }
            />
            <Detail label="Material notes" value={opportunity.material_notes} />
            <Detail
              label="Expected close"
              value={opportunity.expected_close_date ? formatDate(opportunity.expected_close_date) : null}
            />
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ownership</CardTitle>
          {isManagerOrAbove(user) && !closed ? (
            <ReassignControl
              opportunityId={opportunity.id as string}
              currentOwnerId={opportunity.owner_id}
              teammates={teammates}
            />
          ) : null}
        </CardHeader>
        <CardBody>
          <p className="text-sm">
            {opportunity.owner_id ? (names[opportunity.owner_id] ?? 'Another branch') : 'Unassigned'}
          </p>
        </CardBody>
      </Card>

      {/*
        The audit trail (§5.9). Append-only for EVERYONE, including the owner —
        there is no update and no delete policy on `opportunity_events`, so nothing
        on this screen can offer to change what it says.
      */}
      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardBody>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{eventLabel(event.event_type)}</span>
                  {event.from_stage && event.to_stage ? (
                    <span className="text-muted-foreground">
                      {STAGE_LABELS[event.from_stage]} → {STAGE_LABELS[event.to_stage]}
                    </span>
                  ) : null}
                  {event.from_owner_id || event.to_owner_id ? (
                    <span className="text-muted-foreground">
                      {names[event.from_owner_id ?? ''] ?? 'Unassigned'} →{' '}
                      {names[event.to_owner_id ?? ''] ?? 'Unassigned'}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(event.created_at)}
                    {names[event.actor_id] ? ` · ${names[event.actor_id]}` : ''}
                  </span>
                  {event.reason ? (
                    <span className="w-full text-xs text-muted-foreground">“{event.reason}”</span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function eventLabel(type: string): string {
  const LABELS: Record<string, string> = {
    CREATED: 'Created',
    STAGE_CHANGED: 'Stage changed',
    OWNER_CHANGED: 'Reassigned',
    WON: 'Won',
    LOST: 'Lost',
    REOPENED: 'Reopened',
    ARCHIVED: 'Archived',
    RESTORED: 'Restored',
  }
  return LABELS[type] ?? type
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap">{value || '—'}</dd>
    </div>
  )
}
