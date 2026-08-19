'use client'

import { useActionState, useState, useTransition } from 'react'

import { DuplicateWarning } from '@/components/shared/duplicate-warning'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import type { DuplicateMatch } from '@/lib/duplicates'
import { IDLE_FORM_STATE } from '@/lib/form-state'
import {
  ACCOUNT_TYPE_LABELS, LEAD_SOURCE_LABELS, optionsFrom,
} from '@/lib/labels'
import { NEXT_ACTION_LABELS, quickDates } from '@/lib/next-action'
import { CATEGORY_LABELS } from '@/lib/opportunity/title'
import { checkDuplicatesAction, createAccountWithOpportunityAction } from './actions'

/**
 * §11.1 — new customer and their first enquiry, in one screen. **Target: sixty
 * seconds on a phone.**
 *
 * Six required fields and nothing else (§12.1 — create forms show 6–7 fields;
 * everything else is added from the detail page afterwards). Address, GSTIN and
 * the rest are deliberately absent: a salesperson standing in front of a customer
 * types the minimum and gets back to selling.
 *
 * **A contact is never created here.** A homeowner is one person and the account
 * carries their number (§5.4).
 *
 * Duplicate detection runs on phone blur and renders inline. It **warns and never
 * blocks** — the Save button below it is enabled the entire time (§8.9).
 */
export function QuickCreateForm({
  outlets,
  defaultOutletId,
  cities,
}: {
  outlets: { value: string; label: string }[]
  defaultOutletId: string | null
  cities: string[]
}) {
  const [state, formAction, pending] = useActionState(createAccountWithOpportunityAction, IDLE_FORM_STATE)
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])
  const [, startTransition] = useTransition()
  const [nextActionDate, setNextActionDate] = useState('')
  const [name, setName] = useState(state.values?.name ?? '')
  const [city, setCity] = useState(state.values?.city ?? '')

  const dates = quickDates()

  const lookForDuplicates = (overrides: { phone?: string; email?: string }) => {
    startTransition(async () => {
      const matches = await checkDuplicatesAction({
        phone: overrides.phone ?? null,
        email: overrides.email ?? null,
        name,
        city,
      })
      setDuplicates(matches)
    })
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="Phone" htmlFor="phone" error={state.fieldErrors.phone} hint="Or add an email below.">
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={state.values?.phone}
          onBlur={(event) => lookForDuplicates({ phone: event.target.value })}
        />
      </Field>

      <Field label="Name" htmlFor="name" required error={state.fieldErrors.name}>
        <Input
          id="name"
          name="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => lookForDuplicates({})}
        />
      </Field>

      {/* Advisory only — it never disables Save (§8.9). */}
      <DuplicateWarning matches={duplicates} />

      <Field label="Customer type" htmlFor="accountType" required error={state.fieldErrors.accountType}>
        <Select
          id="accountType"
          name="accountType"
          required
          defaultValue={state.values?.accountType ?? 'HOMEOWNER'}
          options={optionsFrom(ACCOUNT_TYPE_LABELS)}
        />
      </Field>

      <Field label="Asking about" htmlFor="category" required error={state.fieldErrors.category}>
        <Select
          id="category"
          name="category"
          required
          defaultValue={state.values?.category ?? 'TILES'}
          options={optionsFrom(CATEGORY_LABELS)}
        />
      </Field>

      <Field
        label="Estimated value"
        htmlFor="estimatedValue"
        required
        error={state.fieldErrors.estimatedValue ?? state.fieldErrors.estimatedValuePaise}
        hint="In rupees. A rough figure is fine — it can be corrected later."
      >
        <Input
          id="estimatedValue"
          name="estimatedValue"
          inputMode="decimal"
          required
          placeholder="1,50,000"
          defaultValue={state.values?.estimatedValue}
        />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">What happens next?</legend>
        <p className="text-xs text-muted-foreground">
          Leave this blank if you cannot say yet — it will show up on Today as needing an action.
        </p>
        <div className="flex flex-wrap gap-2">
          {dates.map((option) => (
            <Button
              key={option.date}
              variant={nextActionDate === option.date ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setNextActionDate(option.date)}
            >
              {option.label}
            </Button>
          ))}
          {nextActionDate ? (
            <Button variant="ghost" size="sm" onClick={() => setNextActionDate('')}>
              Clear
            </Button>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            aria-label="Next action type"
            name="nextAction"
            defaultValue={state.values?.nextAction ?? 'CALL'}
            options={optionsFrom(NEXT_ACTION_LABELS)}
          />
          <Input
            aria-label="Next action date"
            name="nextActionDate"
            type="date"
            value={nextActionDate}
            onChange={(event) => setNextActionDate(event.target.value)}
          />
        </div>
        {state.fieldErrors.nextActionDate ? (
          <p role="alert" className="text-sm text-destructive">
            {state.fieldErrors.nextActionDate}
          </p>
        ) : null}
      </fieldset>

      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">More details</summary>
        <div className="mt-3 flex flex-col gap-3">
          <Field label="Email" htmlFor="email" error={state.fieldErrors.email}>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={state.values?.email}
              onBlur={(event) => lookForDuplicates({ email: event.target.value })}
            />
          </Field>
          <Field label="Town" htmlFor="city">
            <Select
              id="city"
              name="city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="Not recorded"
              options={cities.map((value) => ({ value, label: value }))}
            />
          </Field>
          <Field label="Area" htmlFor="area">
            <Input id="area" name="area" defaultValue={state.values?.area} />
          </Field>
          <Field label="How did they reach us?" htmlFor="source">
            <Select
              id="source"
              name="source"
              defaultValue={state.values?.source ?? 'WALK_IN'}
              options={optionsFrom(LEAD_SOURCE_LABELS)}
            />
          </Field>
          <Field label="Notes" htmlFor="notes" hint="Saved as the first entry in their history.">
            <Textarea id="notes" name="notes" rows={3} defaultValue={state.values?.notes} />
          </Field>
        </div>
      </details>

      {outlets.length > 1 || !defaultOutletId ? (
        <Field label="Branch" htmlFor="outletId" required error={state.fieldErrors.outletId}>
          <Select
            id="outletId"
            name="outletId"
            required
            defaultValue={state.values?.outletId ?? defaultOutletId ?? ''}
            placeholder="Choose a branch"
            options={outlets}
          />
        </Field>
      ) : (
        <input type="hidden" name="outletId" value={defaultOutletId} />
      )}

      {/* §12.6 — disabled button plus a label while saving. No optimistic UI in V1. */}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Saving…' : 'Save customer and enquiry'}
      </Button>
    </form>
  )
}
