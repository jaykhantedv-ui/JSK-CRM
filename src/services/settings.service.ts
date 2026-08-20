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

/**
 * The minimum a settings reader needs. Declared structurally rather than as the
 * generated `SupabaseClient` type so that BOTH the user-session client and the
 * service-role client satisfy it without this module importing the admin client —
 * which the §15.7 lint boundary rightly forbids it from doing.
 */
export type SettingsReader = {
  from: (table: 'system_settings') => {
    select: (columns: string) => PromiseLike<{
      data: { key: string; value: unknown }[] | null
      error: unknown | null
    }>
  }
}

async function readSettings(client: SettingsReader): Promise<Record<string, unknown>> {
  const { data, error } = await client.from('system_settings').select('key, value')

  if (error) {
    throw new AppError('INTERNAL', 'Could not read system settings.', { details: error })
  }

  return Object.fromEntries((data ?? []).map((row) => [row.key, row.value]))
}

/** Every setting, read once per request. */
export const getAllSettings = cache(async (): Promise<Record<string, unknown>> => {
  const supabase = await createSupabaseServerClient()
  return readSettings(supabase as unknown as SettingsReader)
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

/**
 * Read one setting through a caller-supplied client.
 *
 * The cron routes have no user session — a scheduler sends a bearer token, not a
 * cookie — so `getSetting`'s server client reads as `anon` and
 * `system_settings_select` correctly returns nothing. They pass the service-role
 * client instead.
 *
 * **This does not make a second reader of `system_settings`.** It is the same
 * module, the same schemas and the same validation; only the connection differs.
 * A cron route reading `system_settings` directly would be the violation
 * CLAUDE.md §3 is about.
 */
export async function getSettingWith<K extends SettingKey>(
  client: SettingsReader,
  key: K,
): Promise<SettingValue<K>> {
  const all = await readSettings(client)

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

/** A writer for the same reason: ADR-014's maintenance counters are cron-written. */
export type SettingsWriter = {
  from: (table: 'system_settings') => {
    update: (values: { value: unknown }) => {
      eq: (column: 'key', value: string) => PromiseLike<{ error: unknown | null }>
    }
  }
}

/**
 * Write one setting through a caller-supplied client.
 *
 * Used only by the maintenance cron for `maintenance_consecutive_failures` and
 * `maintenance_last_failure_at` (ADR-014). Those two keys are OPERATIONAL STATE,
 * not configuration: they are written by the job and must never appear at
 * `/settings` as something a person can tune.
 */
export async function setSettingWith<K extends SettingKey>(
  client: SettingsWriter,
  key: K,
  value: SettingValue<K>,
): Promise<void> {
  const parsed = SETTINGS_SCHEMAS[key].safeParse(value)
  if (!parsed.success) {
    throw new AppError('INTERNAL', `That is not a valid value for "${key}".`, {
      details: parsed.error.issues,
    })
  }

  const { error } = await client.from('system_settings').update({ value: parsed.data }).eq('key', key)
  if (error) {
    throw new AppError('INTERNAL', `Could not write system setting "${key}".`, { details: error })
  }
}

/**
 * The keys a person may edit at `/settings`.
 *
 * ADR-014's two maintenance counters are deliberately absent, and so is anything
 * else the system writes about itself. `dormancy_days` is retired (ADR-010) and
 * must never reappear.
 */
export const EDITABLE_SETTING_KEYS = [
  'cities',
  'material_types',
  'stage_probabilities',
  'high_value_threshold_paise',
  'account_dormancy_days',
  'opportunity_dormancy_days',
  'stage_stall_days',
  'new_enquiry_sla_hours',
  'owner_summary_schedule',
] as const satisfies readonly SettingKey[]

export type EditableSettingKey = (typeof EDITABLE_SETTING_KEYS)[number]

export function isEditableSettingKey(key: string): key is EditableSettingKey {
  return (EDITABLE_SETTING_KEYS as readonly string[]).includes(key)
}
