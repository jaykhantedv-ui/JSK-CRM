'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state'
import { LEAD_SOURCE_LABELS, QUOTATION_STATUS_LABELS, optionsFrom } from '@/lib/labels'
import { paiseToRupees } from '@/lib/money'
import { NEXT_ACTION_LABELS, quickDates } from '@/lib/next-action'
import { CATEGORY_LABELS } from '@/lib/opportunity/title'
import type { OpportunityRow } from '@/types/domain'

/**
 * The opportunity form — create (§11.3) and edit.
 *
 * On create the title is left blank on purpose: the service generates
 * `{project or customer} — {category} — {MMM yy}` (§8.4) and the salesperson can
 * rename it afterwards. Asking for a name before the deal is described is a field
 * nobody wants to fill in.
 *
 * **Stage and owner are not here.** They move through the stage control and the
 * reassign control, so every change of either is audited with its reason.
 */
export function OpportunityForm({
  action,
  opportunity,
  accountId,
  defaultProjectId,
  accountOptions,
  projectOptions,
  outletOptions,
  defaultOutletId,
  submitLabel,
  mode,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>
  opportunity?: OpportunityRow
  accountId?: string | null
  defaultProjectId?: string | null
  accountOptions: { value: string; label: string }[]
  projectOptions: { value: string; label: string }[]
  outletOptions: { value: string; label: string }[]
  defaultOutletId: string | null
  submitLabel: string
  mode: 'create' | 'edit'
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE)
  const value = (field: string, fallback?: string | null) => state.values?.[field] ?? fallback ?? ''
  const rupees = (paise: number | null | undefined) =>
    paise === null || paise === undefined ? '' : String(paiseToRupees(paise))

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4" noValidate>
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {mode === 'create' ? (
        accountId ? (
          <input type="hidden" name="accountId" value={accountId} />
        ) : (
          <Field label="Customer" htmlFor="accountId" required error={state.fieldErrors.accountId}>
            <Select
              id="accountId"
              name="accountId"
              required
              placeholder="Choose a customer"
              options={accountOptions}
            />
          </Field>
        )
      ) : null}

      <Field
        label="Site"
        htmlFor="projectId"
        hint="Optional. A repeat trade order may have no site — link one when you know it."
      >
        <Select
          id="projectId"
          name="projectId"
          defaultValue={value('projectId', opportunity?.project_id ?? defaultProjectId)}
          placeholder="No site linked"
          options={projectOptions}
        />
      </Field>

      <Field label="Category" htmlFor="category" required error={state.fieldErrors.category}>
        <Select
          id="category"
          name="category"
          required
          defaultValue={value('category', opportunity?.category) || 'TILES'}
          options={optionsFrom(CATEGORY_LABELS)}
        />
      </Field>

      <Field
        label="Estimated value"
        htmlFor="estimatedValue"
        required
        error={state.fieldErrors.estimatedValue ?? state.fieldErrors.estimatedValuePaise}
        hint="In rupees."
      >
        <Input
          id="estimatedValue"
          name="estimatedValue"
          inputMode="decimal"
          required
          defaultValue={value('estimatedValue', rupees(opportunity?.estimated_value))}
        />
      </Field>

      <Field
        label="Title"
        htmlFor="title"
        required={mode === 'edit'}
        error={state.fieldErrors.title}
        hint={mode === 'create' ? 'Leave blank and one will be generated for you.' : undefined}
      >
        <Input
          id="title"
          name="title"
          required={mode === 'edit'}
          defaultValue={value('title', opportunity?.title)}
        />
      </Field>

      <Field label="Material notes" htmlFor="materialNotes">
        <Textarea
          id="materialNotes"
          name="materialNotes"
          rows={2}
          placeholder="600x600 vitrified, double charge, light shades"
          defaultValue={value('materialNotes', opportunity?.material_notes)}
        />
      </Field>

      <Field label="Expected close date" htmlFor="expectedCloseDate">
        <Input
          id="expectedCloseDate"
          name="expectedCloseDate"
          type="date"
          defaultValue={value('expectedCloseDate', opportunity?.expected_close_date)}
        />
      </Field>

      {mode === 'create' ? (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">What happens next?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                aria-label="Next action"
                name="nextAction"
                defaultValue="CALL"
                options={optionsFrom(NEXT_ACTION_LABELS)}
              />
              <Input
                aria-label="Next action date"
                name="nextActionDate"
                type="date"
                defaultValue={quickDates()[0].date}
              />
            </div>
            {state.fieldErrors.nextActionDate ? (
              <p role="alert" className="text-sm text-destructive">
                {state.fieldErrors.nextActionDate}
              </p>
            ) : null}
          </fieldset>

          <Field label="How did they reach us?" htmlFor="source">
            <Select
              id="source"
              name="source"
              defaultValue="WALK_IN"
              options={optionsFrom(LEAD_SOURCE_LABELS)}
            />
          </Field>
        </>
      ) : (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Quotation</summary>
          <div className="mt-3 flex flex-col gap-3">
            <Field label="Quotation reference" htmlFor="quotationRef" error={state.fieldErrors.quotationRef}>
              <Input id="quotationRef" name="quotationRef" defaultValue={value('quotationRef', opportunity?.quotation_ref)} />
            </Field>
            <Field label="Quotation date" htmlFor="quotationDate">
              <Input id="quotationDate" name="quotationDate" type="date" defaultValue={value('quotationDate', opportunity?.quotation_date)} />
            </Field>
            <Field label="Quoted value" htmlFor="quotedValue" hint="In rupees.">
              <Input id="quotedValue" name="quotedValue" inputMode="decimal" defaultValue={value('quotedValue', rupees(opportunity?.quoted_value))} />
            </Field>
            <Field label="Quotation status" htmlFor="quotationStatus">
              <Select
                id="quotationStatus"
                name="quotationStatus"
                defaultValue={value('quotationStatus', opportunity?.quotation_status) || 'NONE'}
                options={optionsFrom(QUOTATION_STATUS_LABELS)}
              />
            </Field>
            <Field label="Valid until" htmlFor="quotationValidUntil">
              <Input id="quotationValidUntil" name="quotationValidUntil" type="date" defaultValue={value('quotationValidUntil', opportunity?.quotation_valid_until)} />
            </Field>
            <Field label="Competitor" htmlFor="competitor">
              <Input id="competitor" name="competitor" defaultValue={value('competitor', opportunity?.competitor)} />
            </Field>
          </div>
        </details>
      )}

      {mode === 'create' ? (
        outletOptions.length > 1 || !defaultOutletId ? (
          <Field label="Branch" htmlFor="outletId" required error={state.fieldErrors.outletId}>
            <Select
              id="outletId"
              name="outletId"
              required
              defaultValue={value('outletId', defaultOutletId)}
              placeholder="Choose a branch"
              options={outletOptions}
            />
          </Field>
        ) : (
          <input type="hidden" name="outletId" value={defaultOutletId} />
        )
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}
