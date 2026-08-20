import Link from 'next/link'

import { MoneyText } from '@/components/shared/money-text'
import { StageBadge } from '@/components/shared/stage-badge'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/states'
import { formatDate, relativeDays } from '@/lib/dates'
import { RISK_REASON_LABELS, type RiskReason } from '@/lib/metrics'
import { routes, toRoute } from '@/lib/routes'
import type { AtRiskOpportunity } from '@/services/analytics.service'

/**
 * The at-risk list (§9, §21).
 *
 * **Every row states why it is here.** §9 requires at-risk to be explainable, and
 * the reasons come from `classifyRisk()` — the same function the unit tests pin —
 * rather than being re-derived for display. A manager reading this list should be
 * able to answer "why is this on my screen" without opening the record.
 *
 * The row leads to the opportunity, where the actions are: call, log an activity,
 * set a next action. The list is a way into the work (§21), not a report to admire.
 */

const REASON_TONE: Record<RiskReason, 'overdue' | 'at-risk' | 'muted'> = {
  HIGH_VALUE_AT_RISK: 'overdue',
  OVERDUE_NEXT_ACTION: 'overdue',
  MISSING_NEXT_ACTION: 'at-risk',
  STALLED_IN_STAGE: 'at-risk',
  NO_RECENT_ACTIVITY: 'muted',
}

export function AtRiskList({
  rows,
  showOwner = true,
  emptyDescription,
}: {
  rows: readonly AtRiskOpportunity[]
  showOwner?: boolean
  emptyDescription?: string
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing at risk"
        description={
          emptyDescription ??
          'Every open enquiry has a next action, is inside its stage threshold and has been touched recently.'
        }
      />
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row) => (
        <li key={row.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={routes.opportunity(row.id)}
                className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {row.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {row.accountName ? (
                  <Link href={routes.account(row.accountId)} className="hover:underline">
                    {row.accountName}
                  </Link>
                ) : null}
                {row.projectName ? ` · ${row.projectName}` : ''}
                {showOwner ? ` · ${row.ownerName ?? 'Unassigned'}` : ''}
                {row.outletName ? ` · ${row.outletName}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StageBadge stage={row.stage} />
              <MoneyText paise={row.estimatedValuePaise} compact className="text-sm font-medium" />
            </div>
          </div>

          {/* The explanation. Never colour alone — each badge carries its words. */}
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {row.reasons.map((reason) => (
              <li key={reason}>
                <Badge tone={REASON_TONE[reason]}>{RISK_REASON_LABELS[reason]}</Badge>
              </li>
            ))}
          </ul>

          <p className="mt-1 text-xs text-muted-foreground">
            {row.daysInStage} days in stage
            {' · '}
            {row.lastActivityAt
              ? `last activity ${relativeDays(row.lastActivityAt)}`
              : 'no activity logged'}
            {row.nextActionDate ? ` · next action ${formatDate(row.nextActionDate)}` : ''}
          </p>
        </li>
      ))}
    </ul>
  )
}

/** "Showing 8 of 34 — see them all", so a preview never reads as the whole set. */
export function PreviewFooter({
  shown,
  total,
  href,
  label,
}: {
  shown: number
  total: number
  href: string
  label: string
}) {
  if (total <= shown) return null
  return (
    <p className="pt-3 text-xs text-muted-foreground">
      Showing {shown} of {total}.{' '}
      <Link href={toRoute(href)} className="font-medium text-primary hover:underline">
        {label}
      </Link>
    </p>
  )
}
