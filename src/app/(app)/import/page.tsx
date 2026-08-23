import type { Metadata } from 'next'
import Link from 'next/link'

import { EmptyState, ForbiddenState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { buttonClass } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/dates'
import { templateColumnsFor } from '@/lib/import/templates'
import { canImportCsv } from '@/lib/permissions'
import { toRoute } from '@/lib/routes'
import { uploadImportAction } from '@/features/import/actions'
import { ImportUploadForm } from '@/features/import/upload-form'
import { requireUser } from '@/services/auth.service'
import { listImportBatches } from '@/services/import.service'

export const metadata: Metadata = { title: 'Import · JSK CRM' }

/**
 * Historical data import (§20).
 *
 * **The historical books are still on paper.** This screen exists so the business
 * can bring them across when it has prepared a file; it does not assume one
 * exists, and it invents no sample data to make itself look busy.
 *
 * OWNER and ADMIN only. The nav hides it for everyone else, but hiding is not the
 * control — the RLS policies on `import_batches` are, and this page would return
 * nothing for a salesperson who typed the URL.
 */
export default async function ImportPage() {
  const user = await requireUser()
  if (!canImportCsv(user)) return (
      <ForbiddenState title="This screen is not part of your role"
      description="Ask the owner or an administrator if you need it."
      />
    )

  const batches = await listImportBatches()

  return (
    <div className="flex flex-col gap-6 py-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Import</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Bring customers and contacts across from a spreadsheet. Nothing is created until you
          have seen what the file contains and confirmed it.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New import</CardTitle>
          </CardHeader>
          <CardBody>
            <ImportUploadForm action={uploadImportAction} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Templates</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {/*
              Plain anchors, deliberately. These are file downloads served by a
              route handler with a `Content-Disposition` header; `next/link`
              would attempt a client-side navigation to a response that is not a
              page, and the browser would never save the file.
            */}
            <div className="flex flex-wrap gap-2">
              <a className={buttonClass('outline', 'sm')} href="/api/import-template/accounts" download>
                Customers template
              </a>
              <a className={buttonClass('outline', 'sm')} href="/api/import-template/contacts" download>
                Contacts template
              </a>
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                What the customer columns mean
              </summary>
              <dl className="mt-3 flex flex-col gap-2">
                {templateColumnsFor('accounts').map((column) => (
                  <div key={column.name}>
                    <dt className="font-mono text-xs">
                      {column.name}
                      {column.required ? ' *' : ''}
                    </dt>
                    <dd className="text-xs text-muted-foreground">{column.description}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Previous imports</CardTitle>
        </CardHeader>
        <CardBody>
          {batches.length === 0 ? (
            <EmptyState
              title="No imports yet"
              description="Uploaded files and their results appear here."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {batches.map((batch) => (
                <li key={batch.id} className="py-3">
                  <Link
                    href={toRoute(`/import/${batch.id}`)}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm hover:underline"
                  >
                    <span className="font-medium">{batch.file_name}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Badge tone={STATUS_TONE[batch.status] ?? 'muted'}>{batch.status}</Badge>
                      {batch.imported_rows > 0 ? `${batch.imported_rows} imported · ` : ''}
                      {formatDateTime(batch.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

const STATUS_TONE: Record<string, 'won' | 'overdue' | 'at-risk' | 'muted'> = {
  COMPLETED: 'won',
  FAILED: 'overdue',
  ROLLED_BACK: 'at-risk',
  REVIEW: 'at-risk',
}
