'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Select, Textarea } from '@/components/ui/field'
import { IDLE_FORM_STATE } from '@/lib/form-state'
import { reassignOpportunityAction, reopenOpportunityAction } from './actions'

/**
 * Reassignment and reopen — **MANAGER/OWNER only** (§11.9, ADR-007).
 *
 * The server only renders this for a role that may use it, but that is a
 * courtesy: `opportunities_update`'s WITH CHECK is what actually stops a
 * salesperson, and the service refuses before the request is even made. A hidden
 * button is not a control (§15).
 */
export function ReassignControl({
  opportunityId,
  currentOwnerId,
  teammates,
}: {
  opportunityId: string
  currentOwnerId: string | null
  teammates: { value: string; label: string }[]
}) {
  const boundAction = reassignOpportunityAction.bind(null, opportunityId)
  const [state, formAction, pending] = useActionState(boundAction, IDLE_FORM_STATE)
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (state.ok) {
      setOpen(false)
      router.refresh()
    }
  }, [state.ok, router])

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Reassign
      </Button>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-border p-3">
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="New owner" htmlFor="ownerId" required error={state.fieldErrors.ownerId}>
        <Select
          id="ownerId"
          name="ownerId"
          required
          placeholder="Choose a salesperson"
          options={teammates.filter((option) => option.value !== currentOwnerId)}
        />
      </Field>

      <Field
        label="Reason"
        htmlFor="reason"
        required
        error={state.fieldErrors.reason}
        hint="Recorded on the opportunity's history. Activities keep whoever originally logged them."
      >
        <Textarea id="reason" name="reason" rows={2} required />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Reassigning…' : 'Reassign'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** ADR-007 — a mistaken win is corrected, never silently edited. */
export function ReopenControl({ opportunityId }: { opportunityId: string }) {
  const boundAction = reopenOpportunityAction.bind(null, opportunityId)
  const [state, formAction, pending] = useActionState(boundAction, IDLE_FORM_STATE)
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (state.ok) {
      setOpen(false)
      router.refresh()
    }
  }, [state.ok, router])

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Reopen
      </Button>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-border p-3">
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Field
        label="Why is this being reopened?"
        htmlFor="reopenReason"
        required
        error={state.fieldErrors.reason}
        hint="The original outcome stays on the record. Reopening returns it to Qualified."
      >
        <Textarea id="reopenReason" name="reason" rows={2} required />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Reopening…' : 'Reopen'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
