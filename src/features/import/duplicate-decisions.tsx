'use client'

import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ImportDecision, ImportRowRecord } from '@/services/import.service'

/**
 * Step 5 of §20.1: the per-row decision.
 *
 * §20.4 gives exactly three choices and **a row with no decision blocks the
 * whole batch**. That is not a UI convention — `execute_import` refuses to run —
 * and the reason is that no default is safe here. Defaulting to IMPORT creates
 * the duplicates the review exists to prevent; defaulting to SKIP silently drops
 * real customers.
 *
 * **LINK_EXISTING never overwrites the existing record's fields.** It records the
 * legacy reference on the record that is already there and discards the row.
 */
const CHOICES: { value: ImportDecision; label: string; description: string }[] = [
  { value: 'IMPORT', label: 'Import anyway', description: 'Create a second record.' },
  { value: 'SKIP', label: 'Skip', description: 'Do not import this row.' },
  {
    value: 'LINK_EXISTING',
    label: 'Link to existing',
    description: 'Record the reference on the customer already here. Nothing is overwritten.',
  },
]

export function DuplicateDecisions({
  rows,
  existingNames,
  onDecide,
}: {
  rows: ImportRowRecord[]
  existingNames: Record<string, string>
  onDecide: (rowId: string, decision: ImportDecision) => Promise<void>
}) {
  const [decisions, setDecisions] = useState<Record<string, string | null>>(
    Object.fromEntries(rows.map((row) => [row.id, row.decision])),
  )
  const [pending, startTransition] = useTransition()

  if (rows.length === 0) return null

  const undecided = rows.filter((row) => !decisions[row.id]).length

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {undecided === 0
          ? 'Every possible duplicate has a decision.'
          : `${undecided} of ${rows.length} still need a decision. The import cannot run until they all do.`}
      </p>

      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const label =
            row.raw.name || row.raw.full_name || `Row ${row.row_number}`
          const match = row.duplicate_of ? existingNames[row.duplicate_of] : undefined

          return (
            <li key={row.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  Row {row.row_number}: {label}
                </span>
                <Badge tone={row.status === 'DUPLICATE_EXACT' ? 'overdue' : 'at-risk'}>
                  {row.status === 'DUPLICATE_EXACT' ? 'Same phone or email' : 'Similar name'}
                </Badge>
              </div>

              {match ? (
                <p className="mb-2 text-sm text-muted-foreground">
                  Already in the system as <strong className="font-medium">{match}</strong>.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {CHOICES.map((choice) => (
                  <Button
                    key={choice.value}
                    type="button"
                    size="sm"
                    variant={decisions[row.id] === choice.value ? 'primary' : 'outline'}
                    disabled={pending}
                    title={choice.description}
                    onClick={() =>
                      startTransition(async () => {
                        await onDecide(row.id, choice.value)
                        setDecisions((current) => ({ ...current, [row.id]: choice.value }))
                      })
                    }
                  >
                    {choice.label}
                  </Button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
