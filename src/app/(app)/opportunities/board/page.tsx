import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { MoneyText } from '@/components/shared/money-text'
import { NextActionChip } from '@/components/shared/next-action-chip'
import { buttonClass } from '@/components/ui/button'
import { STAGE_LABELS } from '@/lib/labels'
import { BOARD_COLUMN_LIMIT, listBoard, parseOpportunityFilters } from '@/services/opportunity.service'
import type { NextActionType, OpportunityStage } from '@/types/domain'

export const metadata: Metadata = { title: 'Board · JSK CRM' }

/**
 * The pipeline board (§12.2) — **desktop only, ≥1024px**.
 *
 * Below that breakpoint the page says so and sends the user to the list rather
 * than rendering a board nobody can use one-handed. That is not a limitation to
 * apologise for: §12.2 specifies the Kanban as a desktop surface, and the mobile
 * pipeline is the list.
 *
 * `nurture` gets a column even though it is excluded from Pipeline Value (§9.1) —
 * work has to be pullable back out of it, and a holding stage nobody can see
 * becomes a graveyard.
 *
 * Each column is capped and says so when there is more, rather than loading
 * everything (§12.8).
 *
 * The columns are streamed behind a Suspense boundary (§12.6). The board is the
 * heaviest read in the product — nine stage queries — and awaiting all of them
 * before painting anything left the previous screen on display for the whole
 * round trip, which on a showroom connection reads as a frozen app. Now the
 * header and the list-view link paint at once and the columns arrive under a
 * skeleton that matches their final layout.
 */
export default async function BoardPage({
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
        <h1 className="text-xl font-semibold tracking-tight">Pipeline board</h1>
        <Link href="/opportunities" className={buttonClass('outline', 'sm')}>
          List view
        </Link>
      </header>

      <p className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground lg:hidden">
        The board needs a wider screen. Use the list view on a phone — it is faster anyway.
      </p>

      {/* Keyed on the filters so changing one shows the skeleton again rather
          than leaving the previous filter's columns on screen. */}
      <Suspense key={JSON.stringify(flat)} fallback={<BoardSkeleton />}>
        <BoardColumns flat={flat} />
      </Suspense>
    </div>
  )
}

/** The nine stage columns, as their own boundary so the shell paints first. */
async function BoardColumns({ flat }: { flat: Record<string, string | undefined> }) {
  const columns = await listBoard(parseOpportunityFilters(flat))

  return (
    <div className="hidden gap-3 overflow-x-auto pb-2 lg:flex">
      {columns.map((column) => (
        <section
          key={column.stage}
          className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2"
          aria-label={STAGE_LABELS[column.stage as OpportunityStage]}
        >
          <header className="flex items-baseline justify-between px-1">
            <h2 className="text-sm font-semibold">{STAGE_LABELS[column.stage as OpportunityStage]}</h2>
            <span className="text-xs text-muted-foreground">{column.total}</span>
          </header>
          <p className="px-1 text-xs text-muted-foreground">
            <MoneyText paise={column.value} compact />
          </p>

          <ul className="flex flex-col gap-2">
            {column.rows.map((row) => (
              <li key={row.id as string}>
                <Link
                  href={`/opportunities/${row.id}`}
                  className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5 hover:bg-accent"
                >
                  <span className="truncate text-sm font-medium">{row.title}</span>
                  <MoneyText paise={row.estimated_value} compact className="text-xs" />
                  <NextActionChip
                    nextAction={row.next_action as NextActionType | null}
                    nextActionDate={row.next_action_date}
                    stage={row.stage as string}
                    showType={false}
                  />
                </Link>
              </li>
            ))}
          </ul>

          {column.total > BOARD_COLUMN_LIMIT ? (
            <Link
              href={`/opportunities?stage=${column.stage}`}
              className="px-1 text-xs underline underline-offset-4"
            >
              {column.total - BOARD_COLUMN_LIMIT} more — open as a list
            </Link>
          ) : null}

          {column.rows.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">Empty</p>
          ) : null}
        </section>
      ))}
    </div>
  )
}

/** Matches the column layout, never a full-page spinner (§12.6). */
function BoardSkeleton() {
  return (
    <div className="hidden gap-3 overflow-x-auto pb-2 lg:flex" aria-hidden>
      {Array.from({ length: 6 }).map((_, column) => (
        <div key={column} className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2">
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          {Array.from({ length: 3 }).map((__, card) => (
            <div key={card} className="h-20 animate-pulse rounded-md border border-border bg-muted/40" />
          ))}
        </div>
      ))}
    </div>
  )
}
