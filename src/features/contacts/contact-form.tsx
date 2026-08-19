'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state'
import {
  CONTACT_CHANNEL_LABELS, INFLUENCE_LABELS, STAKEHOLDER_ROLE_LABELS, optionsFrom,
} from '@/lib/labels'
import type { ContactRow } from '@/types/domain'

/**
 * The contact form (§5.4).
 *
 * A contact is an **additional person**, never a required step. The customer list
 * is where a homeowner lives; this is for the architect, the site engineer and
 * the spouse who actually chooses the tile.
 *
 * "Linked account" is the company this person works for when that company is
 * itself a customer — the referral chain §5.4 asks for, without a second table.
 */
export function ContactForm({
  action,
  contact,
  accountOptions,
  submitLabel,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>
  contact?: ContactRow
  accountOptions: { value: string; label: string }[]
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

      <Field label="Name" htmlFor="fullName" required error={state.fieldErrors.fullName}>
        <Input id="fullName" name="fullName" required defaultValue={value('fullName', contact?.full_name)} />
      </Field>

      <Field
        label="Phone"
        htmlFor="phone"
        error={state.fieldErrors.phone}
        hint="A contact needs either a phone number or an email."
      >
        <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={value('phone', contact?.phone)} />
      </Field>

      <Field label="Alternate phone" htmlFor="altPhone" error={state.fieldErrors.altPhone}>
        <Input id="altPhone" name="altPhone" type="tel" inputMode="tel" defaultValue={value('altPhone', contact?.alt_phone)} />
      </Field>

      <Field label="Email" htmlFor="email" error={state.fieldErrors.email}>
        <Input id="email" name="email" type="email" defaultValue={value('email', contact?.email)} />
      </Field>

      <Field label="Customer they belong to" htmlFor="accountId" hint="Optional.">
        <Select
          id="accountId"
          name="accountId"
          defaultValue={value('accountId', contact?.account_id)}
          placeholder="Not linked to a customer"
          options={accountOptions}
        />
      </Field>

      <Field
        label="Company they work for"
        htmlFor="linkedAccountId"
        hint="If their firm is also a customer of ours."
      >
        <Select
          id="linkedAccountId"
          name="linkedAccountId"
          defaultValue={value('linkedAccountId', contact?.linked_account_id)}
          placeholder="None"
          options={accountOptions}
        />
      </Field>

      <Field label="Role" htmlFor="role" required error={state.fieldErrors.role}>
        <Select
          id="role"
          name="role"
          required
          defaultValue={value('role', contact?.role) || 'OTHER'}
          options={optionsFrom(STAKEHOLDER_ROLE_LABELS)}
        />
      </Field>

      <Field label="Influence" htmlFor="influence">
        <Select
          id="influence"
          name="influence"
          defaultValue={value('influence', contact?.influence) || 'INFLUENCER'}
          options={optionsFrom(INFLUENCE_LABELS)}
        />
      </Field>

      <Field label="Prefers to be contacted by" htmlFor="preferredChannel">
        <Select
          id="preferredChannel"
          name="preferredChannel"
          defaultValue={value('preferredChannel', contact?.preferred_channel) || 'CALL'}
          options={optionsFrom(CONTACT_CHANNEL_LABELS)}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isReferralSource"
          value="1"
          defaultChecked={contact?.is_referral_source ?? false}
          className="size-4"
        />
        Sends us business
      </label>

      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={3} defaultValue={value('notes', contact?.notes)} />
      </Field>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}
