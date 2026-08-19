'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  moneyField, optionalField, requireField, stateFromError, valuesFrom, type FormState,
} from '@/lib/form-state'
import {
  checkDuplicates, createAccount, createAccountWithOpportunity, updateAccount,
} from '@/services/account.service'
import type { DuplicateMatch } from '@/lib/duplicates'

/**
 * Account Server Actions.
 *
 * Four things and no more (CLAUDE.md §8): authenticate — done inside the service
 * by `requireUser()` — validate with Zod, call a service, map errors. **No
 * business rule lives here.** Whether a duplicate blocks a save, who may own a
 * record, what the default status is: all of that is in `account.service.ts`.
 */

/**
 * §11.1 — the primary mobile flow, customer and opportunity in one submit.
 *
 * The duplicate check is deliberately NOT consulted before saving. §8.9 says
 * warn, never block; the warning is rendered while the user types, and pressing
 * Save means they looked and decided (CLAUDE.md §15).
 */
export async function createAccountWithOpportunityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)
  let accountId: string

  try {
    const nextActionDate = optionalField(formData, 'nextActionDate')
    const result = await createAccountWithOpportunity({
      name: requireField(formData, 'name', 'Enter the customer name.'),
      accountType: requireField(formData, 'accountType', 'Choose a customer type.') as never,
      outletId: requireField(formData, 'outletId', 'Choose the branch this customer belongs to.'),
      phone: optionalField(formData, 'phone'),
      email: optionalField(formData, 'email'),
      city: optionalField(formData, 'city'),
      area: optionalField(formData, 'area'),
      source: (optionalField(formData, 'source') ?? 'WALK_IN') as never,
      notes: optionalField(formData, 'notes'),
      category: requireField(formData, 'category', 'Choose what they are asking about.') as never,
      estimatedValuePaise: moneyField(formData, 'estimatedValue', 'Enter the estimated value in rupees.'),
      materialNotes: optionalField(formData, 'materialNotes'),
      nextAction: (optionalField(formData, 'nextAction') ?? undefined) as never,
      nextActionDate,
      nextActionNote: optionalField(formData, 'nextActionNote'),
    })
    accountId = result.accountId
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath('/accounts')
  revalidatePath('/today')
  // §11.1 — land on the customer page with the new opportunity visible.
  redirect(`/accounts/${accountId}?created=1`)
}

export async function createAccountAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)
  let accountId: string

  try {
    const account = await createAccount({
      name: requireField(formData, 'name', 'Enter the customer name.'),
      accountType: requireField(formData, 'accountType', 'Choose a customer type.') as never,
      outletId: requireField(formData, 'outletId', 'Choose the branch this customer belongs to.'),
      phone: optionalField(formData, 'phone'),
      altPhone: optionalField(formData, 'altPhone'),
      whatsappPhone: optionalField(formData, 'whatsappPhone'),
      email: optionalField(formData, 'email'),
      address: optionalField(formData, 'address'),
      city: optionalField(formData, 'city'),
      area: optionalField(formData, 'area'),
      source: (optionalField(formData, 'source') ?? 'WALK_IN') as never,
      gstin: optionalField(formData, 'gstin'),
      notes: optionalField(formData, 'notes'),
    })
    accountId = account.id
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath('/accounts')
  redirect(`/accounts/${accountId}`)
}

export async function updateAccountAction(
  accountId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)

  try {
    await updateAccount(accountId, {
      name: requireField(formData, 'name', 'Enter the customer name.'),
      accountType: requireField(formData, 'accountType', 'Choose a customer type.') as never,
      outletId: requireField(formData, 'outletId', 'Choose the branch this customer belongs to.'),
      phone: optionalField(formData, 'phone'),
      altPhone: optionalField(formData, 'altPhone'),
      whatsappPhone: optionalField(formData, 'whatsappPhone'),
      email: optionalField(formData, 'email'),
      address: optionalField(formData, 'address'),
      city: optionalField(formData, 'city'),
      area: optionalField(formData, 'area'),
      source: (optionalField(formData, 'source') ?? 'WALK_IN') as never,
      gstin: optionalField(formData, 'gstin'),
      notes: optionalField(formData, 'notes'),
      status: (optionalField(formData, 'status') ?? undefined) as never,
    })
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath(`/accounts/${accountId}`)
  redirect(`/accounts/${accountId}`)
}

/**
 * Live duplicate lookup while the form is being filled in (§11.1 — "on phone
 * blur, `checkDuplicates()` runs and renders any matches inline").
 *
 * Returns matches. It cannot and does not stop anything.
 */
export async function checkDuplicatesAction(input: {
  phone?: string | null
  email?: string | null
  name?: string | null
  city?: string | null
  excludeId?: string | null
}): Promise<DuplicateMatch[]> {
  try {
    return await checkDuplicates(input)
  } catch {
    // A failed advisory check must never break the form the user is filling in.
    return []
  }
}
