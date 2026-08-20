import { z } from 'zod'

import { AppError, fromPostgrestError, notFound } from '@/lib/errors'
import { pageRange, paginate, type PageParams, type Paginated } from '@/lib/pagination'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'
import { requireUser } from '@/services/auth.service'
import type {
  ActivityRow,
  ActivityType,
  NextActionType,
  OpportunityRow,
} from '@/types/domain'

/**
 * Activities — **what happened** (§10.1).
 *
 * Append-only history. Editable by the author for 24 hours, then immutable, and
 * deletable by nobody, ever (§8.10). The 24-hour window is enforced by the RLS
 * UPDATE policy on `activities`, not by anything in this file — the check below
 * exists to say so in plain words before the database says it in SQL.
 *
 * **There is no task system.** A follow-up is `opportunities.next_action`, not a
 * row here (§10.1, CLAUDE.md §4).
 */

export const ACTIVITY_TYPES = [
  'CALL', 'WHATSAPP', 'SHOWROOM_VISIT', 'SITE_VISIT', 'MEETING', 'EMAIL', 'NOTE',
] as const satisfies readonly ActivityType[]

const ACTIVITY_PURPOSES = [
  'ENQUIRY', 'FOLLOW_UP', 'PRODUCT_DISCUSSION', 'SITE_MEASUREMENT', 'SAMPLE_HANDOVER',
  'QUOTATION_DISCUSSION', 'PRICE_NEGOTIATION', 'ORDER_CONFIRMATION', 'RELATIONSHIP', 'OTHER',
] as const

const ACTIVITY_OUTCOMES = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'NO_RESPONSE', 'RESCHEDULED'] as const

const NEXT_ACTION_TYPES = [
  'CALL', 'SHOWROOM_VISIT', 'SITE_VISIT', 'SEND_QUOTATION', 'SHARE_SAMPLES',
  'QUOTATION_FOLLOWUP', 'PRICE_DISCUSSION', 'AWAIT_CUSTOMER', 'OTHER',
] as const satisfies readonly NextActionType[]

/**
 * The purpose a type implies, so the form can collapse the field (§11.5).
 *
 * A default, never a constraint: the user may change it. Three taps is the target
 * and asking for a purpose the type already implies costs one of them.
 */
export const DEFAULT_PURPOSE_FOR_TYPE: Record<ActivityType, (typeof ACTIVITY_PURPOSES)[number]> = {
  CALL: 'FOLLOW_UP',
  WHATSAPP: 'FOLLOW_UP',
  SHOWROOM_VISIT: 'PRODUCT_DISCUSSION',
  SITE_VISIT: 'SITE_MEASUREMENT',
  MEETING: 'PRODUCT_DISCUSSION',
  EMAIL: 'QUOTATION_DISCUSSION',
  NOTE: 'OTHER',
}

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null))

export const logActivitySchema = z
  .object({
    accountId: uuidSchema,
    opportunityId: uuidSchema.optional().nullable(),
    projectId: uuidSchema.optional().nullable(),
    contactId: uuidSchema.optional().nullable(),
    type: z.enum(ACTIVITY_TYPES),
    purpose: z.enum(ACTIVITY_PURPOSES).optional(),
    outcome: z.enum(ACTIVITY_OUTCOMES).default('NEUTRAL'),
    // §11.5 — a summary under three characters is blocked. The database agrees:
    // `length(trim(summary)) >= 3`.
    summary: z.string().trim().min(3, { error: 'Write at least a few words about what happened.' }).max(4000),
    occurredAt: z.string().optional().nullable(),
    durationMinutes: z.number().int().min(0).max(1440).optional().nullable(),
    // §11.5 — site visits carry measurements and a location note.
    measurements: optionalText(2000),
    locationNote: optionalText(500),
    nextAction: z.enum(NEXT_ACTION_TYPES).optional().nullable(),
    nextActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    nextActionNote: optionalText(500),
    /** "Cannot determine yet" (§8.3) — clears both fields deliberately. */
    clearNextAction: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.nextAction) !== Boolean(value.nextActionDate)) {
      ctx.addIssue({
        code: 'custom',
        path: ['nextActionDate'],
        message: 'A next action needs both a type and a date — or neither.',
      })
    }
  })

export type LogActivityInput = z.input<typeof logActivitySchema>

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'Check the highlighted fields.', {
      field: parsed.error.issues[0]?.path.join('.'),
      details: parsed.error.issues,
    })
  }
  return parsed.data
}

/**
 * §10.2 / §11.5 — log an activity and settle the next action in one transaction.
 *
 * `account_id` is always populated, even when the form was launched from an
 * opportunity, because the Customer 360 timeline is one indexed query on it
 * (§5.8). The RPC resolves nothing implicitly — the caller passes the account it
 * inferred from context, and the salesperson never picks a foreign key.
 *
 * The application deliberately does **not** block logging when the next action is
 * unknown (§8.3). Blocking produces fabricated dates; the Missing Next Action
 * exception list is the control instead.
 */
