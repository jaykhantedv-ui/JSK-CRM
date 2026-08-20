import type { Metadata } from 'next'
import Link from 'next/link'

import { ForbiddenState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/dates'
import { canImportCsv, isOwner } from '@/lib/permissions'
import {
  executeImportAction,
  rollbackImportAction,
  setRowDecisionAction,
} from '@/features/import/actions'
import { DuplicateDecisions } from '@/features/import/duplicate-decisions'
import { RollbackControl, RunImportControl } from '@/features/import/run-controls'
import { requireUser } from '@/services/auth.service'
import { getImportBatch } from '@/services/import.service'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Import preview · JSK CRM' }

type Params = Promise<{ batchId: string }>

/**
 * Steps 3–8 of §20.1: preview, duplicate analysis, decisions, import, result.
 *
 * Everything on this screen is computed from the rows actually parsed out of the
 * uploaded file. **No invented counts and no sample rows** (CLAUDE.md §15) — if a
 * file has three errors, this shows three errors and what they are.
 */
export default async function ImportBatchPage({ params }: { params: Params }) {
  const user = await requireUser()
  if (!canImportCsv(user)) return <ForbiddenState />

  const { batchId } = await params
  const detail = await getImportBatch(batchId)
  const { batch, rows, duplicates, undecidedCount, rollback } = detail

  const errors = rows.filter((row) => row.status === 'ERROR')
  const warnings = rows.filter((row) => row.status === 'WARNING')
  const importable = rows.filter(
    (row) => row.status === 'VALID' || row.status === 'WARNING',
  ).length

  const existingNames = await namesFor(batch.entity, duplicates.map((row) => row.duplicate_of))

  const runAction = executeImportAction.bind(null, batch.id)
  const rollbackAction = rollbackImportAction.bind(null, batch.id)

  return (
    <div className="flex flex-col gap-6 py-4">
      <header className="flex flex-col gap-1">
        <Link href="/import" className="text-sm text-muted-foreground hover:underline">
          ← All imports
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{batch.file_name}</h1>
        <p className="text-sm text-muted-foreground">
          {batch.entity === 'accounts' ? 'Customers' : 'Contacts'} ·{' '}
          {batch.total_rows.toLocaleString('en-IN')} rows · uploaded{' '}
          {formatDateTime(batch.created_at)}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Summary label="Ready to import" value={importable} tone="won" />
        <Summary label="Need a decision" value={duplicates.length} tone="at-risk" />
        <Summary label="Errors" value={errors.length} tone="overdue" />
        <Summary label="Warnings" value={warnings.length} tone="muted" />
      </div>

      {batch.status === 'COMPLETED' || batch.status === 'ROLLED_BACK' ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {batch.status === 'ROLLED_BACK' ? 'Rolled back' : 'Imported'}
            </CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <p className="text-sm">
              {batch.imported_rows.toLocaleString('en-IN')} records were created
              {batch.completed_at ? ` on ${formatDateTime(batch.completed_at)}` : ''}.
            </p>
            {/* §20.6 — OWNER only, seven days, nothing edited since. */}
            {isOwner(user) && batch.status === 'COMPLETED' ? (
              <RollbackControl
                action={rollbackAction}
                eligible={rollback.eligible}
                reason={rollback.reason}
                expiresAt={rollback.expiresAt}
              />
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Import</CardTitle>
          </CardHeader>
          <CardBody>
            <RunImportControl
              action={runAction}
              blocked={undecidedCount}
              rowCount={importable + duplicates.filter((row) => row.decision === 'IMPORT').length}
            />
          </CardBody>
        </Card>
      )}

      {duplicates.length > 0 && batch.status === 'REVIEW' ? (
        <Card>
          <CardHeader>
            <CardTitle>Possible duplicates</CardTitle>
          </CardHeader>
          <CardBody>
            <DuplicateDecisions
              rows={duplicates}
              existingNames={existingNames}
              onDecide={setRowDecisionAction}
            />
          </CardBody>
        </Card>
      ) : null}

      {errors.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Rows that cannot be imported</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {errors.slice(0, 100).map((row) => (
                <li key={row.id} className="py-2">
                  <p className="font-medium">
                    Row {row.row_number}: {row.raw.name || row.raw.full_name || '—'}
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                    {row.messages
                      .filter((message) => message.level === 'ERROR')
                      .map((message, index) => (
                        <li key={index}>
                          {message.field ? `${message.field}: ` : ''}
                          {message.message}
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
            {errors.length > 100 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {errors.length - 100} more rows have errors. Fix the file and upload it again.
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'won' | 'overdue' | 'at-risk' | 'muted'
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {value > 0 ? <Badge tone={tone}>{label}</Badge> : null}
      </p>
    </div>
  )
}

/**
 * Names for the records a duplicate row matched.
 *
 * `duplicate_of` is deliberately polymorphic with no foreign key (M-22) — the
 * entity type comes from the batch — so the lookup is explicit rather than an
 * embedded join.
 */
async function namesFor(
  entity: string,
  ids: (string | null)[],
): Promise<Record<string, string>> {
  const wanted = ids.filter(Boolean) as string[]
  if (wanted.length === 0) return {}

  const supabase = await createSupabaseServerClient()

  if (entity === 'accounts') {
    const { data } = await supabase.from('accounts').select('id, name').in('id', wanted)
    return Object.fromEntries((data ?? []).map((row) => [row.id, row.name]))
  }

  const { data } = await supabase.from('contacts').select('id, full_name').in('id', wanted)
  return Object.fromEntries((data ?? []).map((row) => [row.id, row.full_name]))
}
