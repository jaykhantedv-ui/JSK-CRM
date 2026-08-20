'use server'

import { revalidatePath } from 'next/cache'

import { stateFromError, type FormState } from '@/lib/form-state'
import {
  archiveRecord,
  restoreRecord,
  type ArchivableEntity,
} from '@/services/archive.service'

/**
 * Archive Server Actions (§8.8).
 *
 * Four things and no more (CLAUDE.md §8). Who may archive, what cascades, and
 * what restore reverses all live in `archive.service.ts` — and behind that, in
 * `guard_record_scope()`, which is what actually refuses a salesperson.
 */
export async function archiveRecordAction(
  input: { entity: ArchivableEntity; id: string },
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await archiveRecord({
      entity: input.entity,
      id: input.id,
      reason: String(formData.get('reason') ?? '').trim() || undefined,
    })
  } catch (error) {
    return stateFromError(error)
  }

  revalidateAfterArchive(input.entity, input.id)
  return { ok: true, error: null, fieldErrors: {} }
}

export async function restoreRecordAction(
  input: { entity: ArchivableEntity; id: string },
  _previous: FormState,
): Promise<FormState> {
  try {
    await restoreRecord({ entity: input.entity, id: input.id })
  } catch (error) {
    return stateFromError(error)
  }

  revalidateAfterArchive(input.entity, input.id)
  return { ok: true, error: null, fieldErrors: {} }
}

/**
 * An archive moves a record out of every active list, dashboard tile and
 * pipeline total at once (§8.8), so the paths it invalidates are broad on
 * purpose — a stale pipeline figure after an archive is exactly the kind of
 * wrong number that gets quoted in a meeting.
 */
function revalidateAfterArchive(entity: ArchivableEntity, id: string) {
  revalidatePath('/archive')
  revalidatePath('/dashboard')
  revalidatePath('/today')
  revalidatePath('/accounts')
  revalidatePath('/opportunities')
  revalidatePath('/projects')
  revalidatePath('/contacts')
  revalidatePath(`/${entity === 'account' ? 'accounts' : `${entity}s`}/${id}`)
}
