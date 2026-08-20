import type { Metadata } from 'next'
import Link from 'next/link'

import { Card, CardBody } from '@/components/ui/card'
import { REPORTS } from '@/features/management/report-shell'
import { toRoute } from '@/lib/routes'

export const metadata: Metadata = { title: 'Reports · JSK CRM' }

/**
 * `/reports` (§12.2) — the index.
 *
 * Eleven reports, each named for the question it answers rather than for the
 * table it reads. Every one respects the caller's outlet scope, filters by
 * period, paginates its lists and exports the view on screen (§16, §17).
 */
export default function ReportsPage() {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Everything below covers the branches you manage. Pick a period on each report.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <li key={report.href}>
            <Card className="h-full transition-colors hover:bg-accent">
              <Link
                href={toRoute(report.href)}
                className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CardBody className="pt-3">
                  <p className="font-medium">{report.label}</p>
                  <p className="text-sm text-muted-foreground">{report.description}</p>
                </CardBody>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
