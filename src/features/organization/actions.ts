'use server'

import { revalidatePath } from 'next/cache'

import { AppError } from '@/lib/errors'
import { stateFromError, valuesFrom, type FormState } from '@/lib/form-state'
import { roleSchema } from '@/lib/validation'
import { requireOwnerOrAdmin } from '@/services/auth.service'
import { createOutlet, setOutletActive, setUserOutlets } from '@/services/outlet.service'
import { createUser, updateUser } from '@/services/user.service'

/**
 * Settings → Organization (ADR-040).
 *
 * Four things and no more (CLAUDE.md §8): authenticate, validate, call a service,
 * map errors. Every business rule — who may report to whom, whether a role change
 * is legal, whether a branch may be closed — lives in `user.service.ts`,
 * `outlet.service.ts` and, finally and unavoidably, in the database.
 *
 * `requireOwnerOrAdmin()` runs first in every action here. It is not the control
 * — `users_admin_insert`, `users_admin_update` and `outlets_insert` are, and they
 * hold against a direct PostgREST call — but an action that reached a service
 * without it would be relying on a rule stated somewhere else, and that is how
 * the check gets lost.
 *
 * NO PASSWORD IS EVER LOGGED, echoed back in `values`, or revalidated into a
 * cache. `valuesFrom` is called on a FormData with the password field removed.
 */

/** Everything the form typed, minus anything secret. Never echo a password. */
function safeValues(formData: FormData): Record<string, string> {
  const values = valuesFrom(formData)
  delete values.password
  return values
}

/** A blank field means "not given", never the empty string. */
const optional = (formData: FormData, key: string): string | undefined => {
  const raw = String(formData.get(key) ?? '').trim()
  return raw === '' ? undefined : raw
}

/**
 * The same, for the reporting line — where "cleared" and "not given" differ.
 *
 * `undefined` leaves the line alone; `null` detaches the person from it, which is
 * what the form submits when the manager select is emptied.
 */
const optionalLink = (formData: FormData, key: string): string | null => {
  const raw = String(formData.get(key) ?? '').trim()
  return raw === '' ? null : raw
}

/**
 * Add a person, through the ordinary provisioning path (ADR-009).
 *
 * `createUser` creates the Auth account with the admin API, the
 * `on_auth_user_created` trigger mirrors it into `public.users`, and the role,
 * reporting line and branches are applied afterwards. **No credential is
 * invented here and none is seeded anywhere** — the administrator types a
 * temporary password and the person changes it.
 */
export async function addPersonAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = safeValues(formData)

  try {
    await requireOwnerOrAdmin()

    const role = roleSchema.parse(String(formData.get('role') ?? ''))
    const outletIds = formData.getAll('outletIds').map(String).filter(Boolean)

    const user = await createUser({
      fullName: String(formData.get('fullName') ?? ''),
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      phone: optional(formData, 'phone'),
      role,
      managerId: optionalLink(formData, 'managerId'),
      outletIds,
    })

    if (outletIds.length > 0) {
      // `createUser` already inserted the scope; this keeps the two paths in one
      // place should the form ever submit an empty list to clear it.
      await setUserOutlets(user.id, outletIds)
    }
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath('/settings/organization/people')
  revalidatePath('/settings/organization/structure')
  return { ok: true, error: null, fieldErrors: {} }
}

/** Change a person's role, reporting line, branches or active flag. */
export async function updatePersonAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = safeValues(formData)

  try {
    await requireOwnerOrAdmin()

    const id = String(formData.get('id') ?? '')
    if (!id) throw new AppError('VALIDATION_FAILED', 'Which person?', { field: 'id' })

    const roleRaw = String(formData.get('role') ?? '').trim()
    const isActiveRaw = String(formData.get('isActive') ?? '').trim()

    await updateUser({
      id,
      fullName: String(formData.get('fullName') ?? ''),
      phone: optional(formData, 'phone'),
      ...(roleRaw ? { role: roleSchema.parse(roleRaw) } : {}),
      ...(isActiveRaw ? { isActive: isActiveRaw === 'true' } : {}),
      managerId: optionalLink(formData, 'managerId'),
    })

    // An empty list is meaningful: it removes a person from every branch. The
    // rows are revoked, never deleted (§8.8).
    await setUserOutlets(id, formData.getAll('outletIds').map(String).filter(Boolean))
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath('/settings/organization/people')
  revalidatePath('/settings/organization/structure')
  return { ok: true, error: null, fieldErrors: {} }
}

/** Open a branch. Branch names are data, never a constant (ADR-016). */
export async function addBranchAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = valuesFrom(formData)

  try {
    await requireOwnerOrAdmin()
    await createOutlet({
      code: String(formData.get('code') ?? ''),
      name: String(formData.get('name') ?? ''),
      city: optional(formData, 'city'),
    })
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath('/settings/organization/branches')
  return { ok: true, error: null, fieldErrors: {} }
}

/**
 * Close or reopen a branch.
 *
 * Closing never touches the records filed against it — that is the whole reason a
 * branch is a row rather than a text column — and a closed branch stops being
 * offered in every selector, because `listAuthorizedOutlets()` reads only active
 * ones. It is how Chithode exists during the pilot without anybody being able to
 * file work against it.
 */
export async function setBranchActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)

  try {
    await requireOwnerOrAdmin()
    await setOutletActive(String(formData.get('id') ?? ''), String(formData.get('isActive')) === 'true')
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath('/settings/organization/branches')
  return { ok: true, error: null, fieldErrors: {} }
}
