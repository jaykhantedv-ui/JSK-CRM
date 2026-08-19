import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { FilterBar } from '@/components/shared/filter-bar'
import { Pagination } from '@/components/shared/pagination'
import { AccountCard } from '@/components/shared/record-card'
import { EmptyState, FilteredEmptyState, SkeletonRows } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { buttonClass } from '@/components/ui/button'
import { ACCOUNT_STATUS_LABELS, ACCOUNT_TYPE_LABELS, optionsFrom } from '@/lib/labels'
import { MOBILE_PAGE_SIZE, parsePageParams } from '@/lib/pagination'
import { formatPhone } from '@/lib/phone'
import { relativeDays } from '@/lib/dates'
import { listAccounts, parseAccountFilters } from '@/services/account.service'

export const metadata: Metadata = { title: 'Customers · JSK CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * The customer list (§12.2) — labelled **Customers**, never "Accounts", in every
 * piece of visible copy.
 *
 * Filters live in the URL, so a filtered list is shareable and the back button
 * works. The query is paginated with no exception: §12.8 forbids an unbounded
 * list query anywhere.
 *
 * There is no client-side permission filtering here and there must never be —
 * `accounts_select` decides what comes back (CLAUDE.md §6).
 */
export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const flat = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  ) as Record<string, string | undefined>

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Customers</h1>
        <Link href="/accounts/new" className={buttonClass('primary', 'sm')}>
          New customer
        </Link>
      </header>

      <FilterBar
        searchPlaceholder="Name or phone"
        filters={[
          { key: 'type', label: 'Type', options: optionsFrom(ACCOUNT_TYPE_LABELS) },
          { key: 'status', label: 'Status', options: optionsFrom(ACCOUNT_STATUS_LABELS) },
        ]}
      />

      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={6} />}>
        <AccountList flat={flat} />
      </Suspense>
    </div>
  )
}

async function AccountList({ flat }: { flat: Record<string, string | undefined> }) {
  const filters = parseAccountFilters(flat)
  const page = await listAccounts(filters, parsePageParams(flat, MOBILE_PAGE_SIZE))
  const filtered = Boolean(filters.q || filters.status || filters.accountType || filters.city)

  if (page.rows.length === 0) {
    return filtered ? (
      <FilteredEmptyState clearHref="/accounts" />
    ) : (
      <EmptyState
        title="No customers yet"
        description="Add the first one — it takes under a minute, and the enquiry goes in at the same time."
        action={{ href: '/accounts/new', label: 'Add customer' }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {page.rows.map((account) => (
          <li key={account.id}>
            <AccountCard
              id={account.id}
              name={account.name}
              subtitle={[
                ACCOUNT_TYPE_LABELS[account.account_type],
                account.city,
                formatPhone(account.phone),
              ]
                .filter(Boolean)
                .join(' · ')}
              right={
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={account.status === 'ACTIVE' ? 'won' : 'muted'}>
                    {ACCOUNT_STATUS_LABELS[account.status]}
                  </Badge>
                  {account.last_activity_at ? (
                    <span className="text-xs text-muted-foreground">
                      {relativeDays(account.last_activity_at)}
                    </span>
                  ) : null}
                </div>
              }
            />
          </li>
        ))}
      </ul>
      <Pagination page={page} basePath="/accounts" searchParams={flat} />
    </div>
  )
}
