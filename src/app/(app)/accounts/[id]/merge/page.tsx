import type { Metadata } from 'next'
import Link from 'next/link'

import { EmptyState, ForbiddenState } from '@/components/shared/states'
import { buttonClass } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { isManagerOrAbove } from '@/lib/permissions'
import { toRoute } from '@/lib/routes'
import { mergeAccountsAction } from '@/features/accounts/actions'
import { MergeForm } from '@/features/accounts/merge-form'
import { getAccount, listAccounts, previewAccountMerge } from '@/services/account.service'
import { requireUser } from '@/services/auth.service'

export const metadata: Metadata = { title: 'Merge customers · JSK CRM' }

type Params = Promise<{ id: string }>
type SearchParams = Promise<{ into?: string; q?: string }>

/**
 * §8.9 — manual account merge. MANAGER and OWNER only.
 *
 * Two steps: pick the surviving record, then confirm against a complete preview.
 * **Never automatic** (§14.8 rules out auto-merging duplicates entirely) and
 * never reversible in V1 (ADR-008).
 *
 * The candidate list is a plain search rather than a duplicate-detection feed:
 * §8.9's scoring is advisory and exists to warn at creation time, and using it to
 * pre-select a merge target would edge towards the automatic merging §14.8
 * forbids.
 */
export default async function MergeAccountPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const user = await requireUser()
  if (!isManagerOrAbove(user)) return <ForbiddenState backHref="/accounts" />

  const { id } = await params
  const { into, q } = await searchParams

  const source = await getAccount(id)

  if (into) {
    const preview = await previewAccountMerge(id, into)
    return (
      <div className="flex flex-col gap-6 py-4">
        <header className="flex flex-col gap-1">
          <Link href={toRoute(`/accounts/${id}/merge`)} className="text-sm text-muted-foreground hover:underline">
            ← Choose a different customer
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">Confirm merge</h1>
        </header>

        <Card>
          <CardBody>
            <MergeForm
              preview={preview}
              action={mergeAccountsAction.bind(null, { sourceId: id, targetId: into })}
            />
          </CardBody>
        </Card>
      </div>
    )
  }

  const candidates = await listAccounts({ q: q ?? source.name }, { page: 1, pageSize: 25 })

  const others = candidates.rows.filter((row) => row.id !== id)

  return (
    <div className="flex flex-col gap-6 py-4">
      <header className="flex flex-col gap-1">
        <Link href={toRoute(`/accounts/${id}`)} className="text-sm text-muted-foreground hover:underline">
          ← {source.name}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Merge {source.name} into…</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Choose the record to keep. Everything on {source.name} — contacts, projects,
          opportunities and the full activity history — moves across, and {source.name} is
          archived. This cannot be undone.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Find the customer to keep</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <form className="flex gap-2" action={toRoute(`/accounts/${id}/merge`)}>
            <input
              type="search"
              name="q"
              defaultValue={q ?? source.name}
              placeholder="Search by name or phone"
              className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
            />
            <button type="submit" className={buttonClass('secondary', 'md')}>
              Search
            </button>
          </form>

          {others.length === 0 ? (
            <EmptyState
              title="No other customers found"
              description="Try a different search term."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {others.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.phone ?? row.email ?? '—'}
                      {row.city ? ` · ${row.city}` : ''}
                    </p>
                  </div>
                  <Link
                    href={toRoute(`/accounts/${id}/merge?into=${row.id}`)}
                    className={buttonClass('outline', 'sm')}
                  >
                    Keep this one
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
