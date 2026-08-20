'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state'

/**
 * Steps 6 and 8 of §20.1: run the import, and roll it back.
 *
 * **No progress bar.** ADR-012 keeps the import atomic and drops live per-100-row
 * progress: a bar that counts to 3,000 and then reports a rollback has told the
 * user something false three thousand times. The summary appears when the
 * transaction commits.
 */
export function RunImportControl({
  action,
  blocked,
  rowCount,
}: {
  action: (previous: FormState) => Promise<FormState>
  blocked: number
  rowCount: number
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE)

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending || blocked > 0}>
        {pending ? 'Importing…' : `Import ${rowCount.toLocaleString('en-IN')} rows`}
      </Button>

      {blocked > 0 ? (
        <p className="text-sm text-muted-foreground">
          {blocked} possible {blocked === 1 ? 'duplicate needs' : 'duplicates need'} a decision
          first.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Everything imports together or nothing does. This can take a moment for a large file.
        </p>
      )}
    </form>
  )
}

export function RollbackControl({
  action,
  eligible,
  reason,
  expiresAt,
}: {
  action: (previous: FormState) => Promise<FormState>
  eligible: boolean
  reason: string | null
  expiresAt: string | null
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE)

  if (!eligible) {
    return <p className="text-sm text-muted-foreground">{reason}</p>
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Rolling back archives every record this import created. Nothing is deleted, and they can
        be restored from the archive afterwards.
      </p>

      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Rolling back…' : 'Roll back this import'}
      </Button>

      {expiresAt ? (
        <p className="text-xs text-muted-foreground">
          Available until {new Date(expiresAt).toLocaleDateString('en-IN')}.
        </p>
      ) : null}
    </form>
  )
}
