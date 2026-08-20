import { z } from 'zod'

import { parseCsv } from '@/lib/csv'
import { AppError, forbidden, fromPostgrestError, notFound } from '@/lib/errors'
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '@/lib/files'
import { IMPORT_ENTITIES, type ImportEntity } from '@/lib/import/templates'
import {
  missingRequiredColumns,
  storedStatusFor,
  validateRows,
  type ValidatedRow,
  type ValidationContext,
} from '@/lib/import/validate'
import { isOwner, isOwnerOrAdmin } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'

import { requireUser } from './auth.service'
import { getSetting } from './settings.service'

/**
 * Historical data import (§20).
 *
 * **The historical books are still on paper.** This builds the capability; it
 * assumes no file exists yet. Accounts and contacts only in V1 (TODO-BD-10).
 *
 * Flow, exactly §20.1:
 *   upload → validate → preview → duplicate analysis → per-row decision →
 *   import → result summary → (rollback available 7 days)
 *
 * Three things about this service are load-bearing and easy to erode:
 *
 * 1. **OWNER and ADMIN only.** Checked here, and again by the RLS policies on
 *    `import_batches` / `import_rows`, which is what makes it hold against a
 *    direct PostgREST call from a salesperson's JWT.
 *
 * 2. **The service-role client appears only in `executeImport` and
 *    `rollbackImport`, and only AFTER the role check above.** ADR-009 is explicit
 *    that reversing that order is a privilege-escalation hole. Read those two
 *    functions as a pair: check, then escalate, never the reverse.
 *
 * 3. **Import fires no notifications.** §25 names a false alert storm as the
 *    failure that permanently destroys trust in every alert the system sends —
 *    importing four thousand historical customers must not tell sixteen
 *    salespeople they have four thousand overdue follow-ups. See
 *    `is_imported` below.
 */

export const importEntitySchema = z.enum(IMPORT_ENTITIES)

/**
 * How import suppresses automation, and why it is a COLUMN rather than a flag.
 *
 * §20.5 describes "a transaction-local flag [that] suppresses SLA notification
 * eligibility". A transaction-local flag cannot do that job: the SLA job runs
 * hourly, long after the import transaction has committed and its GUC has gone.
 * Phase 15's own risk note says the suppression "must survive the cron path, not
 * just the request path" — so the durable `is_imported` column every created row
 * already carries (§20.5) is the mechanism, and the cron queries exclude it.
 *
 * It is also the truthful rule rather than a workaround: a customer copied out of
 * a 2019 register is not a new enquiry that somebody failed to answer within 48
 * hours, and never becomes one.
 *
 * Recorded in `/docs/DECISIONS.md` as ADR-025.
 */
export const IMPORT_SUPPRESSES_NOTIFICATIONS = true

export type ImportBatchRow = {
  id: string
  entity: string
  file_name: string
  status: string
  total_rows: number
  valid_rows: number
  warning_rows: number
  error_rows: number
  imported_rows: number
  uploaded_by: string
  completed_at: string | null
  created_at: string
}

export type ImportRowRecord = {
  id: string
  row_number: number
  raw: Record<string, string>
  status: string
  messages: { level: string; field?: string; message: string }[]
  duplicate_of: string | null
  decision: string | null
  created_entity_id: string | null
}

async function requireImporter() {
  const user = await requireUser()
  if (!isOwnerOrAdmin(user)) {
    throw forbidden('Only the owner or an administrator can import data.')
  }
  return user
}

/**
 * Assemble everything validation needs to know about existing data.
 *
 * Read through the USER's client, so row-level security applies — an ADMIN
 * running an import sees what the policies let them see. The reads are bounded by
 * the same 5,000-row ceiling the file is, which keeps this honest at the scale
 * §24 describes (twenty users, ten outlets) without pretending to be a bulk
 * matching engine.
 */
