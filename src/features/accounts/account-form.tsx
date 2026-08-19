'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state'
import {
  ACCOUNT_STATUS_LABELS, ACCOUNT_TYPE_LABELS, LEAD_SOURCE_LABELS, optionsFrom,
} from '@/lib/labels'
import type { AccountRow } from '@/types/domain'

/**
 * The full customer form — create and edit (§12.2 `/accounts/new`, `/accounts/:id/edit`).
 *
 * Single column, validate on blur, errors inline, **never lose entered data**
 * (§12.7). Every failed submit re-renders from `state.values`.
 *
 * The fast path for a walk-in is `QuickCreateForm`; this is the one that carries
 * address, GSTIN and the rest, reached from the detail page.
 */
export function AccountForm({
  action,
  account,
  outlets,
  defaultOutletId,
  cities,
  submitLabel,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>
  account?: AccountRow
  outlets: { value: string; label: string }[]
  defaultOutletId: string | null
  cities: string[]
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE)
  const value = (field: string, fallback?: string | null) => state.values?.[field] ?? fallback ?? ''

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4" noValidate>
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="Name" htmlFor="name" required error={state.fieldErrors.name}>
        <Input id="name" name="name" required defaultValue={value('name', account?.name)} />
      </Field>

      <Field label="Customer type" htmlFor="accountType" required error={state.fieldErrors.accountType}>
        <Select
          id="accountType"
          name="accountType"
          required
          defaultValue={value('accountType', account?.account_type) || 'HOMEOWNER'}
          options={optionsFrom(ACCOUNT_TYPE_LABELS)}
        />
      </Field>

      <Field
        label="Phone"
        htmlFor="phone"
        error={state.fieldErrors.phone}
        hint="A customer needs either a phone number or an email."
      >
        <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={value('phone', account?.phone)} />
      </Field>

      <Field label="Alternate phone" htmlFor="altPhone" error={state.fieldErrors.altPhone}>
        <Input id="altPhone" name="altPhone" type="tel" inputMode="tel" defaultValue={value('altPhone', account?.alt_phone)} />
      </Field>

      <Field label="WhatsApp number" htmlFor="whatsappPhone" error={state.fieldErrors.whatsappPhone} hint="Only if it differs from the phone above.">
        <Input id="whatsappPhone" name="whatsappPhone" type="tel" inputMode="tel" defaultValue={value('whatsappPhone', account?.whatsapp_phone)} />
      </Field>

      <Field label="Email" htmlFor="email" error={state.fieldErrors.email}>
        <Input id="email" name="email" type="email" defaultValue={value('email', account?.email)} />
      </Field>

      <Field label="Town" htmlFor="city">
        <Select
          id="city"
          name="city"
          defaultValue={value('city', account?.city)}
          placeholder="Not recorded"
          options={cities.map((entry) => ({ value: entry, label: entry }))}
        />
      </Field>

      <Field label="Area" htmlFor="area">
        <Input id="area" name="area" defaultValue={value('area', account?.area)} />
      </Field>

      <Field label="Address" htmlFor="address">
        <Textarea id="address" name="address" rows={2} defaultValue={value('address', account?.address)} />
      </Field>

      <Field label="How did they reach us?" htmlFor="source">
        <Select
          id="source"
          name="source"
          defaultValue={value('source', account?.source) || 'WALK_IN'}
          options={optionsFrom(LEAD_SOURCE_LABELS)}
        />
      </Field>

      {account ? (
        <Field label="Status" htmlFor="status" error={state.fieldErrors.status}>
          <Select
            id="status"
            name="status"
            defaultValue={value('status', account.status)}
            options={optionsFrom(ACCOUNT_STATUS_LABELS)}
          />
        </Field>
      ) : null}

      <Field label="GSTIN" htmlFor="gstin" error={state.fieldErrors.gstin}>
        <Input id="gstin" name="gstin" defaultValue={value('gstin', account?.gstin)} />
      </Field>

      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={3} defaultValue={value('notes', account?.notes)} />
      </Field>

      <Field label="Branch" htmlFor="outletId" required error={state.fieldErrors.outletId}>
        <Select
          id="outletId"
          name="outletId"
          required
          defaultValue={value('outletId', account?.outlet_id) || defaultOutletId || ''}
          placeholder="Choose a branch"
          options={outlets}
        />
      </Field>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}
