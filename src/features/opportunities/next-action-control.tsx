'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'

import { NextActionChip } from '@/components/shared/next-action-chip'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { IDLE_FORM_STATE } from '@/lib/form-state'
import { NEXT_ACTION_LABELS, quickDates } from '@/lib/next-action'
import { optionsFrom } from '@/lib/labels'
import type { NextActionType } from '@/types/domain'
import { updateNextActionAction } from './actions'

/**
 * Inline next-action editing (§11.6).
 *
 * Quick-date buttons first, a picker behind them, and "Can't say yet" as an equal
 * option. Typing a date on a phone is the slowest step in the whole product, so
 * three of the four common answers are one tap.
 *
 * **Hidden when the opportunity is closed** (§11.6). A won deal has no next
 * action, and offering one would put it back in somebody's overdue list.
 */
export function NextActionControl({
  opportunityId,
  stage,
  nextAction,
  nextActionDate,
  nextActionNote,
}: {
  opportunityId: string
  stage: string
  nextAction: NextActionType | null
  nextActionDate: string | null
  nextActionNote: string | null
}) {
  const boundAction = updateNextActionAction.bind(null, opportunityId)
  const [state, formAction, pending] = useActionState(boundAction, IDLE_FORM_STATE)
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(nextActionDate ?? '')
  const router = useRouter()

  useEffect(() => {
    if (state.ok) {
      setEditing(false)
      router.refresh()
    }
  }, [state.ok, router])

  if (stage === 'won' || stage === 'lost') return null

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <NextActionChip nextAction={nextAction} nextActionDate={nextActionDate} stage={stage} />
        {nextActionNote ? <span className="text-xs text-muted-foreground">{nextActionNote}</span> : null}
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          {nextActionDate ? 'Change' : 'Set next action'}
        </Button>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-border p-3">
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {quickDates().map((option) => (
          <Button
            key={option.date}
            variant={date === option.date ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setDate(option.date)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          aria-label="Next action"
          name="nextAction"
          defaultValue={nextAction ?? 'CALL'}
          options={optionsFrom(NEXT_ACTION_LABELS)}
        />
        <Input
          aria-label="Next action date"
          name="nextActionDate"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>

      <Input
        aria-label="Note"
        name="nextActionNote"
        placeholder="Optional note"
        defaultValue={nextActionNote ?? ''}
      />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {/* §8.3 — clearing is a decision, and the exception list is the control. */}
        <Button
          type="submit"
          name="clearNextAction"
          value="1"
          variant="outline"
          size="sm"
          disabled={pending}
        >
          Can&apos;t say yet
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
