'use server'

import { revalidatePath } from 'next/cache'

import { businessLocalToUtc } from '@/lib/dates'
import {
  optionalField, requireField, stateFromError, valuesFrom, type FormState,
} from '@/lib/form-state'
import { logActivity, updateActivity } from '@/services/activity.service'
import { attachActivityPhoto, createSignedUpload } from '@/services/storage.service'

/**
 * Activity Server Actions (§11.5).
 *
 * The next-action decision travels with the activity in the same submit, because
 * §10.2 makes them one transaction: the moment a salesperson says what happened
 * is the moment they know what happens next.
 */
export async function logActivityAction(
  context: { accountId: string; opportunityId?: string | null; projectId?: string | null; redirectTo: string },
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)
  let activityId: string

  try {
    // "Can't say yet" (§8.3). A legitimate answer — it clears the next action and
    // the opportunity surfaces on the exception list, which is the control.
    const clearNextAction = formData.get('clearNextAction') === '1'
    const nextActionDate = optionalField(formData, 'nextActionDate')
    const nextAction = optionalField(formData, 'nextAction')

    const activity = await logActivity({
      accountId: context.accountId,
      opportunityId: optionalField(formData, 'opportunityId') ?? context.opportunityId ?? undefined,
      projectId: context.projectId ?? undefined,
      contactId: optionalField(formData, 'contactId'),
      type: requireField(formData, 'type', 'Choose what kind of contact this was.') as never,
      purpose: optionalField(formData, 'purpose') as never,
      outcome: (optionalField(formData, 'outcome') ?? 'NEUTRAL') as never,
      summary: requireField(formData, 'summary', 'Write at least a few words about what happened.'),
      // A `datetime-local` value carries no timezone. Anchor it to Asia/Kolkata
      // rather than letting PostgreSQL read it as UTC (CLAUDE.md §10).
      occurredAt: (() => {
        const raw = optionalField(formData, 'occurredAt')
        return raw ? (businessLocalToUtc(raw) ?? undefined) : undefined
      })(),
      measurements: optionalField(formData, 'measurements'),
      locationNote: optionalField(formData, 'locationNote'),
      nextAction: clearNextAction ? undefined : (nextAction as never),
      nextActionDate: clearNextAction ? undefined : nextActionDate,
      nextActionNote: optionalField(formData, 'nextActionNote'),
      clearNextAction,
    })
    activityId = activity.activity.id
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath(context.redirectTo)
  revalidatePath('/today')
  // The id travels back so a site visit can offer its photo upload without
  // leaving the screen — the activity is already committed at this point (§11.5).
  return { ok: true, error: null, fieldErrors: {}, createdId: activityId }
}

/**
 * §8.10 — the author may correct an activity for 24 hours.
 *
 * The window is enforced by the RLS UPDATE policy, not here. After it closes the
 * service returns a message telling the user to add a note instead: history is
 * never rewritten.
 */
export async function updateActivityAction(
  activityId: string,
  redirectTo: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)

  try {
    await updateActivity(activityId, {
      summary: requireField(formData, 'summary', 'Write at least a few words about what happened.'),
      outcome: (optionalField(formData, 'outcome') ?? 'NEUTRAL') as never,
      measurements: optionalField(formData, 'measurements'),
      locationNote: optionalField(formData, 'locationNote'),
    })
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath(redirectTo)
  return { ok: true, error: null, fieldErrors: {} }
}

/**
 * §11.5 — site-visit photographs, attached AFTER the activity is committed.
 *
 * **An upload failure must never block the activity.** That is why these are
 * separate actions called from a control that only appears once the activity
 * exists: the visit is recorded the moment the salesperson presses save, and the
 * photographs are a second, retryable step. A combined submit could not offer
 * that guarantee — a failed byte transfer would take the measurements with it.
 */
export async function requestActivityPhotoUploadAction(input: {
  entityId: string
  fileName: string
  size: number
  mimeType: string
  head: string
}) {
  const { path, token } = await createSignedUpload({
    entityType: 'activity',
    entityId: input.entityId,
    fileName: input.fileName,
    size: input.size,
    mimeType: input.mimeType,
    head: input.head,
  })
  return { path, token }
}

export async function attachActivityPhotoAction(input: { entityId: string; path: string }) {
  const paths = await attachActivityPhoto(input)
  revalidatePath('/today')
  return paths
}
