import Link from 'next/link'
import { AlertTriangle, Info } from 'lucide-react'

import { buttonClass } from '@/components/ui/button'
import { duplicateWarningTitle, overallConfidence, signalLabel, type DuplicateMatch } from '@/lib/duplicates'
import { formatPhone } from '@/lib/phone'
import { cn } from '@/lib/utils'

/**
 * The duplicate warning card (§8.9, §12.5).
 *
 * **Advisory only.** It warns, shows the existing record, and offers to open it
 * or to add an opportunity there — and the Save button beside it stays enabled
 * throughout. Nothing in this component can block a save, and nothing anywhere
 * merges automatically. §8.9 is explicit on both points, and a card that could
 * block would quietly become a validation rule.
 *
 * Every record listed is one the caller may already open: the SQL behind it runs
 * under their own session, so a match they have no right to see is never returned
 * (§25).
 */
export function DuplicateWarning({ matches }: { matches: DuplicateMatch[] }) {
  if (matches.length === 0) return null

  const confidence = overallConfidence(matches)
  const exact = confidence === 'EXACT'
  const Icon = exact ? AlertTriangle : Info

  return (
    <section
      aria-live="polite"
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-3',
        exact ? 'border-state-at-risk bg-state-at-risk/10' : 'border-border bg-muted/40',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="text-sm font-medium">{duplicateWarningTitle(confidence, matches.length)}</p>
          <p className="text-xs text-muted-foreground">
            Check whether this is the same person before you continue. You can still save.
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {matches.map((match) => (
          <li
            key={match.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background p-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{match.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {signalLabel(match.signal)}
                {match.phone ? ` · ${formatPhone(match.phone)}` : ''}
                {match.city ? ` · ${match.city}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link href={`/accounts/${match.id}`} className={buttonClass('outline', 'sm')}>
                Open
              </Link>
              <Link
                href={`/opportunities/new?account=${match.id}`}
                className={buttonClass('secondary', 'sm')}
              >
                Add opportunity
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
