import Link from 'next/link'

import { buttonClass } from '@/components/ui/button'
import type { Paginated } from '@/lib/pagination'
import { toRoute } from '@/lib/routes'

/**
 * List pagination (§12.8).
 *
 * State lives in the URL, so a filtered page is shareable and the back button
 * behaves. Plain links rather than a client component: a Server Component list
 * needs no JavaScript to turn a page.
 */
export function Pagination<T>({
  page,
  basePath,
  searchParams,
}: {
  page: Paginated<T>
  basePath: string
  searchParams: Record<string, string | undefined>
}) {
  if (page.totalPages <= 1) return null

  const hrefFor = (target: number) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(searchParams)) {
      if (value && key !== 'page') params.set(key, value)
    }
    if (target > 1) params.set('page', String(target))
    const query = params.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  return (
    <nav className="flex items-center justify-between gap-3 pt-2" aria-label="Pagination">
      {page.hasPrevious ? (
        <Link href={toRoute(hrefFor(page.page - 1))} className={buttonClass('outline', 'sm')}>
          Previous
        </Link>
      ) : (
        <span />
      )}
      <p className="text-xs text-muted-foreground">
        Page {page.page} of {page.totalPages} · {page.total} total
      </p>
      {page.hasNext ? (
        <Link href={toRoute(hrefFor(page.page + 1))} className={buttonClass('outline', 'sm')}>
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}