async function buildValidationContext(
  entity: ImportEntity,
  fallbackOwnerId: string,
  fallbackOutletId: string | null,
): Promise<ValidationContext> {
  const supabase = await createSupabaseServerClient()

  const [users, outlets, cities, accounts, contacts] = await Promise.all([
    supabase
      .from('users')
      .select('id, email, user_outlets!user_outlets_user_id_fkey(outlet_id, revoked_at)')
      .eq('is_active', true),
    supabase.from('outlets').select('id, code').eq('is_active', true),
    getSetting('cities'),
    supabase
      .from('accounts')
      .select('id, name, phone_normalized, email_normalized, owner_id, outlet_id')
      .is('archived_at', null),
    entity === 'contacts'
      ? supabase
          .from('contacts')
          .select('id, full_name, phone_normalized, email')
          .is('archived_at', null)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (users.error) throw fromPostgrestError(users.error)
  if (outlets.error) throw fromPostgrestError(outlets.error)
  if (accounts.error) throw fromPostgrestError(accounts.error)
  if (contacts.error) throw fromPostgrestError(contacts.error)

  return {
    usersByEmail: new Map(
      (users.data ?? []).map((user) => [
        user.email.toLowerCase(),
        {
          id: user.id,
          outletId:
            (user.user_outlets ?? []).find((row) => row.revoked_at === null)?.outlet_id ?? null,
        },
      ]),
    ),
    outletsByCode: new Map((outlets.data ?? []).map((outlet) => [outlet.code.toUpperCase(), outlet.id])),
    cities,
    existingAccounts: (accounts.data ?? []).map((account) => ({
      id: account.id,
      name: account.name,
      phoneNormalized: account.phone_normalized,
      emailNormalized: account.email_normalized,
      ownerId: account.owner_id,
      outletId: account.outlet_id,
    })),
    existingContacts: (contacts.data ?? []).map((contact) => ({
      id: contact.id,
      fullName: contact.full_name,
      phoneNormalized: contact.phone_normalized,
      emailNormalized: contact.email?.toLowerCase() ?? null,
    })),
    fallbackOwnerId,
    fallbackOutletId,
  }
}

export type UploadResult = {
  batchId: string
  counts: { total: number; valid: number; warning: number; error: number; duplicate: number }
}

/**
 * Upload and validate a file. Creates the batch and its rows; imports nothing.
 *
 * The batch lands in `REVIEW` because that is what the state means: validated,
 * waiting for a human. Nothing is created in the business tables until
 * `executeImport` runs.
 */
export async function uploadImportFile(input: {
  entity: string
  fileName: string
  csv: string
}): Promise<UploadResult> {
  const user = await requireImporter()

  const entity = importEntitySchema.parse(input.entity)
  const fileName = z.string().trim().min(1).max(255).parse(input.fileName)

  // §20.1: 5 MB. Measured in bytes, not characters — a Tamil customer list is
  // multi-byte and a character count would let a file through that is twice the
  // stated limit.
  const byteLength = Buffer.byteLength(input.csv, 'utf8')
  if (byteLength > MAX_IMPORT_BYTES) {
    throw new AppError(
      'VALIDATION_FAILED',
      `That file is larger than ${Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))} MB. Split it and import in parts.`,
      { field: 'file' },
    )
  }

  const parsed = parseCsv(input.csv)

  if (parsed.rows.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'That file has no rows.', { field: 'file' })
  }

  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw new AppError(
      'VALIDATION_FAILED',
      `That file has ${parsed.rows.length} rows. The limit is ${MAX_IMPORT_ROWS} per import.`,
      { field: 'file' },
    )
  }

  const missing = missingRequiredColumns(entity, parsed.headers)
  if (missing.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      `The file is missing required columns: ${missing.join(', ')}.`,
      { field: 'file' },
    )
  }

  const context = await buildValidationContext(
    entity,
    user.id,
    user.outletIds.length === 1 ? user.outletIds[0] : null,
  )
  const result = validateRows(entity, parsed.rows, context)

  // A misaligned row is reported on the row itself rather than failing the file:
  // the reviewer can see which line to fix.
  for (const rowNumber of parsed.malformedRows) {
    const row = result.rows.find((candidate) => candidate.rowNumber === rowNumber)
    if (row) {
      row.messages.push({
        level: 'WARNING',
        message: 'This line has more values than the header. Extra values were ignored.',
      })
    }
  }

  const supabase = await createSupabaseServerClient()

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      entity,
      file_name: fileName,
      status: 'UPLOADED',
      total_rows: result.counts.total,
      valid_rows: result.counts.valid,
      warning_rows: result.counts.warning,
      error_rows: result.counts.error,
      uploaded_by: user.id,
    })
    .select('id')
    .single()

  if (batchError) throw fromPostgrestError(batchError)

  await insertRows(batch.id, result.rows)

  const { error: statusError } = await supabase
    .from('import_batches')
    .update({ status: 'REVIEW' })
    .eq('id', batch.id)

  if (statusError) throw fromPostgrestError(statusError)

  return { batchId: batch.id, counts: result.counts }
}

/** Rows are written in chunks: one 5,000-row statement is a payload no proxy enjoys. */
const ROW_CHUNK = 500

async function insertRows(batchId: string, rows: readonly ValidatedRow[]): Promise<void> {
  const supabase = await createSupabaseServerClient()

  for (let offset = 0; offset < rows.length; offset += ROW_CHUNK) {
    const chunk = rows.slice(offset, offset + ROW_CHUNK).map((row) => ({
      batch_id: batchId,
      row_number: row.rowNumber,
      raw: row.raw,
      status: storedStatusFor(row) as 'VALID',
      // `Json` rather than `Record<string, unknown>`: both are jsonb columns and
      // the generated type is the narrower structural one.
      normalized: (row.normalized ?? null) as never,
      messages: row.messages as never,
      duplicate_of: row.duplicateOf ?? null,
    }))

    const { error } = await supabase.from('import_rows').insert(chunk)
    if (error) throw fromPostgrestError(error)
  }
}

