import { Badge } from '@/components/ui/badge'
import { STAGE_LABELS, STAGE_TONES } from '@/lib/labels'
import type { OpportunityStage } from '@/types/domain'

/**
 * The stage badge (§12.5).
 *
 * Label and colour together, always — §12.1 forbids colour as the only signal.
 * The label comes from `lib/labels.ts`, so no screen prints a raw enum value.
 */
export function StageBadge({ stage, className }: { stage: OpportunityStage; className?: string }) {
  return (
    <Badge tone={STAGE_TONES[stage]} className={className}>
      {STAGE_LABELS[stage]}
    </Badge>
  )
}
