import type { Route } from 'next'

/**
 * Typed route construction.
 *
 * `typedRoutes` is on (next.config.ts), which is a real safety net: a link to a
 * route that does not exist fails the build instead of 404-ing in a showroom. It
 * cannot, however, verify a URL assembled at runtime from a record id or a
 * `URLSearchParams`.
 *
 * Everything below builds a path from a **literal route prefix** plus data, so
 * the cast asserts something the surrounding code already guarantees. Keeping the
 * casts in one file means a reviewer can check every one of them at once, rather
 * than finding `as Route` scattered through the components.
 */
export function toRoute(path: string): Route {
  return path as Route
}

export const routes = {
  today: '/today' as Route,
  dashboard: '/dashboard' as Route,
  accounts: '/accounts' as Route,
  newAccount: '/accounts/new' as Route,
  account: (id: string) => toRoute(`/accounts/${id}`),
  editAccount: (id: string) => toRoute(`/accounts/${id}/edit`),
  accountActivity: (id: string) => toRoute(`/accounts/${id}/activity`),
  contacts: '/contacts' as Route,
  contact: (id: string) => toRoute(`/contacts/${id}`),
  projects: '/projects' as Route,
  project: (id: string) => toRoute(`/projects/${id}`),
  opportunities: '/opportunities' as Route,
  opportunity: (id: string) => toRoute(`/opportunities/${id}`),
  newOpportunityFor: (accountId: string, projectId?: string) =>
    toRoute(
      projectId
        ? `/opportunities/new?account=${accountId}&project=${projectId}`
        : `/opportunities/new?account=${accountId}`,
    ),
  newProjectFor: (accountId: string) => toRoute(`/projects/new?account=${accountId}`),
  search: (query: string) => toRoute(`/search?q=${encodeURIComponent(query)}`),
} as const
