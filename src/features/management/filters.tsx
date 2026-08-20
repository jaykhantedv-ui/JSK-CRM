import { ScopeBar } from '@/features/management/scope-bar'
import { isOwner } from '@/lib/permissions'
import { requireUser } from '@/services/auth.service'
import { listOutlets } from '@/services/outlet.service'
import { getTeamWorkload } from '@/services/analytics.service'
import type { Period } from '@/lib/period'

/**
 * The filter bar every management screen mounts, with its options resolved on the
 * server.
 *
 * **The dropdowns only ever offer what the caller can already see.** Branches
 * come from the caller's own scope and salespeople from
 * `management_team_workload`, whose rows are bounded by `scoped_outlet_ids()`.
 * Offering a filter that returns nothing reads as a bug; offering one that hints
 * at the existence of another branch's staff is worse.
 *
 * This is convenience, not authorization: the RPCs behind every screen enforce
 * scope themselves (§15).
 */
export async function ManagementFilters({
  period,
  exportDataset,
  showPeople = true,
  showPeriod = true,
}: {
  period: Period
  exportDataset?: string
  showPeople?: boolean
  showPeriod?: boolean
}) {
  const user = await requireUser()
  const [outlets, team] = await Promise.all([
    listOutlets(),
    showPeople ? getTeamWorkload(period) : Promise.resolve([]),
  ])

  const mine = isOwner(user)
    ? outlets
    : outlets.filter((outlet) => user.outletIds.includes(outlet.id))

  return (
    <ScopeBar
      showPeriod={showPeriod}
      outlets={mine.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
      people={team.map((member) => ({ value: member.userId, label: member.fullName }))}
      exportDataset={exportDataset}
    />
  )
}
