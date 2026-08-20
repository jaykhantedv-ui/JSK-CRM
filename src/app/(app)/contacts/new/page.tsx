import type { Metadata } from 'next'

import { createContactAction } from '@/features/contacts/actions'
import { ContactForm } from '@/features/contacts/contact-form'
import { listAccounts } from '@/services/account.service'

export const metadata: Metadata = { title: 'New contact · JSK CRM' }

export default async function NewContactPage() {
  const accounts = await listAccounts({}, { page: 1, pageSize: 100 })

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">New contact</h1>
        <p className="text-sm text-muted-foreground">
          An extra person around a job. A homeowner on their own does not need one.
        </p>
      </header>
      <ContactForm
        action={createContactAction}
        accountOptions={accounts.rows.map((row) => ({ value: row.id, label: row.name }))}
        submitLabel="Create contact"
      />
    </div>
  )
}