export async function listImportBatches(): Promise<ImportBatchRow[]> {
  await requireImporter()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('import_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw fromPostgrestError(error)
  return (data ?? []) as ImportBatchRow[]
}

export type ImportBatchDetail = {
  batch: ImportBatchRow
  rows: ImportRowRecord[]
  duplicates: ImportRowRecord[]
  undecidedCount: number
  rollback: { eligible: boolean; reason: string | null; expiresAt: string | null }
}

/** §20.6, expressed once so the UI and the RPC cannot disagree about it. */
export const ROLLBACK_WINDOW_DAYS = 7

/**
 * Why a batch can or cannot be rolled back.
 *
 * Pure, and separated from the read so it is unit-testable: the three refusals —
 * wrong status, expired window, edited since import — are exactly what the RPC
 * enforces, and a UI that offered a button the database would refuse would be
 * worse than no button.
 */
export function rollbackEligibility(input: {
  status: string
  completedAt: string | null
  editedSinceImport: boolean
  now: Date
}): { eligible: boolean; reason: string | null; expiresAt: string | null } {
  if (input.status === 'ROLLED_BACK') {
    return { eligible: false, reason: 'This import has already been rolled back.', expiresAt: null }
  }
  if (input.status !== 'COMPLETED' || !input.completedAt) {
    return { eligible: false, reason: 'Only a completed import can be rolled back.', expiresAt: null }
  }

  const completed = new Date(input.completedAt)
  const expiresAt = new Date(completed.getTime() + ROLLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  if (input.now > expiresAt) {
    return {
      eligible: false,
      reason: `Roll back is only available for ${ROLLBACK_WINDOW_DAYS} days after an import.`,
      expiresAt: expiresAt.toISOString(),
    }
  }

  if (input.editedSinceImport) {
    return {
      eligible: false,
      reason: 'Some imported records have been edited since the import, so rolling back is no longer safe.',
      expiresAt: expiresAt.toISOString(),
    }
  }

  return { eligible: true, reason: null, expiresAt: expiresAt.toISOString() }
}

export async function getImportBatch(batchId: string): Promise<ImportBatchDetail> {
  await requireImporter()
  const id = uuidSchema.parse(batchId)
  const supabase = await createSupabaseServerClient()

  const { data: batch, error } = await supabase
    .from('import_batches')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!batch) throw notFound('import')

  const { data: rows, error: rowsError } = await supabase
    .from('import_rows')
    .select('id, row_number, raw, status, messages, duplicate_of, decision, created_entity_id')
    .eq('batch_id', id)
    .order('row_number')

  if (rowsError) throw fromPostgrestError(rowsError)

  const all = (rows ?? []) as unknown as ImportRowRecord[]
  const duplicates = all.filter(
    (row) => row.status === 'DUPLICATE_EXACT' || row.status === 'DUPLICATE_POSSIBLE',
  )

  return {
    batch: batch as ImportBatchRow,
    rows: all,
    duplicates,
    undecidedCount: duplicates.filter((row) => row.decision === null).length,
    rollback: rollbackEligibility({
      status: batch.status,
      completedAt: batch.completed_at,
      editedSinceImport: await hasEditedRecords(id, batch.completed_at),
      now: new Date(),
    }),
  }
}

/**
 * Has anything created by this batch been edited since it was imported?
 *
 * `updated_at > completed_at` is exact: an imported row's `updated_at` is stamped
 * at import and only `touch_updated_at` moves it afterwards. It is also why the
 * nightly maintenance job must leave rollback-window records alone (H-09) — a
 * maintenance write is indistinguishable from a user's edit here, and would
 * silently cost the business its undo.
 */
async function hasEditedRecords(batchId: string, completedAt: string | null): Promise<boolean> {
  if (!completedAt) return false
  const supabase = await createSupabaseServerClient()

  const [accounts, contacts] = await Promise.all([
    supabase
      .from('accounts')
      .select('id', { count: 'exact', head: true })
      .eq('import_batch_id', batchId)
      .gt('updated_at', completedAt),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('import_batch_id', batchId)
      .gt('updated_at', completedAt),
  ])

  return (accounts.count ?? 0) > 0 || (contacts.count ?? 0) > 0
}

export const decisionSchema = z.enum(['IMPORT', 'SKIP', 'LINK_EXISTING'])
export type ImportDecision = z.infer<typeof decisionSchema>

/**
 * Record the reviewer's decision for one duplicate row (§20.4).
 *
 * Only a row actually flagged as a duplicate takes a decision. A decision on a
 * clean row would be meaningless and, worse, `LINK_EXISTING` on a row with no
 * `duplicate_of` would silently import nothing.
 */
export async function setRowDecision(rowId: string, decision: ImportDecision): Promise<void> {
  await requireImporter()
  const id = uuidSchema.parse(rowId)
  const value = decisionSchema.parse(decision)

  const supabase = await createSupabaseServerClient()

  const { data: row, error: readError } = await supabase
    .from('import_rows')
    .select('id, status, duplicate_of, batch_id, import_batches(status)')
    .eq('id', id)
    .maybeSingle()

  if (readError) throw fromPostgrestError(readError)
  if (!row) throw notFound('row')

  if (row.status !== 'DUPLICATE_EXACT' && row.status !== 'DUPLICATE_POSSIBLE') {
    throw new AppError('VALIDATION_FAILED', 'Only a possible duplicate takes a decision.')
  }

  const batchStatus = (row.import_batches as unknown as { status: string } | null)?.status
  if (batchStatus !== 'REVIEW') {
    throw new AppError('CONFLICT', 'This import is no longer open for review.')
  }

  if (value === 'LINK_EXISTING' && !row.duplicate_of) {
    throw new AppError('VALIDATION_FAILED', 'There is no existing record to link this row to.')
  }

  const { error } = await supabase.from('import_rows').update({ decision: value }).eq('id', id)
  if (error) throw fromPostgrestError(error)
}

export type ExecuteResult = { imported: number; skipped: number; linked: number }

/**
 * Run the import (§20.5). One transaction for the whole batch.
 *
 * **ADR-012: atomicity is preserved and live per-100-row progress is dropped.**
 * Progress for a transaction that has not committed is progress that may never
 * have happened; a wizard that counts to 3,000 and then reports a rollback has
 * told the user something false three thousand times. The summary is reported
 * when the transaction commits.
 *
 * A failure leaves the batch in `REVIEW` with nothing created — which is exactly
 * right for an atomic import: nothing happened, fix the file and try again. There
 * is deliberately no `FAILED` write, because writing it would require a second
 * transaction whose only job is to record that the first one correctly did
 * nothing.
 *
 * **The service-role client appears below, and only below the role check at the
 * top.** ADR-009.
 */
export async function executeImport(batchId: string): Promise<ExecuteResult> {
  await requireImporter()
  const id = uuidSchema.parse(batchId)

  // Read through the user's client — RLS decides whether they may see this batch
  // at all — before anything escalates.
  const supabase = await createSupabaseServerClient()
  const { data: batch, error } = await supabase
    .from('import_batches')
    .select('id, status')
    .eq('id', id)
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!batch) throw notFound('import')
  if (batch.status !== 'REVIEW') {
    throw new AppError('CONFLICT', 'This import has already been run.')
  }

  const admin = createAdminClient()
  const { data, error: rpcError } = await admin.rpc('execute_import', { p_batch_id: id })

  if (rpcError) throw fromPostgrestError(rpcError)

  const summary = (data as unknown as ExecuteResult[])?.[0]
  return summary ?? { imported: 0, skipped: 0, linked: 0 }
}

