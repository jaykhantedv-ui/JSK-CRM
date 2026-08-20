'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { stateFromError, valuesFrom, type FormState } from '@/lib/form-state'
import { AppError } from '@/lib/errors'
import { MAX_IMPORT_BYTES } from '@/lib/files'
import {
  executeImport,
  rollbackImport,
  setRowDecision,
  uploadImportFile,
  type ImportDecision,
} from '@/services/import.service'

/**
 * Import Server Actions (§20).
 *
 * Four things and no more (CLAUDE.md §8). **Every rule about who may import,
 * what makes a row valid, and when a batch may be rolled back lives in
 * `import.service.ts`** — including the OWNER/ADMIN check, which is enforced
 * there and again by the RLS policies on `import_batches`.
 */
export async function uploadImportAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)
  let batchId: string

  try {
    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError('VALIDATION_FAILED', 'Choose a CSV file to import.', { field: 'file' })
    }

    // Checked before the bytes are read into memory as well as inside the
    // service: a 40 MB file should not be decoded to UTF-8 first.
    if (file.size > MAX_IMPORT_BYTES) {
      throw new AppError(
        'VALIDATION_FAILED',
        `That file is larger than ${Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))} MB. Split it and import in parts.`,
        { field: 'file' },
      )
    }

    const result = await uploadImportFile({
      entity: String(formData.get('entity') ?? ''),
      fileName: file.name,
      csv: await file.text(),
    })
    batchId = result.batchId
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath('/import')
  redirect(`/import/${batchId}`)
}

export async function setRowDecisionAction(rowId: string, decision: ImportDecision) {
  await setRowDecision(rowId, decision)
  revalidatePath('/import')
}

export async function executeImportAction(
  batchId: string,
  _previous: FormState,
): Promise<FormState> {
  try {
    await executeImport(batchId)
  } catch (error) {
    return stateFromError(error)
  }

  revalidatePath('/import')
  revalidatePath('/accounts')
  revalidatePath('/contacts')
  return { ok: true, error: null, fieldErrors: {} }
}

export async function rollbackImportAction(
  batchId: string,
  _previous: FormState,
): Promise<FormState> {
  try {
    await rollbackImport(batchId)
  } catch (error) {
    return stateFromError(error)
  }

  revalidatePath('/import')
  revalidatePath('/accounts')
  revalidatePath('/contacts')
  revalidatePath('/archive')
  return { ok: true, error: null, fieldErrors: {} }
}
