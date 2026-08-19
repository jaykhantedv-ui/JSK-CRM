import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { FilterBar } from '@/components/shared/filter-bar'
import { Pagination } from '@/components/shared/pagination'
import { EmptyState, FilteredEmptyState, SkeletonRows } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { buttonClass } from '@/components/ui/button'
import { INFLUENCE_LABELS, STAKEHOLDER_ROLE_LABELS, optionsFrom } from '@/lib/labels'
import { MOBILE_PAGE_SIZE, parsePageParams } from '@/lib/pagination'
import { formatPhone } from '@/lib/phone'
import { listContacts, parseContactFilters } from '@/services/contact.service'

export const metadata: Metadata = { title: 'Contacts · JSK CRM' }

/**
 * The contact list (§12.2 — secondary navigation).
 *
 * Secondary on purpose: a contact is an **additional person**, and the day-to-day
 * surface is Customers. Nothing in the product requires a contact to exist (§5.4).
 */
export default async function ContactsPage({
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
        <h1 className="text-xl font-semibold tracking-tight">Contacts</h1>
        <Link href="/contacts/new" className={buttonClass('primary', 'sm')}>
          New contact
        </Link>
      </header>

      <FilterBar
        searchPlaceholder="Name or phone"
        filters={[
          { key: 'role', label: 'Role', options: optionsFrom(STAKEHOLDER_ROLE_LABELS) },
          { key: 'referral', label: 'Referrals', options: [{ value: '1', label: 'Sends us business' }] },
        ]}
      />

      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={6} />}>
        <ContactList flat={flat} />
      </Suspense>
    </div>
  )
}

async function ContactList({ flat }: { flat: Record<string, string | undefined> }) {
  const filters = parseContactFilters(flat)
  const page = await listContacts(filters, parsePageParams(flat, MOBILE_PAGE_SIZE))

  if (page.rows.length === 0) {
    const filtered = Boolean(filters.q || filters.role || filters.referralOnly || filters.accountId)
    return filtered ? (
      <FilteredEmptyState clearHref="/contacts" />
    ) : (
      <EmptyState
        title="No contacts yet"
        description="Contacts are the other people around a job — the architect, the site engineer, the spouse who picks the tile."
        action={{ href: '/contacts/new', label: 'Add contact' }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {page.rows.map((contact) => (
          <li key={contact.id}>
            <Link
              href={`/contacts/${contact.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 hover:bg-accent"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{contact.full_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[STAKEHOLDER_ROLE_LABELS[contact.role], formatPhone(contact.phone)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {contact.is_referral_source ? <Badge tone="won">Referrer</Badge> : null}
                <Badge tone={contact.influence === 'DECISION_MAKER' ? 'active' : 'muted'}>
                  {INFLUENCE_LABELS[contact.influence]}
                </Badge>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Pagination page={page} basePath="/contacts" searchParams={flat} />
    </div>
  )
}
