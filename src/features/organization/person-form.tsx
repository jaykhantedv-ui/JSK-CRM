'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { IDLE_FORM_STATE } from '@/lib/form-state'
import { MANAGER_ROLE_FOR, ROLE_LABELS, type Role } from '@/lib/permissions'
import { addPersonAction } from '@/features/organization/actions'

export type ManagerOption = { id: string; name: string; role: Role }
export type BranchOption = { id: string; name: string }

/**
 * Adding a person (ADR-009, ADR-040).
 *
 * **The role decides who they can report to, and the form only offers those
 * people.** A salesperson is offered sales heads; a sales head is offered
 * administrators; an administrator is offered the owner. That mirrors
 * `MANAGER_ROLE_FOR` in `lib/permissions.ts`, which mirrors
 * `guard_user_hierarchy()` in the database — and the database is the one that
 * decides. Offering an impossible choice and letting the write fail would be a
 * worse form, not a safer one.
 *
 * The password is a TEMPORARY one the administrator reads out. It is never
 * echoed back into the form on an error, never logged, and never seeded
 * anywhere — the person changes it after their first sign-in.
 */
export function PersonForm({
  managers,
  branches,
}: {
  managers: ManagerOption[]
  branches: BranchOption[]
}) {
  const [state, formAction, pending] = useActionState(addPersonAction, IDLE_FORM_STATE)
  const [role, setRole] = useState<Role>('SALESPERSON')

  // Read from the map, never restated as a ternary chain: this is the same rule
  // `guard_user_hierarchy()` enforces, and a second copy of it here is a form
  // that offers a choice the database refuses.
  const requiredManagerRole = MANAGER_ROLE_FOR[role]
  const eligible = managers.filter((person) => person.role === requiredManagerRole)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Field label="Full name" htmlFor="fullName" required error={state.fieldErrors.fullName}>
        <Input id="fullName" name="fullName" required defaultValue={state.values?.fullName ?? ''} />
      </Field>

      <Field label="Email" htmlFor="email" required error={state.fieldErrors.email}>
        <Input id="email" name="email" type="email" required defaultValue={state.values?.email ?? ''} />
      </Field>

      <Field label="Phone" htmlFor="phone" error={state.fieldErrors.phone}>
        <Input id="phone" name="phone" defaultValue={state.values?.phone ?? ''} />
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
          label="Reports to"
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
            placeholder={eligible.length === 0 ? `No ${ROLE_LABELS[requiredManagerRole].toLowerCase()} yet` : 'Choose…'}
            options={eligible.map((person) => ({ value: person.id, label: person.name }))}
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
              <input type="checkbox" name="outletIds" value={branch.id} className="h-4 w-4" />
              {branch.name}
            </label>
          ))
        )}
      </fieldset>

      <Field
        label="Temporary password"
        htmlFor="password"
        required
        hint="Read it out, and ask them to change it after signing in. It is never shown again."
        error={state.fieldErrors.password}
      >
        <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </Field>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="text-sm text-muted-foreground">Added.</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add person'}
      </Button>
    </form>
  )
}
