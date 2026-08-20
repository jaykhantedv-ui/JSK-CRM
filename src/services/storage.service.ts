import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { AppError, fromPostgrestError, notFound } from '@/lib/errors'
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  SIGNATURE_BYTES,
  buildStoragePath,
  detectMimeType,
  parseStoragePath,
  validateUpload,
  type StorageEntityType,
} from '@/lib/files'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'

import { requireUser } from './auth.service'

/**
 * Private file storage (§15.6, §17.5, ADR-005).
 *
 * **ADR-005 is the single approved exception to "no client-side Supabase
 * writes".** A 10 MB file exceeds the platform request-body limit, so the bytes
 * go browser → signed upload URL → Storage without passing through the server.
 * Everything else stays where it was:
 *
 *   * the signed upload URL is issued **only after a server-side check that the
 *     caller can see the parent entity** — the URL is short-lived and names one
 *     exact path, so it grants nothing else;
 *   * the database row that references the file is written by a Server Action,
 *     never by the browser;
 *   * `storage.objects` carries its own RLS policies (migration 024), keyed off
 *     the path prefix. A signed URL obtained by any other route still meets them.
 *
 * **This carve-out applies to nothing else.**
 *
 * On magic bytes, the check happens TWICE and both are server-side:
 *
 *   1. before the upload URL is issued, on the file's first bytes as read by the
 *      browser (§15.6, and the Phase 17 requirement that validation precede the
 *      URL);
 *   2. again on the bytes Storage actually holds, before the path is written to
 *      any row.
 *
 * The first is the specified gate. The second is what makes the guarantee real:
 * a client that lied about its first twelve bytes in step 1 and uploaded an
 * executable still never gets a row pointing at it, and a file no row references
 * is invisible to every screen in the application. Nothing hard-deletes the
 * orphaned object — there is no delete policy on `storage.objects`, and
 * CLAUDE.md §11 applies to Storage as much as to tables.
 */

export const BUCKET = 'crm-files'

/** §15.6: 60 seconds. Long enough to start a download, short enough to be useless if leaked. */
export const SIGNED_URL_TTL_SECONDS = 60

/**
 * How long a caller has to complete an upload. Supabase fixes this at two hours
 * and does not accept a TTL, so it is documented rather than configured: the URL
 * is single-path and single-use, and the row that would make the file visible is
 * still written by a Server Action afterwards.
 */
export const UPLOAD_URL_TTL_SECONDS = 7200

const entityTypeSchema = z.enum(['account', 'project', 'opportunity', 'activity'])

export const uploadRequestSchema = z.object({
  entityType: entityTypeSchema,
  entityId: uuidSchema,
  fileName: z.string().trim().min(1, { error: 'The file needs a name.' }).max(255),
  size: z.number().int().positive().max(MAX_FILE_BYTES, {
    error: `Files must be ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB or smaller.`,
  }),
  mimeType: z.string().trim().max(128).optional(),
  /**
   * The file's first bytes, as read by the browser. Base64 because a Server
   * Action argument crosses a JSON boundary.
   */
  head: z.string().min(1),
})

export type UploadRequestInput = z.input<typeof uploadRequestSchema>

export type SignedUpload = {
  path: string
  /** The URL the browser PUTs the bytes to. */
  signedUrl: string
  token: string
}

/**
 * Prove the caller can see the entity a file is being hung off.
 *
 * Every read goes through the user's own client, so row-level security answers
 * the question — this function contains no rule of its own, which is what keeps
 * it from drifting away from the policies in 016 and 024.
 */
async function assertParentVisible(entityType: StorageEntityType, entityId: string): Promise<void> {
  const supabase = await createSupabaseServerClient()

  const table = {
    account: 'accounts',
    project: 'projects',
    opportunity: 'opportunities',
    activity: 'activities',
  }[entityType] as 'accounts' | 'projects' | 'opportunities' | 'activities'

  const { data, error } = await supabase.from(table).select('id').eq('id', entityId).maybeSingle()

  if (error) throw fromPostgrestError(error)
  // Invisible and absent are the same answer (§25, M-03).
  if (!data) throw notFound(entityType)
}

/**
 * Issue a signed upload URL for one file.
 *
 * OWNER of the check order, deliberately: visibility first, then the file itself.
 * A caller who cannot see the entity learns nothing about whether their file
 * would have been acceptable.
 */
export async function createSignedUpload(input: UploadRequestInput): Promise<SignedUpload> {
  await requireUser()

  const parsed = uploadRequestSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError('VALIDATION_FAILED', issue.message, { field: issue.path.join('.') })
  }
  const { entityType, entityId, fileName, size, mimeType, head } = parsed.data

  await assertParentVisible(entityType, entityId)

  const headBytes = Uint8Array.from(Buffer.from(head, 'base64').subarray(0, SIGNATURE_BYTES))
  const validation = validateUpload({
    size,
    declaredMimeType: mimeType ?? null,
    fileName,
    head: headBytes,
  })

  if (!validation.ok) {
    throw new AppError('VALIDATION_FAILED', validation.rejection.message, { field: 'file' })
  }

  const path = buildStoragePath(entityType, entityId, fileName, randomUUID())

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)

  if (error || !data) {
    throw new AppError('INTERNAL', 'Could not start the upload. Try again.', { details: error })
  }

  return { path, signedUrl: data.signedUrl, token: data.token }
}

