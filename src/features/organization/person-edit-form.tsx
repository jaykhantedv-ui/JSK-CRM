'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { IDLE_FORM_STATE } from '@/lib/form-state'
import { MANAGER_ROLE_FOR, ROLE_LABELS, type Role } from '@/lib/permissions'
import { updatePersonAction } from '@/features/organization/actions'
import type { BranchOption, ManagerOption } from '@/features/organization/person-form'

/**
 * Editing a person (ADR-040).
 *
 * **An UPDATE keyed on the id — never a create.** The id travels as a hidden
 * field and `updateUser` writes `.eq('id', …)`, so saving an edit cannot produce
 * a second row for the same person however many times it is submitted.
 *
 * The same narrowing rule as the add form, read from the same map: changing the
 * role re-offers only the people that role may report to. Email is deliberately
 * absent — it is the Auth account's identity, and changing it here would leave
 * the profile and the sign-in disagreeing about who somebody is.
 */
export function PersonEditForm({
  person,
  managers,
  branches,
}: {
  person: {
    id: string
    fullName: string
    phone: string | null
    email: string
    role: Role
    isActive: boolean
    managerId: string | null
    outletIds: string[]
  }
  managers: ManagerOption[]
  branches: BranchOption[]
}) {
  const [state, formAction, pending] = useActionState(updatePersonAction, IDLE_FORM_STATE)
  const [role, setRole] = useState<Role>(person.role)

  const requiredManagerRole = MANAGER_ROLE_FOR[role]
  // Never offer somebody themselves: the database refuses it, and a dropdown
  // that lets you pick it is a form that has to be told off.
  const eligible = managers.filter(
    (candidate) => candidate.role === requiredManagerRole && candidate.id !== person.id,
  )

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={person.id} />

      <Field label="Full name" htmlFor="fullName" required error={state.fieldErrors.fullName}>
        <Input
          id="fullName"
          name="fullName"
          required
          defaultValue={state.values?.fullName ?? person.fullName}
        />
      </Field>

      <Field label="Email" htmlFor="email" hint="Their sign-in address. Not editable here.">
        <Input id="email" value={person.email} readOnly disabled />
      </Field>

      <Field label="Phone" htmlFor="phone" error={state.fieldErrors.phone}>
        <Input id="phone" name="phone" defaultValue={state.values?.phone ?? person.phone ?? ''} />
      </Field>

      <Field label="Role" htmlFor="role" required error={state.fieldErrors.role}>
        <Select
          id="role"
          name="role"
          required
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          options={(Object.keys(ROLE_LABELS) as Role[]).map((value) => ({
            value,
            label: ROLE_LABELS[value],
          }))}
        />
      </Field>

      {requiredManagerRole === null ? (
        <p className="text-sm text-muted-foreground">The owner reports to nobody.</p>
      ) : (
        <Field
          label={requiredManagerRole === 'MANAGER' ? 'Sales Head' : 'Reports to'}
          htmlFor="managerId"
          required
          hint={`A ${ROLE_LABELS[role].toLowerCase()} reports to ${ROLE_LABELS[
            requiredManagerRole
          ].toLowerCase()}.`}
          error={state.fieldErrors.managerId}
        >
          <Select
            id="managerId"
            name="managerId"
            required
            placeholder={
              eligible.length === 0
                ? `No ${ROLE_LABELS[requiredManagerRole].toLowerCase()} yet`
                : 'Choose…'
            }
            // Only when the role is unchanged does the stored manager still
            // apply; promoting somebody clears it so a stale choice cannot be
            // saved against the new role.
            defaultValue={role === person.role ? (person.managerId ?? '') : ''}
            options={eligible.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
          />
        </Field>
      )}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Branches</legend>
        {branches.length === 0 ? (
          <p className="text-xs text-muted-foreground">Add a branch first.</p>
        ) : (
          branches.map((branch) => (
            <label key={branch.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="outletIds"
                value={branch.id}
                defaultChecked={person.outletIds.includes(branch.id)}
                className="h-4 w-4"
              />
              {branch.name}
            </label>
          ))
        )}
        <p className="text-xs text-muted-foreground">
          Unticking a branch revokes the assignment; the record of it is kept.
        </p>
      </fieldset>

      <Field label="Status" htmlFor="isActive" error={state.fieldErrors.isActive}>
        <Select
          id="isActive"
          name="isActive"
          defaultValue={String(person.isActive)}
          options={[
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Deactivated — cannot sign in' },
          ]}
        />
      </Field>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="text-sm text-muted-foreground">Saved.</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  )
}