export async function logActivity(
  input: LogActivityInput,
): Promise<{ activity: ActivityRow; opportunity: OpportunityRow | null }> {
  await requireUser()
  const data = parseOrThrow(logActivitySchema, input)
  const supabase = await createSupabaseServerClient()

  const { data: result, error } = await supabase
    .rpc('log_activity', {
      p_account_id: data.accountId,
      p_type: data.type,
      p_summary: data.summary,
      p_purpose: data.purpose ?? DEFAULT_PURPOSE_FOR_TYPE[data.type],
      p_outcome: data.outcome,
      p_opportunity_id: data.opportunityId ?? undefined,
      p_project_id: data.projectId ?? undefined,
      p_contact_id: data.contactId ?? undefined,
      p_occurred_at: data.occurredAt ?? undefined,
      p_duration_minutes: data.durationMinutes ?? undefined,
      p_measurements: data.measurements ?? undefined,
      p_location_note: data.locationNote ?? undefined,
      p_next_action: data.nextAction ?? undefined,
      p_next_action_date: data.nextActionDate ?? undefined,
      p_next_action_note: data.nextActionNote ?? undefined,
      p_clear_next_action: data.clearNextAction,
    })
    .single()

  if (error) throw fromPostgrestError(error)
  if (!result) throw new AppError('INTERNAL', 'The activity could not be saved. Try again.')

  const [{ data: activity }, opportunity] = await Promise.all([
    supabase.from('activities').select('*').eq('id', result.activity_id).single(),
    result.opportunity_id
      ? supabase.from('opportunities').select('*').eq('id', result.opportunity_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  if (!activity) throw new AppError('INTERNAL', 'The activity was saved but could not be read back.')

  // §10.2 step 4 — return the updated opportunity so the UI refreshes without a
  // second round-trip.
  return { activity, opportunity: opportunity.data ?? null }
}

export const updateActivitySchema = z.object({
  summary: z.string().trim().min(3).max(4000),
  outcome: z.enum(ACTIVITY_OUTCOMES),
  measurements: optionalText(2000),
  locationNote: optionalText(500),
})

export type UpdateActivityInput = z.input<typeof updateActivitySchema>

/**
 * §8.10 — editable by the author for 24 hours.
 *
 * The window is enforced by the `activities_update` RLS policy: the row simply
 * stops matching once it is a day old, so the update affects nothing. This maps
 * that silence to a sentence. **A correction after 24 hours is a new activity of
 * type NOTE**, which the UI offers instead.
 */
export async function updateActivity(id: string, input: UpdateActivityInput): Promise<ActivityRow> {
  await requireUser()
  const data = parseOrThrow(updateActivitySchema, input)
  const supabase = await createSupabaseServerClient()

  const { data: row, error } = await supabase
    .from('activities')
    .update({
      summary: data.summary,
      outcome: data.outcome,
      measurements: data.measurements,
      location_note: data.locationNote,
    })
    .eq('id', uuidSchema.parse(id))
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!row) {
    throw new AppError(
      'FORBIDDEN',
      'This activity can no longer be edited. Add a note instead — history is never rewritten.',
    )
  }
  return row
}

/**
 * The Customer 360 timeline (§12.4). One indexed query on `activities.account_id`,
 * which is why that column is always populated.
 */
export async function listTimeline(
  accountId: string,
  params: PageParams,
): Promise<Paginated<ActivityRow>> {
  await requireUser()
  const supabase = await createSupabaseServerClient()
  const { from, to } = pageRange(params)

  const { data, error, count } = await supabase
    .from('activities')
    .select('*', { count: 'exact' })
    .eq('account_id', uuidSchema.parse(accountId))
    .order('occurred_at', { ascending: false })
    .range(from, to)

  if (error) throw fromPostgrestError(error)
  return paginate(data ?? [], count ?? 0, params)
}

/** The project timeline — the activities recorded against one site. */
export async function listProjectActivities(
  projectId: string,
  limit = 25,
): Promise<ActivityRow[]> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('project_id', uuidSchema.parse(projectId))
    .order('occurred_at', { ascending: false })
    .limit(Math.min(limit, 100))

  if (error) throw fromPostgrestError(error)
  return data ?? []
}

/** Read one activity, for the edit form. */
export async function getActivity(id: string): Promise<ActivityRow> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('id', uuidSchema.parse(id))
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!data) throw notFound('activity')
  return data
}

/**
 * Is this activity still inside its edit window (§8.10)?
 *
 * **For rendering only.** The RLS policy is the control; this stops the UI
 * offering an Edit button the database would refuse.
 */
export const ACTIVITY_EDIT_WINDOW_HOURS = 24

export function isWithinEditWindow(
  activity: Pick<ActivityRow, 'created_at' | 'performed_by'>,
  userId: string,
  now: Date = new Date(),
): boolean {
  if (activity.performed_by !== userId) return false
  const age = now.getTime() - new Date(activity.created_at).getTime()
  return age < ACTIVITY_EDIT_WINDOW_HOURS * 3_600_000
}
