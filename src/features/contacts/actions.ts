'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  optionalField, requireField, stateFromError, valuesFrom, type FormState,
} from '@/lib/form-state'
import { createContact, updateContact } from '@/services/contact.service'

function contactInput(formData: FormData) {
  return {
    fullName: requireField(formData, 'fullName', 'Enter their name.'),
    accountId: optionalField(formData, 'accountId'),
    linkedAccountId: optionalField(formData, 'linkedAccountId'),
    phone: optionalField(formData, 'phone'),
    altPhone: optionalField(formData, 'altPhone'),
    email: optionalField(formData, 'email'),
    role: (optionalField(formData, 'role') ?? 'OTHER') as never,
    influence: (optionalField(formData, 'influence') ?? 'INFLUENCER') as never,
    preferredChannel: (optionalField(formData, 'preferredChannel') ?? 'CALL') as never,
    isReferralSource: formData.get('isReferralSource') === '1',
    notes: optionalField(formData, 'notes'),
  }
}

export async function createContactAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)
  let contactId: string

  try {
    const contact = await createContact(contactInput(formData))
    contactId = contact.id
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath('/contacts')
  redirect(`/contacts/${contactId}`)
}

export async function updateContactAction(
  contactId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)

  try {
    await updateContact(contactId, contactInput(formData))
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath(`/contacts/${contactId}`)
  redirect(`/contacts/${contactId}`)
}
