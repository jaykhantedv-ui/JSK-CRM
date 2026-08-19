/**
 * Search constants and result shaping (§11.10).
 *
 * Pure, and deliberately **not** in `services/search.service.ts`: the search box
 * is a Client Component, and a client module that imported the service would drag
 * the server Supabase client — and `next/headers` with it — into the browser
 * bundle. Keeping the constants here is what keeps that boundary real rather than
 * merely intended (CLAUDE.md §7).
 */

/** §11.10 — below three characters every query matches half the database. */
export const MIN_SEARCH_LENGTH = 3

export type SearchEntity = 'account' | 'contact' | 'project' | 'opportunity'

export type SearchResult = {
  entity: SearchEntity
  id: string
  title: string
  subtitle: string | null
  href: string
}

export const ENTITY_LABELS: Record<SearchEntity, string> = {
  account: 'Customer',
  contact: 'Contact',
  project: 'Project',
  opportunity: 'Opportunity',
}

export const ENTITY_HREF: Record<SearchEntity, (id: string) => string> = {
  account: (id) => `/accounts/${id}`,
  contact: (id) => `/contacts/${id}`,
  project: (id) => `/projects/${id}`,
  opportunity: (id) => `/opportunities/${id}`,
}

/** Results grouped by entity with type badges, as §11.10 asks. */
export function groupResults(results: SearchResult[]): { entity: SearchEntity; rows: SearchResult[] }[] {
  const order: SearchEntity[] = ['account', 'project', 'opportunity', 'contact']
  return order
    .map((entity) => ({ entity, rows: results.filter((row) => row.entity === entity) }))
    .filter((group) => group.rows.length > 0)
}
