import { redirect } from 'next/navigation'

import { isManagerOrAbove } from '@/lib/permissions'
import { requireUser } from '@/services/auth.service'

/**
 * The `/reports` guard (§12.2 — MANAGER, OWNER).
 *
 * One redirect for every report beneath it, so no individual report can be added
 * later without it. **This is a routing decision, not the control**: every
 * analytics RPC calls `assert_management_access()` and every table carries RLS,
 * so a salesperson who reaches a report page some other way still reads nothing
 * (§15, ADR-017).
 *
 * ADMIN goes to `/settings`: it has no sales surface, and showing it empty
 * reports would imply the data was merely missing.
 */
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  if (!isManagerOrAbove(user)) {
    redirect(user.role === 'ADMIN' ? '/settings' : '/today')
  }
  return <>{children}</>
}
