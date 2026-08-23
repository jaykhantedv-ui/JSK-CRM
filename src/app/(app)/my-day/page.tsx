import type { Metadata } from 'next'
import Link from 'next/link'

import { EmptyState } from '@/components/shared/states'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { ACTIVITY_TYPE_LABELS } from '@/lib/labels'
import { formatDateTime } from '@/lib/dates'
import { routes } from '@/lib/routes'
import { requireUser } from '@/services/auth.service'
import { getMyDay } from '@/services/dashboard.service'

export const metadata: Metadata = { title: 'My Day · JSK CRM' }

/**
 * `/my-day` — one person's day, closed off (ADR-040).
 *
 * `/today` answers *what is waiting on me*, across every horizon. This answers
 * the narrower question the same person asks at the end of the day: *what did I
 * say I would do today, and what did I actually do?* The two columns are the
 * point — the gap between them is what gets missed.
 *
 * **Nothing here is anyone else's.** No team totals, no comparison, no
 * leaderboard (§13.2). The queries filter on the caller's own id and row-level
 * security would refuse them anything else regardless.
 */
export default async function MyDayPage() {
  const user = await requireUser()
  const day = await getMyDay()

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">My Day</h1>
        <p className="text-sm text-muted-foreground">
          {user.fullName.split(' ')[0]} — what you planned for today, and what you have logged.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Planned for today</CardTitle>
          </CardHeader>
          <CardBody className="pt-0">
            {day.dueToday.length === 0 && day.overdue.length === 0 ? (
              <EmptyState title="Nothing due today" description="Your next actions are all ahead of you." />
            ) : (
              <ul className="divide-y">
                {[...day.overdue, ...day.dueToday].map((row) => (
                  <li key={row.id} className="py-2">
                    {/* The flags VIEW types every column as nullable; `id` is a
                        primary key and cannot be. Cast at the boundary, as
                        `/today` does with the same rows. */}
                    <Link
                      href={routes.opportunity(row.id as string)}
                      className="text-sm font-medium hover:underline"
                    >
                      {row.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {(row.account_id && day.accountNames[row.account_id]) || '—'}
                      {row.is_overdue ? ' · overdue' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Logged today</CardTitle>
          </CardHeader>
          <CardBody className="pt-0">
            {day.loggedToday.length === 0 ? (
              // Not a zero and not a placeholder: an empty day is a real answer
              // and reads as one (§12.6).
              <EmptyState
                title="Nothing logged yet"
                description="Calls, visits and notes you record today appear here."
              />
            ) : (
              <ul className="divide-y">
                {day.loggedToday.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-3 py-2">
                    {/* `activities.account_id` is always populated (§8.10), and
                        the type still admits null, so the label stands alone
                        rather than becoming a broken link. */}
                    {entry.account_id ? (
                      <Link
                        href={routes.accountActivity(entry.account_id)}
                        className="text-sm font-medium hover:underline"
                      >
                        {ACTIVITY_TYPE_LABELS[entry.type]}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium">{ACTIVITY_TYPE_LABELS[entry.type]}</span>
                    )}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(entry.occurred_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
