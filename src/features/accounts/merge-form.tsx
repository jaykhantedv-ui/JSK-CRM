'use client'

import { TriangleAlert } from 'lucide-react'
import { useActionState } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state'
import type { MergePreview } from '@/services/account.service'

/**
 * §8.9 — merge confirmation.
 *
 * **ADR-008 forbids claiming this is reversible, and the audit names
 * "always reversible via the audit trail" as a claim not to make.** So the
 * warning is unhedged: this cannot be undone. What the system does promise is
 * that the move is recorded — every opportunity that changes hands gets a
 * `MERGED` event carrying source, target and reason.
 *
 * The confirmation is a typed word rather than a checkbox. Merge is the most
 * destructive operation in the application and it is now provably one-way; a
 * checkbox is something people click past on the way to somewhere else.
 */
export function MergeForm({
  preview,
  action,
}: {
  preview: MergePreview
  action: (previous: FormState, formData: FormData) => Promise<FormState>
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE)
  const { moves } = preview

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
        <p className="flex items-start gap-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span>
            <strong className="font-medium">This cannot be undone.</strong> Merging is permanent in
            this version. Check both records carefully before you confirm.
          </span>
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Merging away</p>
          <p className="mt-1 font-medium">{preview.source.name}</p>
          <p className="text-sm text-muted-foreground">
            {preview.source.phone ?? preview.source.email ?? '—'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            This record is archived when the merge finishes.
          </p>
        </div>

        <div className="rounded-lg border-2 border-primary/40 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Keeping</p>
          <p className="mt-1 font-medium">{preview.target.name}</p>
          <p className="text-sm text-muted-foreground">
            {preview.target.phone ?? preview.target.email ?? '—'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Everything below moves here. Its own details are not changed.
          </p>
        </div>
      </div>

      <div className="rounded-md bg-muted/50 p-3 text-sm">
        <p className="mb-1 font-medium">What moves</p>
        <ul className="list-inside list-disc text-muted-foreground">
          <li>{moves.contacts} {moves.contacts === 1 ? 'contact' : 'contacts'}</li>
          <li>{moves.projects} {moves.projects === 1 ? 'project' : 'projects'}</li>
          <li>
            {moves.opportunities}{' '}
            {moves.opportunities === 1 ? 'opportunity' : 'opportunities'}
            {preview.pipelineValueMovedPaise > 0 ? (
              <>
                {' '}(<MoneyText paise={preview.pipelineValueMovedPaise} /> of pipeline)
              </>
            ) : null}
          </li>
          <li>
            {moves.activities} {moves.activities === 1 ? 'activity' : 'activities'} — the full
            history follows the customer
          </li>
        </ul>
      </div>

      <Field label="Why are you merging these?" htmlFor="reason" hint="Recorded against every opportunity that moves.">
        <Input id="reason" name="reason" placeholder="Same customer entered twice" />
      </Field>

      <Field
        label="Type MERGE to confirm"
        htmlFor="confirm"
        error={state.fieldErrors.confirm}
      >
        <Input id="confirm" name="confirm" autoComplete="off" placeholder="MERGE" required />
      </Field>

      <Button type="submit" variant="destructive" size="lg" disabled={pending}>
        {pending ? 'Merging…' : `Merge into ${preview.target.name}`}
      </Button>
    </form>
  )
}
