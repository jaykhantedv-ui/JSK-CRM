'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state'
import {
  CONSTRUCTION_STAGE_LABELS, PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS, optionsFrom,
} from '@/lib/labels'
import { paiseToRupees } from '@/lib/money'
import type { ProjectRow } from '@/types/domain'

/**
 * The project form (§11.2).
 *
 * Required: name, customer, type. Everything else is optional, because a
 * salesperson standing at a half-built house does not yet know the built-up area
 * or the flooring date, and a form that demands them gets guesses (§5.5).
 */
export function ProjectForm({
  action,
  project,
  accountId,
  accountOptions,
  outletOptions,
  defaultOutletId,
  cities,
  submitLabel,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>
  project?: ProjectRow
  accountId?: string | null
  accountOptions: { value: string; label: string }[]
  outletOptions: { value: string; label: string }[]
  defaultOutletId: string | null
  cities: string[]
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE)
  const value = (field: string, fallback?: string | number | null) =>
    state.values?.[field] ?? (fallback === null || fallback === undefined ? '' : String(fallback))

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4" noValidate>
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="Site name" htmlFor="name" required error={state.fieldErrors.name}>
        <Input
          id="name"
          name="name"
          required
          placeholder="Ravi house — Perundurai"
          defaultValue={value('name', project?.name)}
        />
      </Field>

      {accountId || project ? (
        <input type="hidden" name="accountId" value={accountId ?? project?.account_id ?? ''} />
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
      )}

      <Field label="Type of site" htmlFor="projectType" required error={state.fieldErrors.projectType}>
        <Select
          id="projectType"
          name="projectType"
          required
          defaultValue={value('projectType', project?.project_type) || 'INDIVIDUAL_HOUSE'}
          options={optionsFrom(PROJECT_TYPE_LABELS)}
        />
      </Field>

      <Field label="Construction stage" htmlFor="constructionStage">
        <Select
          id="constructionStage"
          name="constructionStage"
          defaultValue={value('constructionStage', project?.construction_stage) || 'UNKNOWN'}
          options={optionsFrom(CONSTRUCTION_STAGE_LABELS)}
        />
      </Field>

      {project ? (
        <Field label="Status" htmlFor="status">
          <Select
            id="status"
            name="status"
            defaultValue={value('status', project.status)}
            options={optionsFrom(PROJECT_STATUS_LABELS)}
          />
        </Field>
      ) : null}

      <Field label="Site address" htmlFor="siteAddress">
        <Textarea id="siteAddress" name="siteAddress" rows={2} defaultValue={value('siteAddress', project?.site_address)} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Town" htmlFor="city">
          <Select
            id="city"
            name="city"
            defaultValue={value('city', project?.city)}
            placeholder="Not recorded"
            options={cities.map((entry) => ({ value: entry, label: entry }))}
          />
        </Field>
        <Field label="Area" htmlFor="area">
          <Input id="area" name="area" defaultValue={value('area', project?.area)} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Built-up area (sq ft)" htmlFor="builtupAreaSqft" error={state.fieldErrors.builtupAreaSqft}>
          <Input id="builtupAreaSqft" name="builtupAreaSqft" inputMode="numeric" defaultValue={value('builtupAreaSqft', project?.builtup_area_sqft)} />
        </Field>
        <Field label="Floors" htmlFor="floors" error={state.fieldErrors.floors}>
          <Input id="floors" name="floors" inputMode="numeric" defaultValue={value('floors', project?.floors)} />
        </Field>
        <Field label="Bathrooms" htmlFor="bathrooms" error={state.fieldErrors.bathrooms}>
          <Input id="bathrooms" name="bathrooms" inputMode="numeric" defaultValue={value('bathrooms', project?.bathrooms)} />
        </Field>
      </div>

      <Field label="Expected flooring date" htmlFor="expectedFlooringDate" hint="When they expect to start laying floors.">
        <Input id="expectedFlooringDate" name="expectedFlooringDate" type="date" defaultValue={value('expectedFlooringDate', project?.expected_flooring_date)} />
      </Field>

      <Field label="Estimated site value" htmlFor="estimatedValue" hint="In rupees. The whole site, across every category.">
        <Input
          id="estimatedValue"
          name="estimatedValue"
          inputMode="decimal"
          defaultValue={value(
            'estimatedValue',
            project?.estimated_value === null || project?.estimated_value === undefined
              ? null
              : paiseToRupees(project.estimated_value),
          )}
        />
      </Field>

      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={3} defaultValue={value('notes', project?.notes)} />
      </Field>

      <Field label="Branch" htmlFor="outletId" required error={state.fieldErrors.outletId}>
        <Select
          id="outletId"
          name="outletId"
          required
          defaultValue={value('outletId', project?.outlet_id) || defaultOutletId || ''}
          placeholder="Choose a branch"
          options={outletOptions}
        />
      </Field>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}
