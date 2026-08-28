'use server'

import { revalidatePath } from 'next/cache'

import { AppError } from '@/lib/errors'
import { requireRole } from '@/services/auth.service'
import { stateFromError, valuesFrom, type FormState } from '@/lib/form-state'
import {
  isEditableSettingKey,
  updateSetting,
  type EditableSettingKey,
} from '@/services/settings.service'

/**
 * Settings Server Actions (§5.10, CLAUDE.md §3).
 *
 * **Only the keys a person is allowed to change** — `isEditableSettingKey`
 * refuses everything else, and the two ADR-014 maintenance counters are
 * deliberately outside that list. They are operational state written by the
 * nightly cron, not a threshold anybody tunes, and exposing them here would let
 * an administrator silence a failing job by resetting its counter.
 *
 * The RLS policy on `system_settings` is the real control: OWNER/ADMIN write,
 * everybody reads.
 */
export async function updateSettingAction(
  key: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)

  try {
    // OWNER only (ADR-042). `system_settings_update` is the control and holds
    // against a direct PostgREST call; this refuses in words, first, so an
    // administrator gets a sentence rather than a silent no-op.
    await requireRole('OWNER')

    if (!isEditableSettingKey(key)) {
      throw new AppError('FORBIDDEN', 'That setting cannot be changed here.')
    }

    await updateSetting(key, parseValue(key, formData))
  } catch (error) {
    return stateFromError(error, values)
  }

  // Every screen reads settings — probabilities drive Weighted Pipeline, the city
  // list drives half the forms — so a changed setting invalidates broadly.
  revalidatePath('/settings')
  revalidatePath('/dashboard')
  revalidatePath('/opportunities')
  revalidatePath('/reports')
  return { ok: true, error: null, fieldErrors: {} }
}

/**
 * Turn form input into the shape the setting's Zod schema expects.
 *
 * The schema in `settings.service.ts` is what validates; this only gets the type
 * right. A malformed value fails there with a message, rather than being coerced
 * into something plausible here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- one shape per key; the Zod schema validates.
function parseValue(key: EditableSettingKey, formData: FormData): any {
  const raw = String(formData.get('value') ?? '').trim()

  switch (key) {
    case 'cities':
    case 'material_types':
      // One per line: a comma-separated list breaks on a name containing a comma,
      // and these are place names typed by a person.
      return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    case 'high_value_threshold_paise':
    case 'account_dormancy_days':
    case 'opportunity_dormancy_days':
    case 'new_enquiry_sla_hours':
      return Number.parseInt(raw, 10)

    case 'owner_summary_schedule':
      return {
        cadence: String(formData.get('cadence') ?? 'daily'),
        hour: Number.parseInt(String(formData.get('hour') ?? ''), 10),
      }

    case 'stage_probabilities':
    case 'stage_stall_days': {
      try {
        return JSON.parse(raw)
      } catch {
        throw new AppError('VALIDATION_FAILED', 'That is not valid JSON.', { field: 'value' })
      }
    }
  }
}
