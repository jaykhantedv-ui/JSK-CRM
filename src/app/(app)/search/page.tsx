import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { GlobalSearch } from '@/components/layout/top-bar'
import { EmptyState, SkeletonRows } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { toRoute } from '@/lib/routes'
import { ENTITY_LABELS, MIN_SEARCH_LENGTH, groupResults } from '@/lib/search'
import { searchCrm } from '@/services/search.service'

export const metadata: Metadata = { title: 'Search · JSK CRM' }

/**
 * Global search (§11.10, §12.2).
 *
 * **Permission-scoped, and not by anything on this page.** The SQL behind it runs
 * as the caller, so a record outside their outlet scope is not in the result set
 * at all — there is nothing here to filter and nothing to leak. A salesperson
 * searching a competitor's customer name gets an empty page, which is the same
 * page they would get if the customer did not exist (§25).
 *
 * Results are grouped by type with badges, in §11.10's order: phone matches
 * first, then customer name, project name, opportunity title, contact name.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const query = (Array.isArray(params.q) ? params.q[0] : params.q) ?? ''

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Search</h1>
        <GlobalSearch initialQuery={query} />
      </header>

      {query.trim().length < MIN_SEARCH_LENGTH ? (
        <p className="text-sm text-muted-foreground">
          Type at least {MIN_SEARCH_LENGTH} characters. A phone number works too — the last four
          digits are enough.
        </p>
      ) : (
        <Suspense key={query} fallback={<SkeletonRows rows={4} />}>
          <Results query={query} />
        </Suspense>
      )}
    </div>
  )
}

async function Results({ query }: { query: string }) {
  const results = await searchCrm(query)

  if (results.length === 0) {
    return (
      <EmptyState
        title={`Nothing found for “${query}”`}
        description="Try fewer characters, or search by phone number instead."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {groupResults(results).map((group) => (
        <section key={group.entity} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {ENTITY_LABELS[group.entity]}
          </h2>
          <ul className="flex flex-col gap-2">
            {group.rows.map((row) => (
              <li key={`${row.entity}-${row.id}`}>
                <Link
                  href={toRoute(row.href)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.title}</p>
                    {row.subtitle ? (
                      <p className="truncate text-xs text-muted-foreground">{row.subtitle}</p>
                    ) : null}
                  </div>
                  <Badge tone="muted">{ENTITY_LABELS[row.entity]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
