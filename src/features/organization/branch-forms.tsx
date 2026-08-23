'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { IDLE_FORM_STATE } from '@/lib/form-state'
import { addBranchAction, setBranchActiveAction } from '@/features/organization/actions'

/**
 * Opening a branch, and closing one (ADR-016).
 *
 * A branch is a row with an identity, so it can be renamed, staffed and closed
 * without losing the history filed against it. Closing is the mechanism the pilot
 * uses for Chithode: the branch exists, and no selector offers it.
 */
export function BranchForm() {
  const [state, formAction, pending] = useActionState(addBranchAction, IDLE_FORM_STATE)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Field label="Name" htmlFor="name" required error={state.fieldErrors.name}>
        <Input id="name" name="name" required defaultValue={state.values?.name ?? ''} />
      </Field>
      <Field
        label="Short code"
        htmlFor="code"
        required
        hint="Two to sixteen characters. Shown beside the name."
        error={state.fieldErrors.code}
      >
        <Input id="code" name="code" required defaultValue={state.values?.code ?? ''} />
      </Field>
      <Field label="Town" htmlFor="city" error={state.fieldErrors.city}>
        <Input id="city" name="city" defaultValue={state.values?.city ?? ''} />
      </Field>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add branch'}
      </Button>
    </form>
  )
}

export function BranchToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [state, formAction, pending] = useActionState(setBranchActiveAction, IDLE_FORM_STATE)

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={String(!isActive)} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {isActive ? 'Close' : 'Reopen'}
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  )
}
