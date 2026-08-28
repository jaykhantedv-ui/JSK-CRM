'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { IDLE_FORM_STATE } from '@/lib/form-state'
import { setPersonActiveAction } from '@/features/organization/actions'

/**
 * Remove a person from the team, or put them back (ADR-040).
 *
 * **"Remove" deactivates; it does not delete.** Nothing in this system is ever
 * hard-deleted (§8.8) and `users` carries no DELETE policy for any role. That is
 * deliberate rather than missing: a deleted person takes their customers,
 * opportunities, activities and audit trail with them, or orphans every one of
 * them — `accounts.owner_id` and `opportunity_events.actor_id` both point here.
 *
 * Deactivating is the whole control. `current_user_id()` filters on `is_active`,
 * so every policy in the schema resolves to nothing for them the moment this
 * saves: no sign-in, no visibility, no appearance in any list. Their work stays
 * where it is, still attributed to them, and a mistake is one click to undo —
 * which a delete would not be.
 */
export function PersonActiveToggle({
  id,
  fullName,
  isActive,
  disabled,
}: {
  id: string
  fullName: string
  isActive: boolean
  disabled?: boolean
}) {
  const [state, formAction, pending] = useActionState(setPersonActiveAction, IDLE_FORM_STATE)

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={String(!isActive)} />
      <Button
        type="submit"
        variant={isActive ? 'secondary' : 'primary'}
        size="sm"
        disabled={pending || disabled}
        // The row shows the name; the button has to carry it too, or a screen
        // reader hears twenty buttons all called "Remove".
        aria-label={`${isActive ? 'Remove' : 'Restore'} ${fullName}`}
      >
        {pending ? '…' : isActive ? 'Remove' : 'Restore'}
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  )
}
