import type { Metadata } from 'next'
import Link from 'next/link'

import { ActivityTimeline } from '@/components/shared/activity-timeline'
import { Pagination } from '@/components/shared/pagination'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { MOBILE_PAGE_SIZE, parsePageParams } from '@/lib/pagination'
import { listTimeline } from '@/services/activity.service'
import { getAccount } from '@/services/account.service'
import { userNames } from '@/services/reference.service'

export const metadata: Metadata = { title: 'Activity · JSK CRM' }

/**
 * The full customer timeline (§12.4 "All activity").
 *
 * One indexed query on `activities.account_id` — which is why that column is
 * always populated, even when the activity was logged from an opportunity (§5.8).
 *
 * Paginated, like every list. Nothing here offers a delete: `activities` has no
 * DELETE policy for any role, ever (§8.10).
 */
export default async function AccountActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const query = await searchParams
  const flat = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  ) as Record<string, string | undefined>

  const [account, page, names] = await Promise.all([
    getAccount(id),
    listTimeline(id, parsePageParams(flat, MOBILE_PAGE_SIZE)),
    userNames(),
  ])

  return (
    <div className="flex flex-col gap-4">
      <header>
        <Link href={`/accounts/${id}`} className="text-sm underline underline-offset-4">
          ← {account.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">All activity</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{page.total} entries</CardTitle>
        </CardHeader>
        <CardBody>
          <ActivityTimeline activities={page.rows} performerNames={names} />
          <Pagination page={page} basePath={`/accounts/${id}/activity`} searchParams={flat} />
        </CardBody>
      </Card>
    </div>
  )
}
