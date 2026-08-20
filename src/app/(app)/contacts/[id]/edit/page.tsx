import type { Metadata } from 'next'

import { updateContactAction } from '@/features/contacts/actions'
import { ContactForm } from '@/features/contacts/contact-form'
import { listAccounts } from '@/services/account.service'
import { getContact } from '@/services/contact.service'

export const metadata: Metadata = { title: 'Edit contact · JSK CRM' }

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [contact, accounts] = await Promise.all([
    getContact(id),
    listAccounts({}, { page: 1, pageSize: 100 }),
  ])

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Edit {contact.full_name}</h1>
      <ContactForm
        action={updateContactAction.bind(null, id)}
        contact={contact}
        accountOptions={accounts.rows.map((row) => ({ value: row.id, label: row.name }))}
        submitLabel="Save changes"
      />
    </div>
  )
}
