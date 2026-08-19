import { cache } from 'react'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * The settings service (§5.10, CLAUDE.md §3).
 *
 * **THIS IS THE ONLY READER OF `system_settings`.** Every threshold, probability
 * and controlled list the business can change without a deploy comes from here.
 *
 * Resolution of the twelve TODO-BD decisions fixed the values; it did not licence
 * a constant. `30000000` — the approved high-value threshold — exists in exactly
 * one place in this repository, and that place is migration 014. If you find
 * yourself typing a number from that migration into a `.ts` file, stop: the
 * mechanism belongs here and the value belongs in the database.
 *
 * Reads are wrapped in React's `cache`, so one request reads the table once no
 * matter how many components ask (§17.1 — no Redis, no cache infrastructure at
 * this scale).
 */

const stageProbabilitiesSchema = z.record(z.string(), z.number().min(0).max(100))
const stallDaysSchema = z.record(z.string(), z.number().int().min(0))

/**
 * One entry per key. The schema is not decoration: a settings row edited to a
 * malformed value must fail loudly here rather than produce a silently wrong
 * dashboard.
 *
 * `dormancy_days` is absent on purpose. ADR-010 retired it in favour of
 * `account_dormancy_days` and `opportunity_dormancy_days`, and it must never be
 * seeded or read again.
 */
const SETTINGS_SCHEMAS = {
  cities: z.array(z.string()),
  stage_probabilities: stageProbabilitiesSchema,
  high_value_threshold_paise: z.number().int().nonnegative(),
  account_dormancy_days: z.number().int().positive(),
  opportunity_dormancy_days: z.number().int().positive(),
  stage_stall_days: stallDaysSchema,
  new_enquiry_sla_hours: z.number().int().positive(),
  owner_summary_schedule: z.object({
    cadence: z.enum(['daily', 'weekly']),
    hour: z.number().int().min(0).max(23),
  }),
  material_types: z.array(z.string()),
  // Operational state written only by the maintenance cron (ADR-014). Not a
  // threshold, and not editable at /settings.
  maintenance_consecutive_failures: z.number().int().nonnegative(),
  maintenance_last_failure_at: z.string().nullable(),
} as const

export type SettingKey = keyof typeof SETTINGS_SCHEMAS
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS_SCHEMAS)[K]>

/** Every setting, read once per request. */
export const getAllSettings = cache(async (): Promise<Record<string, unknown>> => {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('system_settings').select('key, value')

  if (error) {
    throw new AppError('INTERNAL', 'Could not read system settings.', { details: error })
  }

  return Object.fromEntries((data ?? []).map((row) => [row.key, row.value]))
})

/**
 * Read one setting, validated.
 *
 * There is deliberately no default parameter. A missing key is a broken
 * deployment — migration 014 seeds every one of them — and defaulting would
 * reintroduce exactly the hard-coded value this service exists to prevent.
 */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const all = await getAllSettings()

  if (!(key in all)) {
    throw new AppError('INTERNAL', `System setting "${key}" is missing. Run the migrations.`)
  }

  const parsed = SETTINGS_SCHEMAS[key].safeParse(all[key])
  if (!parsed.success) {
    throw new AppError('INTERNAL', `System setting "${key}" holds an invalid value.`, {
      details: parsed.error.issues,
    })
  }

  return parsed.data as SettingValue<K>
}

/** The probability for one stage, from `stage_probabilities` (§7.2, §13.1). */
export async function getStageProbability(stage: string): Promise<number> {
  const probabilities = await getSetting('stage_probabilities')
  const probability = probabilities[stage]
  if (probability === undefined) {
    throw new AppError('INTERNAL', `No configured probability for stage "${stage}".`)
  }
  return probability
}

/**
 * Write a setting. OWNER/ADMIN only — enforced by the RLS policy on
 * `system_settings`, not by this check, which exists to fail early with a
 * readable message.
 */
export async function updateSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
): Promise<void> {
  const parsed = SETTINGS_SCHEMAS[key].safeParse(value)
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', `That is not a valid value for "${key}".`, {
      field: key,
      details: parsed.error.issues,
    })
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('system_settings')
    .update({ value: parsed.data as never })
    .eq('key', key)

  if (error) {
    const { fromPostgrestError } = await import('@/lib/errors')
    throw fromPostgrestError(error)
  }
}
