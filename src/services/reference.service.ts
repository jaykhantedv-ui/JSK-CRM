import { listAuthorizedOutlets } from '@/services/outlet.service'
import { getSetting } from '@/services/settings.service'
import { listUsers } from '@/services/user.service'

/**
 * Reference data for forms — the option lists every create and edit screen needs.
 *
 * One place, so no page assembles its own. **Nothing here is a constant.** Towns
 * come from `system_settings.cities`, outlets from the `outlets` table, and
 * teammates from `users` under the caller's own RLS — an outlet name or a town
 * hard-coded in a component would be exactly the deploy-to-change-a-value problem
 * §24 and ADR-016 exist to prevent.
 */

export type Option = { value: string; label: string }

/**
 * Branches the caller may file a record against, as select options.
 *
 * **`listAuthorizedOutlets()`, not `listOutlets()`.** This feeds every creation
 * and edit form, and it used to offer every active branch to everybody — so a
 * salesperson posted to one branch was offered all of them and could pick one
 * the database would then refuse. One helper decides who may work where
 * (ADR-040); nothing here restates it.
 */
export async function outletOptions(): Promise<Option[]> {
  const outlets = await listAuthorizedOutlets()
  return outlets.map((outlet) => ({ value: outlet.id, label: `${outlet.name} (${outlet.code})` }))
}

/**
 * The controlled town list (§7.3) — the ten Erode District revenue taluks, held
 * in `system_settings` so the business can extend it without a deploy.
 */
export async function cityOptions(): Promise<string[]> {
  return getSetting('cities')
}

/**
 * People an opportunity can be reassigned to.
 *
 * `listUsers()` reads through `users_select`, which since ADR-040 shows a sales
 * head their own direct reports rather than everyone sharing a branch. The list
 * is therefore already their team, without this function filtering anything —
 * and a sales head cannot hand work to another team, because `opportunities`'
 * WITH CHECK refuses an owner outside their scope.
 */
export async function assignableUserOptions(): Promise<Option[]> {
  const users = await listUsers()
  return users
    .filter((user) => user.is_active && user.role !== 'ADMIN')
    .map((user) => ({ value: user.id, label: `${user.full_name} · ${user.role}` }))
}

/** Names by id, for rendering "who did this" without a second round-trip per row. */
export async function userNames(): Promise<Record<string, string>> {
  const users = await listUsers()
  return Object.fromEntries(users.map((user) => [user.id, user.full_name]))
}
