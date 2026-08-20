'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Select } from '@/components/ui/field'
import { toRoute } from '@/lib/routes'
import { cn } from '@/lib/utils'

/**
 * The filter bar (§12.5) — **state in URL params**.
 *
 * Keeping filters in the query string is what makes a filtered list shareable
 * with a colleague, survivable across a refresh, and correct with the back
 * button. Every list in the application reads its filters from
 * `searchParams` on the server, so this only has to write them.
 *
 * Changing any filter resets to page 1: leaving `?page=7` in place after
 * narrowing a list is how a user lands on an empty screen that looks broken.
 */
export type FilterDefinition = {
  key: string
  label: string
  options: { value: string; label: string }[]
}

export function FilterBar({
  filters,
  searchPlaceholder = 'Search',
  className,
}: {
  filters: FilterDefinition[]
  searchPlaceholder?: string
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [term, setTerm] = useState(params.get('q') ?? '')

  // Keep the box in step when navigation changes the URL beneath it — a cleared
  // filter link must clear the text too.
  useEffect(() => {
    setTerm(params.get('q') ?? '')
  }, [params])

  const push = (next: URLSearchParams) => {
    next.delete('page')
    const query = next.toString()
    router.push(toRoute(query ? `${pathname}?${query}` : pathname))
  }

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    push(next)
  }

  return (
    <form
      className={cn('flex flex-wrap items-end gap-2', className)}
      onSubmit={(event) => {
        event.preventDefault()
        setParam('q', term.trim())
      }}
      role="search"
    >
      <div className="relative min-w-0 flex-1 basis-56">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          name="q"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
      </div>

      {filters.map((filter) => (
        <label key={filter.key} className="flex min-w-36 flex-col gap-1 text-xs text-muted-foreground">
          {filter.label}
          <Select
            aria-label={filter.label}
            value={params.get(filter.key) ?? ''}
            onChange={(event) => setParam(filter.key, event.target.value)}
            placeholder={`All ${filter.label.toLowerCase()}`}
            options={filter.options}
            className="h-10 text-sm"
          />
        </label>
      ))}

      <button type="submit" className="sr-only">
        Apply filters
      </button>
    </form>
  )
}
