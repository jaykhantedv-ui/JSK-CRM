'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Download } from 'lucide-react'

import { Select } from '@/components/ui/field'
import { buttonClass } from '@/components/ui/button'
import { PERIOD_KEYS, PERIOD_LABELS, type PeriodKey } from '@/lib/period'
import { toRoute } from '@/lib/routes'

/**
 * The management filter bar — period, branch, salesperson — plus the export
 * control (§16, §17).
 *
 * **These filters NARROW; they never widen.** Selecting a branch adds
 * `?outlet=`, which the services pass to a `SECURITY INVOKER` RPC. A manager who
 * hand-types another branch's id gets an empty report, because row-level
 * security still bounds what the query can see (§15). The dropdown is a
 * convenience, not a control — which is why the options only ever contain
 * branches the caller manages.
 *
 * State lives in URL params, like every other filter in the application, so a
 * filtered report is shareable, survives a refresh and works with the back
 * button.
 */

export type ScopeOption = { value: string; label: string }

export function ScopeBar({
  outlets,
  people,
  exportDataset,
  showPeriod = true,
}: {
  /** Only branches the caller manages. An empty list hides the control entirely. */
  outlets?: ScopeOption[]
  people?: ScopeOption[]
  /** Omitted on screens with nothing meaningful to export. */
  exportDataset?: string
  showPeriod?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    // Narrowing a report and staying on page 7 lands the user on an empty screen
    // that looks broken.
    next.delete('page')
    const query = next.toString()
    router.push(toRoute(query ? `${pathname}?${query}` : pathname))
  }

  const exportHref = () => {
    const next = new URLSearchParams(params.toString())
    next.delete('page')
    const query = next.toString()
    return `/api/export/${exportDataset}${query ? `?${query}` : ''}`
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      {showPeriod ? (
        <label className="flex min-w-40 flex-col gap-1 text-xs text-muted-foreground">
          Period
          <Select
            aria-label="Period"
            value={params.get('period') ?? 'this_month'}
            onChange={(event) => setParam('period', event.target.value)}
            options={PERIOD_KEYS.filter((key) => key !== 'custom').map((key: PeriodKey) => ({
              value: key,
              label: PERIOD_LABELS[key],
            }))}
            className="h-10 text-sm"
          />
        </label>
      ) : null}

      {outlets && outlets.length > 1 ? (
        <label className="flex min-w-40 flex-col gap-1 text-xs text-muted-foreground">
          Branch
          <Select
            aria-label="Branch"
            value={params.get('outlet') ?? ''}
            onChange={(event) => setParam('outlet', event.target.value)}
            placeholder="All branches"
            options={outlets}
            className="h-10 text-sm"
          />
        </label>
      ) : null}

      {people && people.length > 0 ? (
        <label className="flex min-w-40 flex-col gap-1 text-xs text-muted-foreground">
          Salesperson
          <Select
            aria-label="Salesperson"
            value={params.get('owner') ?? ''}
            onChange={(event) => setParam('owner', event.target.value)}
            placeholder="Everyone"
            options={people}
            className="h-10 text-sm"
          />
        </label>
      ) : null}

      {exportDataset ? (
        // A plain link, not a fetch: the browser downloads what the route
        // returns, and the route re-checks the caller's role server-side. The
        // button being visible is not what makes the export allowed (C-2).
        <a
          href={exportHref()}
          className={buttonClass('outline', 'sm', 'ml-auto')}
          data-testid="export-csv"
        >
          <Download className="size-4" aria-hidden />
          Export CSV
        </a>
      ) : null}
    </div>
  )
}
