import { parsePeriod, type Period } from '@/lib/period'
import type { ManagementScope } from '@/services/analytics.service'

/**
 * Search-param handling shared by every management screen.
 *
 * One place turns a URL into a period and a scope, so eleven reports cannot come
 * to disagree about what `?period=last_month&outlet=…` means — and a drill-down
 * from one report into another carries its context intact, which is the whole
 * point of §21's exception → explanation → action chain.
 */

export type ManagementParams = {
  flat: Record<string, string | undefined>
  period: Period
  scope: ManagementScope
  /** The period and scope as a query string, for a link that keeps them. */
  query: string
}

/** Next hands search params as `string | string[]`; a repeated key takes the first. */
export function flatten(
  params: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  ) as Record<string, string | undefined>
}

/**
 * `outlet` and `owner` are passed straight through as filters.
 *
 * **They are not validated against what the caller may see, and they do not need
 * to be.** They reach a `SECURITY INVOKER` RPC where row-level security applies,
 * so a hand-typed id for another branch narrows the result to nothing rather than
 * widening it to somebody else's data (§15). Validating here would add a second
 * gate that could drift from the real one.
 */
export function managementParams(
  raw: Record<string, string | string[] | undefined>,
): ManagementParams {
  const flat = flatten(raw)
  const period = parsePeriod(flat)

  return {
    flat,
    period,
    scope: {
      outletId: flat.outlet?.trim() || null,
      ownerId: flat.owner?.trim() || null,
    },
    query: buildQuery(flat),
  }
}

const CARRIED = ['period', 'from', 'to', 'outlet', 'owner'] as const

export function buildQuery(flat: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const key of CARRIED) {
    const value = flat[key]
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}
