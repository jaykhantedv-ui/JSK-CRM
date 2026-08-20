'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { setTargetAction } from '@/features/management/target-actions'
import { IDLE_FORM_STATE } from '@/lib/form-state'
import { paiseToRupees } from '@/lib/money'

/**
 * One row of the target editor (§10).
 *
 * A form per scope rather than one big form: a manager setting a branch figure
 * should not be able to overwrite a colleague's person-level figure by
 * submitting a stale page, and one row per submit makes that impossible.
 *
 * **No Supabase call happens here.** The submit goes to a Server Action, which
 * calls the service (CLAUDE.md §7). A Client Component in this application never
 * writes to the database.
 */
export function TargetForm({
  periodMonth,
  outletId,
  userId,
  label,
  currentPaise,
  hint,
}: {
  periodMonth: string
  outletId: string | null
  userId: string | null
  label: string
  currentPaise: number | null
  hint?: string
}) {
  const [state, formAction, pending] = useActionState(setTargetAction, IDLE_FORM_STATE)
  const inputId = `target-${outletId ?? 'company'}-${userId ?? 'all'}`

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="periodMonth" value={periodMonth} />
      <input type="hidden" name="outletId" value={outletId ?? ''} />
      <input type="hidden" name="userId" value={userId ?? ''} />

      <Field
        label={label}
        htmlFor={inputId}
        hint={hint}
        error={state.fieldErrors.targetPaise ?? state.error}
        className="min-w-48 flex-1"
      >
        <Input
          id={inputId}
          name="targetRupees"
          inputMode="decimal"
          // Paise become rupees for display, the same conversion in reverse — and
          // the only place either direction happens (CLAUDE.md §9).
          defaultValue={currentPaise === null ? '' : String(paiseToRupees(currentPaise))}
          placeholder="Target in rupees"
          aria-describedby={hint ? `${inputId}-hint` : undefined}
        />
      </Field>

      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>

      {state.ok ? (
        <p role="status" className="text-xs text-state-won">
          Saved
        </p>
      ) : null}
    </form>
  )
}
