import Link from 'next/link'
import type { ReactNode } from 'react'

import { toRoute } from '@/lib/routes'
import { cn } from '@/lib/utils'

/**
 * The management table (§12.1 — "manager screens optimise for density").
 *
 * Two things it does that a bare `<table>` does not:
 *
 * **It scrolls horizontally inside itself.** A branch comparison has twelve
 * columns and an owner reads it on a phone (§1.3). Letting the page scroll
 * sideways instead breaks every other screen; the overflow belongs to the table.
 *
 * **Every row can be a link.** §21 — a management row that cannot be opened is a
 * dead end. Where a row has a record behind it, the whole row is the target
 * rather than a single small cell.
 */

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** Right-align numbers so a column of figures reads as a column. */
  numeric?: boolean
  /** Hidden below `sm`. The columns a phone can lose without losing the point. */
  secondary?: boolean
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  caption,
  footer,
}: {
  columns: readonly Column<T>[]
  rows: readonly T[]
  rowKey: (row: T) => string
  rowHref?: (row: T) => string | null
  caption?: string
  footer?: ReactNode
}) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-border text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-3 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground',
                  column.numeric && 'text-right',
                  column.secondary && 'hidden sm:table-cell',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row) ?? null
            return (
              <tr key={rowKey(row)} className="border-b border-border last:border-0 hover:bg-accent">
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-3 py-2.5 align-middle',
                      column.numeric && 'text-right tabular-nums',
                      column.secondary && 'hidden sm:table-cell',
                    )}
                  >
                    {/* The link wraps the first cell's content and stretches over
                        the row, so the whole row is clickable without nesting an
                        anchor inside every cell — which would be invalid and
                        would make the row unreadable to a screen reader. */}
                    {href && index === 0 ? (
                      <Link
                        href={toRoute(href)}
                        className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {column.cell(row)}
                      </Link>
                    ) : (
                      column.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
        {footer ? <tfoot className="border-t-2 border-border font-medium">{footer}</tfoot> : null}
      </table>
    </div>
  )
}
