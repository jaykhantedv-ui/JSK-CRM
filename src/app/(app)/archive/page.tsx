import type { Metadata } from 'next'

import { EmptyState, ForbiddenState } from '@/components/shared/states'
import { Pagination } from '@/components/shared/pagination'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonClass } from '@/components/ui/button'
import { formatDateTime } from '@/lib/dates'
import { parsePageParams } from '@/lib/pagination'
import { canArchive } from '@/lib/permissions'
import { restoreRecordAction } from '@/features/archive/actions'
import { RestoreControl } from '@/features/archive/archive-control'
import { requireUser } from '@/services/auth.service'
import {
  ARCHIVABLE_ENTITIES,
  listArchived,
  type ArchivableEntity,
} from '@/services/archive.service'
import { userNames } from '@/services/reference.service'

export const metadata: Metadata = { title: 'Archive · JSK CRM' }

const TAB_LABELS: Record<ArchivableEntity, string> = {
  account: 'Customers',
  opportunity: 'Opportunities',
  project: 'Projects',
  contact: 'Contacts',
}

type SearchParams = Promise<{ entity?: string; page?: string }>

/**
 * The archive (§12.2, §8.8).
 *
 * **The one screen in the application that deliberately does not filter
 * `archived_at is null`** — it is the archive view CLAUDE.md §11 carves out.
 * Everything here is still subject to the same RLS policies, so a manager sees
 * archived records from their own outlets and nobody else's.
 *
 * Nothing offers a delete, because nothing in this system deletes.
 */
export default async function ArchivePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser()
  if (!canArchive(user)) return (
      <ForbiddenState title="This screen is not part of your role"
      description="Ask the owner or an administrator if you need it."
      />
    )

  const params = await searchParams
  const entity = (ARCHIVABLE_ENTITIES as readonly string[]).includes(params.entity ?? '')
    ? (params.entity as ArchivableEntity)
    : 'account'

  const page = parsePageParams(params)
  const [result, names] = await Promise.all([listArchived(entity, page), userNames()])

  return (
    <div className="flex flex-col gap-6 py-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Archive</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Archived records keep every relationship and every activity. They do not appear in
          lists, dashboards or pipeline totals, and they can be restored.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Archived record type">
        {ARCHIVABLE_ENTITIES.map((value) => (
          <a
            key={value}
            href={`/archive?entity=${value}`}
            className={buttonClass(value === entity ? 'primary' : 'outline', 'sm')}
          >
            {TAB_LABELS[value]}
          </a>
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>
            {TAB_LABELS[entity]} · {result.total}
          </CardTitle>
        </CardHeader>
        <CardBody>
          {result.rows.length === 0 ? (
            <EmptyState
              title={`No archived ${TAB_LABELS[entity].toLowerCase()}`}
              description="Records you archive appear here."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {result.rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Archived {formatDateTime(row.archivedAt)}
                      {row.archivedBy ? ` by ${names[row.archivedBy] ?? 'someone'}` : ''}
                    </p>
                  </div>
                  <RestoreControl
                    action={restoreRecordAction.bind(null, { entity, id: row.id })}
                    name={row.name}
                  />
                </li>
              ))}
            </ul>
          )}

          <Pagination page={result} basePath="/archive" searchParams={{ entity }} />
        </CardBody>
      </Card>
    </div>
  )
}
