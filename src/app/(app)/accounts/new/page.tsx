import type { Metadata } from 'next'

import { QuickCreateForm } from '@/features/accounts/quick-create-form'
import { resolveDefaultOutlet } from '@/services/account.service'
import { requireUser } from '@/services/auth.service'
import { cityOptions, outletOptions } from '@/services/reference.service'

export const metadata: Metadata = { title: 'New customer · JSK CRM' }

/**
 * §11.1 — the primary mobile flow. **Customer and their first enquiry in one
 * screen, target sixty seconds.**
 *
 * This is the screen the whole product is judged on: if capturing a walk-in here
 * is slower than writing it in a notebook, the CRM loses (§1.4).
 *
 * No contact is created. No project is created. Projects arrive when site details
 * are known (§11.1), and a homeowner is one person whose number the account
 * already carries (§5.4).
 */
export default async function NewAccountPage() {
  const user = await requireUser()
  const [outlets, cities] = await Promise.all([outletOptions(), cityOptions()])

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">New customer</h1>
        <p className="text-sm text-muted-foreground">
          Capture the enquiry now. Everything else can be filled in afterwards.
        </p>
      </header>

      <QuickCreateForm
        outlets={outlets}
        defaultOutletId={resolveDefaultOutlet(user)}
        cities={cities}
      />
    </div>
  )
}
