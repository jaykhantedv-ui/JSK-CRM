import { AlertTriangle, CalendarClock, CalendarPlus, CheckCircle2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { NEXT_ACTION_LABELS, nextActionLabel, nextActionState, nextActionTone } from '@/lib/next-action'
import type { NextActionType } from '@/types/domain'

/**
 * The next-action chip (§12.5) — red when overdue, "Set next action" when missing.
 *
 * This is the single most-read element in the product: the stated business
 * problem is forgotten follow-ups, and this chip is the answer to "when do I next
 * touch this?" on every card and every row.
 *
 * The icon is not decoration. Pairing it with the label is what keeps the state
 * legible without colour (§12.1).
 */
export function NextActionChip({
  nextAction,
  nextActionDate,
  stage,
  showType = true,
}: {
  nextAction: NextActionType | null
  nextActionDate: string | null
  stage: string
  showType?: boolean
}) {
  const state = nextActionState({ nextActionDate, stage })
  const tone = nextActionTone(state)
  const label = nextActionLabel({ nextActionDate, stage })

  const Icon =
    state === 'OVERDUE'
      ? AlertTriangle
      : state === 'MISSING'
        ? CalendarPlus
        : state === 'CLOSED'
          ? CheckCircle2
          : CalendarClock

  return (
    <Badge tone={tone}>
      <Icon className="size-3" aria-hidden />
      {showType && nextAction && state !== 'MISSING' && state !== 'CLOSED'
        ? `${NEXT_ACTION_LABELS[nextAction]} · ${label}`
        : label}
    </Badge>
  )
}
