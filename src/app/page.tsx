import { redirect } from 'next/navigation'

import { landingRouteFor } from '@/lib/permissions'
import { getCurrentUser } from '@/services/auth.service'

/**
 * Role-aware entry point (§12.2, decision M-01).
 *
 * SALESPERSON → /today · MANAGER and OWNER → /dashboard · ADMIN → /settings.
 * ADMIN lands on settings because it has no sales surface at all (ADR-017).
 */
export default async function RootPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  redirect(landingRouteFor(user.role))
}
