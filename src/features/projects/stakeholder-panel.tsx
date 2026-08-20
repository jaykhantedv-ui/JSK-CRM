'use client'

import { Star, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { IDLE_FORM_STATE } from '@/lib/form-state'
import { INFLUENCE_LABELS, STAKEHOLDER_ROLE_LABELS, optionsFrom } from '@/lib/labels'
import type { StakeholderWithTarget } from '@/types/domain'
import { addStakeholderAction, removeStakeholderAction, setPrimaryStakeholderAction } from './actions'

/**
 * "People on this project" (§11.4, §4.4).
 *
 * §4.4 makes this the case the schema exists for: a house has an owner, a spouse,
 * an architect, a contractor and a mason, and the salesperson has to see all of
 * them against one site. Adding somebody either picks an existing contact or
 * creates one inline — leaving the page to make a contact would break the flow.
 *
 * Removing a person is the **one approved hard delete** in the whole application
 * (ADR-004), because the row is a link and not a record. Nothing else here — and
 * nothing anywhere else — deletes anything.
 */
export function StakeholderPanel({
  projectId,
  stakeholders,
  contactOptions,
}: {
  projectId: string
  stakeholders: StakeholderWithTarget[]
  contactOptions: { value: string; label: string }[]
}) {
  const boundAdd = addStakeholderAction.bind(null, projectId)
  const [state, formAction, pending] = useActionState(boundAdd, IDLE_FORM_STATE)
  const [adding, setAdding] = useState(false)
  const [mode, setMode] = useState<'existing' | 'new'>(contactOptions.length > 0 ? 'existing' : 'new')
  const [, startTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    if (state.ok) {
      setAdding(false)
      router.refresh()
    }
  }, [state.ok, router])

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn()
      router.refresh()
    })

  return (
    <div className="flex flex-col gap-3">
      {stakeholders.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody added yet. Add the owner, the architect, the contractor — whoever decides here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {stakeholders.map((row) => {
            const name = row.contact?.full_name ?? row.account?.name ?? 'Unknown'
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-sm font-medium">
                    {row.is_primary ? <Star className="size-3 fill-current" aria-hidden /> : null}
                    {name}
                    {row.is_primary ? <span className="text-xs font-normal text-muted-foreground">Primary</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {STAKEHOLDER_ROLE_LABELS[row.role]} · {INFLUENCE_LABELS[row.influence]}
                    {row.contact?.phone ? ` · ${row.contact.phone}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!row.is_primary ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => run(() => setPrimaryStakeholderAction(projectId, row.id))}
                    >
                      Make primary
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${name} from this project`}
                    onClick={() => run(() => removeStakeholderAction(projectId, row.id))}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!adding ? (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          Add a person
        </Button>
      ) : (
        <form action={formAction} className="flex flex-col gap-3 rounded-md border border-border p-3">
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              variant={mode === 'existing' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setMode('existing')}
              disabled={contactOptions.length === 0}
            >
              Existing contact
            </Button>
            <Button variant={mode === 'new' ? 'primary' : 'outline'} size="sm" onClick={() => setMode('new')}>
              New person
            </Button>
          </div>

          {mode === 'existing' ? (
            <Field label="Contact" htmlFor="contactId" required error={state.fieldErrors.contactId}>
              <Select id="contactId" name="contactId" required placeholder="Choose a contact" options={contactOptions} />
            </Field>
          ) : (
            <>
              <Field label="Name" htmlFor="newContactName" required error={state.fieldErrors.fullName}>
                <Input id="newContactName" name="newContactName" required />
              </Field>
              <Field label="Phone" htmlFor="newContactPhone" error={state.fieldErrors.phone} hint="A phone number or an email is needed.">
                <Input id="newContactPhone" name="newContactPhone" type="tel" inputMode="tel" />
              </Field>
              <Field label="Email" htmlFor="newContactEmail" error={state.fieldErrors.email}>
                <Input id="newContactEmail" name="newContactEmail" type="email" />
              </Field>
            </>
          )}

          <Field label="Role on this site" htmlFor="role" required error={state.fieldErrors.role}>
            <Select id="role" name="role" required defaultValue="OWNER_BUYER" options={optionsFrom(STAKEHOLDER_ROLE_LABELS)} />
          </Field>

          <Field label="Influence" htmlFor="influence">
            <Select id="influence" name="influence" defaultValue="INFLUENCER" options={optionsFrom(INFLUENCE_LABELS)} />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isPrimary" value="1" className="size-4" />
            Main point of contact for this site
          </label>

          <Field label="Notes" htmlFor="stakeholderNotes">
            <Textarea id="stakeholderNotes" name="notes" rows={2} />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Adding…' : 'Add'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
