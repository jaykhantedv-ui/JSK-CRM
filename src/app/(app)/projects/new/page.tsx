import type { Metadata } from 'next'

import { createProjectAction } from '@/features/projects/actions'
import { ProjectForm } from '@/features/projects/project-form'
import { listAccounts, resolveDefaultOutlet } from '@/services/account.service'
import { requireUser } from '@/services/auth.service'
import { cityOptions, outletOptions } from '@/services/reference.service'

export const metadata: Metadata = { title: 'New site · JSK CRM' }

/** §11.2 — a site on an existing customer. Owner inherits the customer's owner. */
export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const accountId = (Array.isArray(params.account) ? params.account[0] : params.account) ?? null

  const user = await requireUser()
  const [accounts, outlets, cities] = await Promise.all([
    listAccounts({}, { page: 1, pageSize: 100 }),
    outletOptions(),
    cityOptions(),
  ])

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">New site</h1>
        <p className="text-sm text-muted-foreground">
          A site can carry several enquiries — tiles now, sanitaryware later.
        </p>
      </header>

      <ProjectForm
        action={createProjectAction}
        accountId={accountId}
        accountOptions={accounts.rows.map((row) => ({ value: row.id, label: row.name }))}
        outletOptions={outlets}
        defaultOutletId={resolveDefaultOutlet(user)}
        cities={cities}
        submitLabel="Create site"
      />
    </div>
  )
}
