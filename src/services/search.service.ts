import { fromPostgrestError } from '@/lib/errors'
import { ENTITY_HREF, MIN_SEARCH_LENGTH, type SearchEntity, type SearchResult } from '@/lib/search'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireUser } from '@/services/auth.service'

/**
 * Global search (§11.10).
 *
 * **Permission-scoped by construction.** `search_crm()` is SECURITY INVOKER, so
 * it reads the business tables as the caller and every policy in migration 016
 * applies. There is no search index to fall out of step with the permission
 * model, and therefore no way for this to return a record the caller may not
 * open — which is what §25's "never confirm existence" requires of a search box.
 *
 * The query string is a bound parameter the whole way down, so it is data and can
 * never become SQL. `%` and `_` are escaped before they reach the `ilike`
 * pattern, so a search for `%` finds the character rather than everything.
 *
 * The constants and grouping live in `lib/search.ts` — the search box is a Client
 * Component and must not import this module.
 */
export async function searchCrm(query: string, limit = 20): Promise<SearchResult[]> {
  await requireUser()

  const trimmed = query?.trim() ?? ''
  if (trimmed.length < MIN_SEARCH_LENGTH) return []

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('search_crm', { p_query: trimmed, p_limit: limit })

  if (error) throw fromPostgrestError(error)

  return (data ?? []).map((row) => ({
    entity: row.entity as SearchEntity,
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    href: ENTITY_HREF[row.entity as SearchEntity](row.id),
  }))
}
