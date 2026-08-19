import type { Metadata } from 'next'
import Link from 'next/link'

import { ActivityTimeline } from '@/components/shared/activity-timeline'
import { MoneyText } from '@/components/shared/money-text'
import { OpportunityCard } from '@/components/shared/record-card'
import { buttonClass } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/dates'
import {
  CONSTRUCTION_STAGE_LABELS, PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS,
} from '@/lib/labels'
import { logActivityAction } from '@/features/activities/actions'
import { LogActivityPanel } from '@/features/activities/log-activity-panel'
import { StakeholderPanel } from '@/features/projects/stakeholder-panel'
import { getProjectDetail } from '@/services/project.service'
import { listContacts } from '@/services/contact.service'
import { userNames } from '@/services/reference.service'
import type { NextActionType, OpportunityStage, ProductCategory } from '@/types/domain'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params
  try {
    const { project } = await getProjectDetail(id)
    return { title: `${project.name} · JSK CRM` }
  } catch {
    return { title: 'Project · JSK CRM' }
  }
}

/**
 * Project detail (§11.2, §11.3, §11.4).
 *
 * **The key behaviour to verify visually: a site lists MANY opportunities.**
 * §11.3 says so explicitly, and it is the one thing about this model that is easy
 * to break by accident. Tiles, sanitaryware and CP fittings on the same house are
 * three deals with three stages and three values, not one.
 *
 * "People on this project" is §5.6's stakeholder table. The word "stakeholder"
 * never reaches the screen.
 */
export default async function ProjectDetailPage({ params }: { params: Params }) {
  const { id } = await params
  const detail = await getProjectDetail(id)
  const { project, account, opportunities, stakeholders, activities } = detail

  // The people already on this customer's file are the ones most likely to be on
  // the site, so they are what the picker offers first (§11.4).
  const [names, contactCandidates] = await Promise.all([
    userNames(),
    listContacts({ accountId: project.account_id }, { page: 1, pageSize: 50 }),
  ])

  const open = opportunities.filter((row) => row.stage !== 'won' && row.stage !== 'lost')
  const pipelineValue = open
    .filter((row) => row.stage !== 'nurture')
    .reduce((sum, row) => sum + row.estimated_value, 0)

  const logAction = account
    ? logActivityAction.bind(null, {
        accountId: account.id,
        projectId: project.id,
        redirectTo: `/projects/${project.id}`,
      })
    : null

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        {account ? (
          <Link href={`/accounts/${account.id}`} className="text-sm underline underline-offset-4">
            ← {account.name}
          </Link>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
            <p className="text-sm text-muted-foreground">
              {[
                PROJECT_TYPE_LABELS[project.project_type],
                CONSTRUCTION_STAGE_LABELS[project.construction_stage],
                project.city,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <Link href={`/projects/${project.id}/edit`} className={buttonClass('outline', 'sm')}>
            Edit
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardBody className="pt-3">
            <p className="text-xs text-muted-foreground">Open enquiries</p>
            <p className="text-base font-semibold">{open.length}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="pt-3">
            <p className="text-xs text-muted-foreground">Pipeline</p>
            <MoneyText paise={pipelineValue} compact className="text-base font-semibold" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="pt-3">
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="text-base font-semibold">{PROJECT_STATUS_LABELS[project.status]}</p>
          </CardBody>
        </Card>
      </div>

      {/* MANY opportunities per project — the model's key behaviour (§11.3). */}
      <Card>
        <CardHeader>
          <CardTitle>Enquiries on this site · {opportunities.length}</CardTitle>
          <Link
            href={`/opportunities/new?account=${project.account_id}&project=${project.id}`}
            className={buttonClass('outline', 'sm')}
          >
            Add enquiry
          </Link>
        </CardHeader>
        <CardBody>
          {opportunities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet. A site usually carries several — tiles now, sanitaryware later.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {opportunities.map((opportunity) => (
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
          <CardTitle>People on this project · {stakeholders.length}</CardTitle>
        </CardHeader>
        <CardBody>
          <StakeholderPanel
            projectId={project.id}
            stakeholders={stakeholders}
            contactOptions={contactCandidates.rows.map((contact) => ({
              value: contact.id,
              label: `${contact.full_name}${contact.phone ? ` · ${contact.phone}` : ''}`,
            }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          {logAction ? (
            <LogActivityPanel
              action={logAction}
              opportunities={open.map((row) => ({ id: row.id, title: row.title, stage: row.stage }))}
              defaultType="SITE_VISIT"
              label="Log site visit"
            />
          ) : null}
        </CardHeader>
        <CardBody>
          <ActivityTimeline
            activities={activities}
            performerNames={names}
            emptyMessage="Nothing logged against this site yet."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Site details</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Address" value={project.site_address} />
            <Detail label="Area" value={project.area} />
            <Detail
              label="Built-up area"
              value={project.builtup_area_sqft ? `${project.builtup_area_sqft} sq ft` : null}
            />
            <Detail label="Floors" value={project.floors === null ? null : String(project.floors)} />
            <Detail label="Bathrooms" value={project.bathrooms === null ? null : String(project.bathrooms)} />
            <Detail
              label="Expected flooring"
              value={project.expected_flooring_date ? formatDate(project.expected_flooring_date) : null}
            />
            <Detail label="Owner" value={names[project.owner_id] ?? '—'} />
            <Detail label="Notes" value={project.notes} />
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
      <dd className="mt-0.5 whitespace-pre-wrap">{value || '—'}</dd>
    </div>
  )
}
