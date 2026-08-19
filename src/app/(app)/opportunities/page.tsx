import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { FilterBar } from '@/components/shared/filter-bar'
import { MoneyText } from '@/components/shared/money-text'
import { Pagination } from '@/components/shared/pagination'
import { OpportunityCard } from '@/components/shared/record-card'
import { EmptyState, FilteredEmptyState, SkeletonRows } from '@/components/shared/states'
import { buttonClass } from '@/components/ui/button'
import { STAGE_LABELS, optionsFrom } from '@/lib/labels'
import { CATEGORY_LABELS } from '@/lib/opportunity/title'
import { MOBILE_PAGE_SIZE, parsePageParams } from '@/lib/pagination'
import { listOpportunities, parseOpportunityFilters } from '@/services/opportunity.service'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { NextActionType, OpportunityStage, ProductCategory } from '@/types/domain'

export const metadata: Metadata = { title: 'Pipeline · JSK CRM' }

/**
 * The pipeline list (§12.2 `/opportunities`).
 *
 * **This is the mobile pipeline.** The board at `/opportunities/board` is a
 * desktop surface (§12.2: Kanban is ≥1024px only); on a phone a list beats a
 * horizontally scrolling board every time, and the list is what a salesperson
 * actually works from.
 *
 * Ordered by next-action date, so what is overdue is at the top. Stage,
 * ownership and category filters are URL params; outlet scope is RLS and is not
 * a filter anybody can widen.
 */
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const flat = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  ) as Record<string, string | undefined>

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
        <div className="flex gap-2">
          <Link href="/opportunities/board" className={buttonClass('outline', 'sm', 'hidden lg:inline-flex')}>
            Board
          </Link>
          <Link href="/opportunities/new" className={buttonClass('primary', 'sm')}>
            New enquiry
          </Link>
        </div>
      </header>

      <FilterBar
        searchPlaceholder="Enquiry title"
        filters={[
          { key: 'stage', label: 'Stage', options: optionsFrom(STAGE_LABELS) },
          { key: 'category', label: 'Category', options: optionsFrom(CATEGORY_LABELS) },
          { key: 'mine', label: 'Owner', options: [{ value: '1', label: 'Mine only' }] },
        ]}
      />

      <div className="flex flex-wrap gap-2">
        <Link href="/opportunities?overdue=1" className={buttonClass('outline', 'sm')}>
          Overdue
        </Link>
        <Link href="/opportunities?missing=1" className={buttonClass('outline', 'sm')}>
          Missing next action
        </Link>
        <Link href="/opportunities?unassigned=1" className={buttonClass('outline', 'sm')}>
          Unassigned
        </Link>
      </div>

      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={6} />}>
        <OpportunityList flat={flat} />
      </Suspense>
    </div>
  )
}

async function OpportunityList({ flat }: { flat: Record<string, string | undefined> }) {
  const filters = parseOpportunityFilters(flat)
  const page = await listOpportunities(filters, parsePageParams(flat, MOBILE_PAGE_SIZE))

  if (page.rows.length === 0) {
    const filtered = Boolean(
      filters.q || filters.stage || filters.category || filters.overdueOnly ||
      filters.missingNextActionOnly || filters.unassignedOnly || filters.mineOnly,
    )
    return filtered ? (
      <FilteredEmptyState clearHref="/opportunities" />
    ) : (
      <EmptyState
        title="No enquiries yet"
        description="Every enquiry starts with a customer. Add one and the enquiry goes in with it."
        action={{ href: '/accounts/new', label: 'Add customer' }}
      />
    )
  }

  const accountNames = await resolveNames(page.rows.map((row) => row.account_id as string))
  const total = page.rows.reduce((sum, row) => sum + (row.estimated_value ?? 0), 0)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {page.total} enquiries · <MoneyText paise={total} compact /> on this page
      </p>
      <ul className="flex flex-col gap-2">
        {page.rows.map((row) => (
          <li key={row.id as string}>
            <OpportunityCard
              id={row.id as string}
              title={row.title as string}
              accountName={accountNames[row.account_id as string]}
              stage={row.stage as OpportunityStage}
              category={row.category as ProductCategory}
              estimatedValuePaise={row.estimated_value}
              nextAction={row.next_action as NextActionType | null}
              nextActionDate={row.next_action_date}
            />
          </li>
        ))}
      </ul>
      <Pagination page={page} basePath="/opportunities" searchParams={flat} />
    </div>
  )
}

/** Customer names for a page of rows, in one round-trip. RLS still applies. */
async function resolveNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return {}
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('accounts').select('id, name').in('id', unique)
  return Object.fromEntries((data ?? []).map((row) => [row.id, row.name]))
}
