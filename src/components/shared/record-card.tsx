import Link from 'next/link'

import { MoneyText } from '@/components/shared/money-text'
import { NextActionChip } from '@/components/shared/next-action-chip'
import { StageBadge } from '@/components/shared/stage-badge'
import { CATEGORY_LABELS } from '@/lib/opportunity/title'
import type { NextActionType, OpportunityStage, ProductCategory } from '@/types/domain'

/**
 * The opportunity row (§12.5 `RecordCard`).
 *
 * §13.2 fixes what a work-queue row shows: **customer name, category, value,
 * stage badge, next-action chip.** Tapping opens the opportunity. Nothing else
 * belongs here — a row that has to be read at arm's length in a showroom cannot
 * also be a summary screen.
 */
export function OpportunityCard({
  id,
  title,
  accountName,
  stage,
  category,
  estimatedValuePaise,
  nextAction,
  nextActionDate,
}: {
  id: string
  title: string
  accountName?: string | null
  stage: OpportunityStage
  category: ProductCategory
  estimatedValuePaise: number | null
  nextAction: NextActionType | null
  nextActionDate: string | null
}) {
  return (
    <Link
      href={`/opportunities/${id}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{accountName ?? title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {accountName ? title : CATEGORY_LABELS[category]}
          </p>
        </div>
        <MoneyText paise={estimatedValuePaise} compact className="text-sm font-semibold" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StageBadge stage={stage} />
        <NextActionChip nextAction={nextAction} nextActionDate={nextActionDate} stage={stage} />
      </div>
    </Link>
  )
}

/** The customer row on `/accounts` and in search results. */
export function AccountCard({
  id,
  name,
  subtitle,
  right,
}: {
  id: string
  name: string
  subtitle?: string | null
  right?: React.ReactNode
}) {
  return (
    <Link
      href={`/accounts/${id}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {right}
    </Link>
  )
}