/**
 * Roll an import back (§20.6). OWNER only, seven days, nothing edited.
 *
 * **Archives. Never deletes.** The records keep every relationship and every
 * activity logged against them, and can be restored from `/archive` like anything
 * else (CLAUDE.md §11).
 *
 * OWNER rather than OWNER-or-ADMIN: §20.6 says so, and rolling back an import is
 * the one action here that removes customers from every salesperson's screen at
 * once.
 */
export async function rollbackImport(batchId: string): Promise<{ accounts: number; contacts: number }> {
  const user = await requireImporter()
  if (!isOwner(user)) {
    throw forbidden('Only the owner can roll back an import.')
  }

  const id = uuidSchema.parse(batchId)

  const supabase = await createSupabaseServerClient()
  const { data: batch, error } = await supabase
    .from('import_batches')
    .select('id, status, completed_at')
    .eq('id', id)
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!batch) throw notFound('import')

  const eligibility = rollbackEligibility({
    status: batch.status,
    completedAt: batch.completed_at,
    editedSinceImport: await hasEditedRecords(id, batch.completed_at),
    now: new Date(),
  })

  if (!eligibility.eligible) {
    throw new AppError('CONFLICT', eligibility.reason ?? 'This import cannot be rolled back.')
  }

  const admin = createAdminClient()
  const { data, error: rpcError } = await admin.rpc('rollback_import', { p_batch_id: id })

  if (rpcError) throw fromPostgrestError(rpcError)

  const summary = (data as unknown as { accounts: number; contacts: number }[])?.[0]
  return summary ?? { accounts: 0, contacts: 0 }
}
