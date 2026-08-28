import type { Metadata } from 'next'

import Link from 'next/link'

import { ForbiddenState } from '@/components/shared/states'
import { buttonClass } from '@/components/ui/button'
import { toRoute } from '@/lib/routes'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/dates'
import { formatPaise } from '@/lib/money'
import { canEditSettings, canOpenSettings } from '@/lib/permissions'
import { updateSettingAction } from '@/features/settings/actions'
import { SettingForm } from '@/features/settings/setting-form'
import { requireUser } from '@/services/auth.service'
import { getAllSettings, type EditableSettingKey } from '@/services/settings.service'

export const metadata: Metadata = { title: 'Settings · JSK CRM' }

/**
 * Operational settings (§5.10, TODO-BD §24).
 *
 * **Every value here is one the business may change without a deploy.** That is
 * why none of them is a constant anywhere in the code (CLAUDE.md §3): the
 * high-value threshold exists in exactly one place, and that place is the
 * database row this screen edits.
 *
 * OWNER and ADMIN only — and ADMIN is here precisely because §3.1 makes it the
 * system-administration role. It carries no sales visibility (ADR-017), which is
 * why this page shows configuration and not a single customer record.
 */
const FIELDS: {
  key: EditableSettingKey
  label: string
  description: string
  kind: 'number' | 'lines' | 'json' | 'schedule'
}[] = [
  {
    key: 'cities',
    label: 'Taluks',
    description: 'One per line. Offered wherever a customer or site location is entered.',
    kind: 'lines',
  },
  {
    key: 'material_types',
    label: 'Material types',
    description: 'One per line. Suggested when describing marble and granite.',
    kind: 'lines',
  },
  {
    key: 'high_value_threshold_paise',
    label: 'High-value threshold (paise)',
    description: 'Opportunities at or above this are escalated to managers.',
    kind: 'number',
  },
  {
    key: 'new_enquiry_sla_hours',
    label: 'New enquiry response time (hours)',
    description: 'A new enquiry untouched for longer than this triggers one reminder.',
    kind: 'number',
  },
  {
    key: 'account_dormancy_days',
    label: 'Customer dormancy (days)',
    description: 'Days without activity before a customer is marked dormant overnight.',
    kind: 'number',
  },
  {
    key: 'opportunity_dormancy_days',
    label: 'Opportunity dormancy (days)',
    description: 'Days without activity before an opportunity is flagged dormant on dashboards.',
    kind: 'number',
  },
  {
    key: 'owner_summary_schedule',
    label: 'Owner summary',
    description: 'When the owner summary email is sent. Asia/Kolkata.',
    kind: 'schedule',
  },
  {
    key: 'stage_probabilities',
    label: 'Stage probabilities',
    description: 'Percentage per stage, used for Weighted Pipeline.',
    kind: 'json',
  },
  {
    key: 'stage_stall_days',
    label: 'Stage stall thresholds',
    description: 'Days in one stage before an opportunity is flagged stalled.',
    kind: 'json',
  },
]

export default async function SettingsPage() {
  const user = await requireUser()
  // Reachable by OWNER and ADMIN: the organisation links below are the
  // administrator's, and the business rules are the owner's (ADR-042).
  if (!canOpenSettings(user)) {
    return (
      <ForbiddenState
        backHref="/today"
        title="This screen is not part of your role"
        description="Ask the owner or an administrator if you need it."
      />
    )
  }
  const mayEditRules = canEditSettings(user)

  const settings = await getAllSettings()

  const failures = Number(settings.maintenance_consecutive_failures ?? 0)
  const lastFailure = settings.maintenance_last_failure_at

  return (
    <div className="flex flex-col gap-6 py-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          These values take effect immediately. Nothing here needs a deployment.
        </p>
      </header>

      {/* The organisation itself — branches, people and the reporting line — is
          three screens of its own rather than a section here: it is the
          authorization model, not a threshold (ADR-040). */}
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardBody className="pt-0">
          <ul className="flex flex-wrap gap-2">
            {[
              ['/settings/organization/branches', 'Branches'],
              ['/settings/organization/people', 'People'],
              ['/settings/organization/structure', 'Reporting Structure'],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={toRoute(href)} className={buttonClass('secondary', 'sm')}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {/* OWNER only. Every value here changes how the CRM behaves for everybody,
          without a deploy — configuring the system rather than running the
          business (ADR-042). `system_settings_update` is the control; this
          decides what is offered. */}
      {!mayEditRules ? (
        <Card>
          <CardHeader>
            <CardTitle>Business rules</CardTitle>
          </CardHeader>
          <CardBody className="pt-0">
            <p className="text-sm text-muted-foreground">
              The thresholds, taluk list, stage probabilities and schedules are the
              owner&rsquo;s to set. Ask them if one needs changing.
            </p>
          </CardBody>
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <CardTitle>Business rules</CardTitle>
        </CardHeader>
        <CardBody>
          {FIELDS.map((field) => (
            <SettingForm
              key={field.key}
              settingKey={field.key}
              label={
                field.key === 'high_value_threshold_paise'
                  ? `${field.label} — currently ${formatPaise(Number(settings[field.key] ?? 0))}`
                  : field.label
              }
              description={field.description}
              value={settings[field.key]}
              kind={field.kind}
              action={updateSettingAction.bind(null, field.key)}
            />
          ))}
        </CardBody>
      </Card>
      )}

      {/*
        ADR-014. Operational state, shown but NOT editable: these two keys are
        written only by the nightly maintenance cron. Offering a reset button here
        would let an administrator silence a failing job rather than fix it.
      */}
      <Card>
        <CardHeader>
          <CardTitle>Nightly maintenance</CardTitle>
        </CardHeader>
        <CardBody className="text-sm">
          {failures === 0 ? (
            <p className="text-muted-foreground">
              Running normally. The last run completed without error.
            </p>
          ) : (
            <p className="text-destructive">
              {failures} consecutive {failures === 1 ? 'failure' : 'failures'}
              {typeof lastFailure === 'string'
                ? `, most recently ${formatDateTime(lastFailure)}`
                : ''}
              . Dormancy and quotation expiry may be out of date.
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            This is recorded by the job itself and is not editable.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
