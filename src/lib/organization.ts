import type { Role } from '@/lib/permissions'
import type { UserRow } from '@/types/domain'

/**
 * The organisation, assembled in memory (ADR-041).
 *
 * **Pure by design, and that is the point.** Everything here is a function of
 * rows already fetched — no database, no session, no I/O — so the resolution
 * rules can be tested exhaustively without standing up PostgREST, and so the
 * service layer above is only ever three plain queries and a call to these.
 *
 * WHY THIS EXISTS AT ALL. The organisation screens used to ask PostgREST to
 * embed `users` into itself through `manager_id`. On the office server's
 * PostgREST 12.2.12 that relationship is not exposed, and both screens answered
 * PGRST200 — with the foreign key genuinely present and the schema cache
 * reloaded. The join moved here rather than the dependency being nursed.
 */

/**
 * A person as the organisation screens list them: their line, their branches and
 * whether they are still with the business.
 */
export type PersonRow = UserRow & {
  managerName: string | null
  managerRole: Role | null
  outletIds: string[]
  outletNames: string[]
}

/** The three plain row shapes the organisation screens are assembled from. */
type OutletLink = { user_id: string; outlet_id: string; revoked_at: string | null }
type BranchName = { id: string; name: string }

/**
 * Assemble the organisation from three flat result sets. **Pure** — no database,
 * no session, no I/O — so the resolution rules below are unit-testable without
 * standing up PostgREST.
 *
 * THE RULE THAT MATTERS: a manager is resolved ONLY from the set of users the
 * caller was already authorised to read. A `manager_id` pointing at somebody
 * outside that set resolves to `null` — it is never a reason to go and fetch the
 * row. That is what keeps `manager_id` from becoming a side channel: a
 * salesperson can see their own sales head because `users_select` grants them
 * that row, and cannot see anybody else's because it does not.
 */
export function assembleOrganization(
  users: readonly UserRow[],
  links: readonly OutletLink[],
  branches: readonly BranchName[],
): PersonRow[] {
  const byId = new Map(users.map((user) => [user.id, user]))
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]))

  const held = new Map<string, OutletLink[]>()
  for (const link of links) {
    if (link.revoked_at !== null) continue
    const list = held.get(link.user_id)
    if (list) list.push(link)
    else held.set(link.user_id, [link])
  }

  return users.map((user) => {
    // Resolved from `byId`, which holds only rows RLS already let through.
    const boss = user.manager_id ? byId.get(user.manager_id) : undefined
    const mine = held.get(user.id) ?? []

    return {
      ...user,
      managerName: boss?.full_name ?? null,
      managerRole: boss?.role ?? null,
      outletIds: mine.map((link) => link.outlet_id),
      outletNames: mine
        .map((link) => branchName.get(link.outlet_id))
        .filter((name): name is string => !!name),
    }
  })
}

/** A sales head and the people who report to them, for the structure screen. */
export type ReportingNode = {
  person: Pick<UserRow, 'id' | 'full_name' | 'email' | 'role' | 'is_active'>
  reports: ReportingNode[]
}

/**
 * The organisation as a tree, built from the flat list.
 *
 * Roots are the people whose manager is not in the visible set — the OWNER for an
 * administrator, and the sales head themselves for a sales head — so the tree is
 * always well-formed for whoever is looking at it.
 */
/**
 * The organisation as a tree. **Pure**, and separated from the loading for the
 * same reason `assembleOrganization` is: the shape of the tree is worth testing
 * on its own, without a database.
 */
export function buildReportingTree(people: readonly PersonRow[]): ReportingNode[] {

  const nodes = new Map<string, ReportingNode>(
    people.map((person) => [
      person.id,
      {
        person: {
          id: person.id,
          full_name: person.full_name,
          email: person.email,
          role: person.role,
          is_active: person.is_active,
        },
        reports: [],
      },
    ]),
  )

  // A person whose manager is not in the visible set is a ROOT here — the sales
  // head themselves when a sales head is looking, the owner when an
  // administrator is. That is what makes the tree well-formed for whoever asked,
  // rather than dangling off a node they cannot see.
  const roots: ReportingNode[] = []
  for (const person of people) {
    const node = nodes.get(person.id)!
    const parent = person.manager_id ? nodes.get(person.manager_id) : undefined
    if (parent) parent.reports.push(node)
    else roots.push(node)
  }
  return roots
}
