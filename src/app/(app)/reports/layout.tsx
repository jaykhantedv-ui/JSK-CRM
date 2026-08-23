import { ForbiddenState } from '@/components/shared/states'
import { canViewTeamDashboard } from '@/lib/permissions'
import { requireUser } from '@/services/auth.service'

/**
 * The `/reports` guard (§12.2, ADR-040 — SALES HEAD, ADMIN, OWNER).
 *
 * One check for every report beneath it, so no individual report can be added
 * later without one.
 *
 * **A REFUSAL, NOT A REDIRECT.** It used to send a salesperson to `/today`,
 * which is indistinguishable from a mis-click and leaves them wondering whether
 * the link was broken. Typing `/reports` is now answered, plainly, with the
 * reason.
 *
 * This is the routing control and not the only one: every analytics RPC calls
 * `assert_management_access()` and every table carries RLS, so a salesperson who
 * reached a report page some other way still reads nothing (§15, ADR-040).
 */
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  if (!canViewTeamDashboard(user)) return <ForbiddenState
      backHref="/today" title="This screen is not part of your role"
      description="Ask the owner or an administrator if you need it."
    />
  return <>{children}</>
}
