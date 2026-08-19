'use client'

import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { useState } from 'react'

import { MIN_SEARCH_LENGTH } from '@/lib/search'

/**
 * The global search box (§12.3 top bar, §11.10).
 *
 * It only navigates — `/search` does the work on the server, where the query runs
 * under the user's own session and RLS decides what exists. Nothing is fetched
 * from the browser, so there is no client-side Supabase call here (CLAUDE.md §7).
 */
export function GlobalSearch({ initialQuery = '' }: { initialQuery?: string }) {
  const router = useRouter()
  const [term, setTerm] = useState(initialQuery)

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        const query = term.trim()
        if (query.length >= MIN_SEARCH_LENGTH) router.push(`/search?q=${encodeURIComponent(query)}`)
      }}
      className="relative w-full max-w-md"
    >
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        name="q"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search name, phone, project…"
        aria-label="Search customers, projects, opportunities and contacts"
        className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
      />
    </form>
  )
}
