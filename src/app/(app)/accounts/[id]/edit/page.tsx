import type { Metadata } from 'next'

import { AccountForm } from '@/features/accounts/account-form'
import { updateAccountAction } from '@/features/accounts/actions'
import { getAccount, resolveDefaultOutlet } from '@/services/account.service'
import { requireUser } from '@/services/auth.service'
import { cityOptions, outletOptions } from '@/services/reference.service'

export const metadata: Metadata = { title: 'Edit customer · JSK CRM' }

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const [account, outlets, cities] = await Promise.all([getAccount(id), outletOptions(), cityOptions()])

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Edit {account.name}</h1>
      <AccountForm
        action={updateAccountAction.bind(null, id)}
        account={account}
        outlets={outlets}
        defaultOutletId={resolveDefaultOutlet(user)}
        cities={cities}
        submitLabel="Save changes"
      />
    </div>
  )
}