/**
 * A short-lived URL for reading one stored file (§15.6).
 *
 * There are no public URLs in this system. The 60-second expiry is what makes a
 * URL that ends up in a chat log or a browser history harmless a minute later.
 */
export async function createSignedDownloadUrl(path: string): Promise<string> {
  await requireUser()

  const parsed = parseStoragePath(path)
  if (!parsed) throw new AppError('VALIDATION_FAILED', 'That is not a valid file reference.')

  // Storage's own policy would refuse this anyway; checking here turns a generic
  // storage error into the NOT_FOUND the UI knows how to render.
  await assertParentVisible(parsed.entityType, parsed.entityId)

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (error || !data) throw notFound('file')

  return data.signedUrl
}

/**
 * Re-check the stored bytes before the path is recorded anywhere.
 *
 * Step 1's check ran on bytes the browser reported. This one runs on the bytes
 * Storage actually holds, which is the only version that matters. A file that
 * fails here is never referenced by a row, so it never appears on a screen.
 *
 * The whole object is fetched because supabase-js has no range read; at 10 MB and
 * this system's volume that is an acceptable cost for an honest check (§24 — do
 * not build enterprise infrastructure for twenty users).
 */
async function assertStoredBytesAreAllowed(path: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.storage.from(BUCKET).download(path)

  if (error || !data) throw notFound('file')

  const head = new Uint8Array(await data.slice(0, SIGNATURE_BYTES).arrayBuffer())
  if (!detectMimeType(head)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'That file is not one of the allowed types. It has not been attached.',
      { field: 'file' },
    )
  }
}

const attachSchema = z.object({
  entityId: uuidSchema,
  path: z.string().trim().min(1),
})

/**
 * Attach an uploaded quotation PDF to an opportunity (§8.6).
 *
 * The path list lives on the opportunity row — no quotation table, no version
 * table, no attachments metadata table (§4.2, §8.6). The write goes through the
 * user's client, so `opportunities_update` decides whether it is allowed.
 */
export async function attachQuotationFile(input: {
  entityId: string
  path: string
}): Promise<string[]> {
  await requireUser()
  const { entityId, path } = attachSchema.parse(input)

  const parsed = parseStoragePath(path)
  if (!parsed || parsed.entityType !== 'opportunity' || parsed.entityId !== entityId) {
    throw new AppError('VALIDATION_FAILED', 'That file does not belong to this opportunity.')
  }

  await assertParentVisible('opportunity', entityId)
  await assertStoredBytesAreAllowed(path)

  const supabase = await createSupabaseServerClient()

  const { data: current, error: readError } = await supabase
    .from('opportunities')
    .select('quotation_file_paths')
    .eq('id', entityId)
    .maybeSingle()

  if (readError) throw fromPostgrestError(readError)
  if (!current) throw notFound('opportunity')

  const next = [...new Set([...(current.quotation_file_paths ?? []), path])]

  const { data, error } = await supabase
    .from('opportunities')
    .update({ quotation_file_paths: next })
    .eq('id', entityId)
    .select('quotation_file_paths')
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!data) throw notFound('opportunity')

  return data.quotation_file_paths ?? []
}

/**
 * Attach a photograph to a site visit (§11.5).
 *
 * **A failed upload must never cost the salesperson the activity.** The activity
 * is committed by `logActivity` before this is ever called, so a failure here
 * leaves a saved activity with no photo and a retry available — which is the
 * specified behaviour, and the reason this is a separate call rather than part of
 * the activity write.
 *
 * The 24-hour author-only edit window (§5.8) governs this, because it is an
 * UPDATE on `activities` like any other. Attaching a photo to a two-day-old visit
 * is refused by the policy, not by this code.
 */
export async function attachActivityPhoto(input: {
  entityId: string
  path: string
}): Promise<string[]> {
  await requireUser()
  const { entityId, path } = attachSchema.parse(input)

  const parsed = parseStoragePath(path)
  if (!parsed || parsed.entityType !== 'activity' || parsed.entityId !== entityId) {
    throw new AppError('VALIDATION_FAILED', 'That file does not belong to this activity.')
  }

  await assertParentVisible('activity', entityId)
  await assertStoredBytesAreAllowed(path)

  const supabase = await createSupabaseServerClient()

  const { data: current, error: readError } = await supabase
    .from('activities')
    .select('attachment_paths')
    .eq('id', entityId)
    .maybeSingle()

  if (readError) throw fromPostgrestError(readError)
  if (!current) throw notFound('activity')

  const next = [...new Set([...(current.attachment_paths ?? []), path])]

  const { data, error } = await supabase
    .from('activities')
    .update({ attachment_paths: next })
    .eq('id', entityId)
    .select('attachment_paths')
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!data) {
    // The UPDATE policy hid the row: past the 24-hour window, or not the author.
    throw new AppError(
      'FORBIDDEN',
      'This activity can no longer be changed. Add a note instead.',
    )
  }

  return data.attachment_paths ?? []
}

export { ALLOWED_MIME_TYPES, MAX_FILE_BYTES }
