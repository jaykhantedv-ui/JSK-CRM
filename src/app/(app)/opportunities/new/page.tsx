import type { Metadata } from 'next'

import { createOpportunityAction } from '@/features/opportunities/actions'
import { OpportunityForm } from '@/features/opportunities/opportunity-form'
import { listAccounts, resolveDefaultOutlet } from '@/services/account.service'
import { requireUser } from '@/services/auth.service'
import { listProjects } from '@/services/project.service'
import { outletOptions } from '@/services/reference.service'

export const metadata: Metadata = { title: 'New enquiry · JSK CRM' }

/**
 * §11.3 — a new opportunity on an existing customer or site.
 *
 * **A project may carry many opportunities.** Nothing here checks whether the
 * chosen site already has one, because a site that buys tiles will also buy
 * sanitaryware, and each is its own deal (§5.5).
 *
 * The customer and site lists are read under the caller's own session, so the
 * pickers only ever offer records they may already open.
 */
export default async function NewOpportunityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const accountId = (Array.isArray(params.account) ? params.account[0] : params.account) ?? null
  const projectId = (Array.isArray(params.project) ? params.project[0] : params.project) ?? null

  const user = await requireUser()
  const [accounts, projects, outlets] = await Promise.all([
    listAccounts({}, { page: 1, pageSize: 100 }),
    listProjects(accountId ? { accountId } : {}, { page: 1, pageSize: 100 }),
    outletOptions(),
  ])

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">New enquiry</h1>
        <p className="text-sm text-muted-foreground">
          For a customer we already have. A brand-new customer starts on the customer form.
        </p>
      </header>

      <OpportunityForm
        mode="create"
        action={createOpportunityAction}
        accountId={accountId}
        defaultProjectId={projectId}
        accountOptions={accounts.rows.map((row) => ({ value: row.id, label: row.name }))}
        projectOptions={projects.rows.map((row) => ({
          value: row.id,
          label: row.name,
        }))}
        outletOptions={outlets}
        defaultOutletId={resolveDefaultOutlet(user)}
        submitLabel="Create enquiry"
      />
    </div>
  )
}
