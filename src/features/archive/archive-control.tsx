'use client'

import { Archive, TriangleAlert } from 'lucide-react'
import { useActionState, useState } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state'
import type { ArchivePreview } from '@/services/archive.service'

/**
 * C-3's four steps, as one control: **preview → display → confirm → archive.**
 *
 * The preview is computed on the server from real rows and passed in; this
 * DISPLAYS it and takes the confirmation. There is no step where a child record
 * is opted in or out — §8.8 archives the customer and its opportunities,
 * projects and contacts as one operation, because a customer whose opportunities
 * stayed live would keep counting towards the pipeline, which is the bug
 * archiving exists to prevent.
 *
 * **What it says about activities is as important as what it says about
 * children.** People hesitate to archive because they think they are deleting
 * history; they are not, and the panel says so.
 */
export function ArchiveControl({
  preview,
  action,
  label = 'Archive',
}: {
  preview: ArchivePreview
  action: (previous: FormState, formData: FormData) => Promise<FormState>
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE)

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Archive className="size-4" aria-hidden />
        {label}
      </Button>
    )
  }

  const { children } = preview
  const cascades = children.opportunities + children.projects + children.contacts > 0

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-border p-3">
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
        <div className="text-sm">
          <p className="font-medium">Archive {preview.name}?</p>
          <p className="text-muted-foreground">
            It disappears from lists, dashboards and the pipeline. Nothing is deleted, and you can
            restore it from the archive.
          </p>
        </div>
      </div>

      {cascades ? (
        <div className="rounded-md bg-muted/50 p-3 text-sm">
          <p className="mb-1 font-medium">This also archives:</p>
          <ul className="list-inside list-disc text-muted-foreground">
            {children.opportunities > 0 ? (
              <li>
                {children.opportunities} {children.opportunities === 1 ? 'opportunity' : 'opportunities'}
              </li>
            ) : null}
            {children.projects > 0 ? (
              <li>
                {children.projects} {children.projects === 1 ? 'project' : 'projects'}
              </li>
            ) : null}
            {children.contacts > 0 ? (
              <li>
                {children.contacts} {children.contacts === 1 ? 'contact' : 'contacts'}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {preview.pipelineValueRemovedPaise > 0 ? (
        <p className="text-sm">
          <MoneyText paise={preview.pipelineValueRemovedPaise} /> leaves the active pipeline.
        </p>
      ) : null}

      {preview.activitiesRetained > 0 ? (
        <p className="text-sm text-muted-foreground">
          {preview.activitiesRetained}{' '}
          {preview.activitiesRetained === 1 ? 'activity stays' : 'activities stay'} exactly where
          they are. History is never archived.
        </p>
      ) : null}

      <Field label="Reason (optional)" htmlFor="reason">
        <Input id="reason" name="reason" placeholder="Duplicate record, customer moved away…" />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? 'Archiving…' : 'Yes, archive'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Restore. One button — restoring is not a destructive act and needs no ceremony. */
export function RestoreControl({
  action,
  name,
}: {
  action: (previous: FormState) => Promise<FormState>
  name: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE)

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? 'Restoring…' : 'Restore'}
      </Button>
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
      <span className="sr-only">{name}</span>
    </form>
  )
}
