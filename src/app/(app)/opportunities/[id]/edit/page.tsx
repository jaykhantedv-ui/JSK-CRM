import type { Metadata } from 'next'

import { updateOpportunityAction } from '@/features/opportunities/actions'
import { OpportunityForm } from '@/features/opportunities/opportunity-form'
import { resolveDefaultOutlet } from '@/services/account.service'
import { requireUser } from '@/services/auth.service'
import { getOpportunity } from '@/services/opportunity.service'
import { listProjects } from '@/services/project.service'
import { outletOptions } from '@/services/reference.service'

export const metadata: Metadata = { title: 'Edit enquiry · JSK CRM' }

/**
 * Editing an opportunity.
 *
 * Stage and owner are deliberately not on this form — they change through the
 * stage control and the reassign control, so both always land in the audit trail
 * with a reason (§9.2, §11.9).
 */
export default async function EditOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const opportunity = await getOpportunity(id)
  const [projects, outlets] = await Promise.all([
    listProjects({ accountId: opportunity.account_id }, { page: 1, pageSize: 100 }),
    outletOptions(),
  ])

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Edit enquiry</h1>
      <OpportunityForm
        mode="edit"
        action={updateOpportunityAction.bind(null, id)}
        opportunity={opportunity}
        accountOptions={[]}
        projectOptions={projects.rows.map((row) => ({ value: row.id, label: row.name }))}
        outletOptions={outlets}
        defaultOutletId={resolveDefaultOutlet(user)}
        submitLabel="Save changes"
      />
    </div>
  )
}
