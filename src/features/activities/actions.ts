'use server'

import { revalidatePath } from 'next/cache'

import { businessLocalToUtc } from '@/lib/dates'
import {
  optionalField, requireField, stateFromError, valuesFrom, type FormState,
} from '@/lib/form-state'
import { logActivity, updateActivity } from '@/services/activity.service'

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

  try {
    // "Can't say yet" (§8.3). A legitimate answer — it clears the next action and
    // the opportunity surfaces on the exception list, which is the control.
    const clearNextAction = formData.get('clearNextAction') === '1'
    const nextActionDate = optionalField(formData, 'nextActionDate')
    const nextAction = optionalField(formData, 'nextAction')

    await logActivity({
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
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath(context.redirectTo)
  revalidatePath('/today')
  return { ok: true, error: null, fieldErrors: {} }
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
