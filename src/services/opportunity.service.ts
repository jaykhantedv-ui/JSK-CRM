import { z } from 'zod'

import { AppError, fromPostgrestError, notFound } from '@/lib/errors'
import { checkTransition, type Stage } from '@/lib/opportunity/transitions'
import { opportunityTitle } from '@/lib/opportunity/title'
import { pageRange, paginate, type PageParams, type Paginated } from '@/lib/pagination'
import { isManagerOrAbove } from '@/lib/permissions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'
import { requireUser } from '@/services/auth.service'
import type {
  ActivityRow,
  OpportunityEventRow,
  OpportunityFlagsRow,
  OpportunityRow,
  ProductCategory,
  OpportunityStage,
  NextActionType,
  LostReason,
} from '@/types/domain'

/**
 * Opportunities — the central table (§5.7) and the whole of the sales lifecycle
 * (§9).
 *
 * Two rules govern everything below:
 *
 *   1. **The transition matrix is the only judge of a legal stage move.** It
 *      lives in `lib/opportunity/transitions.ts` and is consulted here and
 *      nowhere else. No component decides whether a move is allowed, and the SQL
 *      does not restate the matrix (CLAUDE.md §8, §13).
 *   2. **The check constraints are the backstop.** If a bug here ever produced a
 *      won opportunity with no value, the database would refuse the row. Nothing
 *      in this file may be written in a way that needs a constraint relaxed.
 */

export const CATEGORIES = [
  'TILES', 'MARBLE', 'GRANITE', 'SANITARYWARE', 'CP_FITTINGS', 'ALLIED', 'MIXED',
] as const satisfies readonly ProductCategory[]

export const STAGE_VALUES = [
  'new', 'qualified', 'selection', 'quoted', 'negotiation',
  'verbal_confirmation', 'won', 'lost', 'nurture',
] as const satisfies readonly OpportunityStage[]

export const NEXT_ACTION_TYPES = [
  'CALL', 'SHOWROOM_VISIT', 'SITE_VISIT', 'SEND_QUOTATION', 'SHARE_SAMPLES',
  'QUOTATION_FOLLOWUP', 'PRICE_DISCUSSION', 'AWAIT_CUSTOMER', 'OTHER',
] as const satisfies readonly NextActionType[]

export const LOST_REASONS = [
  'PRICE', 'STOCK_UNAVAILABLE', 'DELIVERY_TIME', 'DESIGN_NOT_AVAILABLE',
  'COMPETITOR_RELATIONSHIP', 'PROJECT_POSTPONED', 'PROJECT_CANCELLED', 'BUDGET_CUT',
  'SPECIFIED_OTHER_BRAND', 'CREDIT_TERMS', 'SERVICE_RESPONSE', 'NOT_GENUINE',
  'NO_RESPONSE', 'UNKNOWN',
] as const satisfies readonly LostReason[]

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Enter a date.' })
const optionalDate = dateSchema.optional().nullable()
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null))

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

// -------------------------------------------------------------------- reads --

export type OpportunityFilters = {
  q?: string | null
  stage?: OpportunityStage | null
  category?: ProductCategory | null
  /** Narrows a lost list to one reason — the §14 lost-reason drill-down. */
  lostReason?: LostReason | null
  ownerId?: string | null
  outletId?: string | null
  mineOnly?: boolean
  /** `is_active` — everything but won and lost. The pipeline's default view. */
  activeOnly?: boolean
  unassignedOnly?: boolean
  overdueOnly?: boolean
  missingNextActionOnly?: boolean
}

export function parseOpportunityFilters(raw: Record<string, string | undefined>): OpportunityFilters {
  const asEnum = <T extends string>(value: string | undefined, allowed: readonly T[]): T | null =>
    value && (allowed as readonly string[]).includes(value) ? (value as T) : null

  return {
    q: raw.q?.trim() || null,
    stage: asEnum(raw.stage, STAGE_VALUES),
    category: asEnum(raw.category, CATEGORIES),
    lostReason: asEnum(raw.reason, LOST_REASONS),
    ownerId: raw.owner?.trim() || null,
    outletId: raw.outlet?.trim() || null,
    mineOnly: raw.mine === '1',
    // The pipeline shows active work unless the user explicitly asks otherwise,
    // because won and lost leave the pipeline immediately (§8.7).
    activeOnly: raw.closed !== '1' && !raw.stage,
    unassignedOnly: raw.unassigned === '1',
    overdueOnly: raw.overdue === '1',
    missingNextActionOnly: raw.missing === '1',
  }
}

/**
 * The pipeline list, read from `v_opportunity_flags` so `is_overdue` and
 * `days_in_stage` come from the one SQL definition of them (§10.3) rather than
 * being recomputed per screen.
 *
 * The view carries `security_invoker = true`, so it enforces the same policies as
 * the underlying table — without that it would silently publish every
 * salesperson's pipeline (§25).
 */
export async function listOpportunities(
  filters: OpportunityFilters,
  params: PageParams,
): Promise<Paginated<OpportunityFlagsRow>> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()
  const { from, to } = pageRange(params)

  let query = supabase.from('v_opportunity_flags').select('*', { count: 'exact' })

  if (filters.mineOnly) query = query.eq('owner_id', user.id)
  if (filters.ownerId) query = query.eq('owner_id', filters.ownerId)
  if (filters.outletId) query = query.eq('outlet_id', filters.outletId)
  if (filters.stage) query = query.eq('stage', filters.stage)
  if (filters.category) query = query.eq('category', filters.category)
  if (filters.lostReason) query = query.eq('lost_reason', filters.lostReason)
  if (filters.activeOnly) query = query.eq('is_active', true)
  if (filters.unassignedOnly) query = query.is('owner_id', null)
  if (filters.overdueOnly) query = query.eq('is_overdue', true)
  if (filters.missingNextActionOnly) query = query.eq('is_missing_next_action', true)

  const term = filters.q?.trim()
  if (term && term.length >= 2) {
    query = query.ilike('title', `%${term.replace(/[,()*%_]/g, ' ').trim()}%`)
  }

  const { data, error, count } = await query
    // Overdue first, then by date: the pipeline opens on what needs doing.
    .order('next_action_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw fromPostgrestError(error)
  return paginate((data ?? []) as OpportunityFlagsRow[], count ?? 0, params)
}

/**
 * Every active opportunity grouped by stage, for the desktop board (§12.2).
 *
 * Bounded per column. A board is a working surface, not a report: if a stage
 * holds more than the cap the column says so and links to the filtered list,
 * rather than loading a thousand cards nobody will scroll (§12.8).
 */
export const BOARD_COLUMN_LIMIT = 50

export async function listBoard(
  filters: OpportunityFilters,
): Promise<{ stage: OpportunityStage; rows: OpportunityFlagsRow[]; total: number; value: number }[]> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  // `nurture` is a holding stage and is excluded from Pipeline Value everywhere
  // (§9.1); it still gets a column, because the salesperson has to be able to
  // pull work back out of it.
  const columns: OpportunityStage[] = [
    'new', 'qualified', 'selection', 'quoted', 'negotiation', 'verbal_confirmation', 'nurture',
  ]

  const results = await Promise.all(
    columns.map(async (stage) => {
      let query = supabase
        .from('v_opportunity_flags')
        .select('*', { count: 'exact' })
        .eq('stage', stage)

      if (filters.mineOnly) query = query.eq('owner_id', user.id)
      if (filters.ownerId) query = query.eq('owner_id', filters.ownerId)
      if (filters.outletId) query = query.eq('outlet_id', filters.outletId)
      if (filters.category) query = query.eq('category', filters.category)

      const { data, error, count } = await query
        .order('next_action_date', { ascending: true, nullsFirst: false })
        .limit(BOARD_COLUMN_LIMIT)

      if (error) throw fromPostgrestError(error)
      const rows = (data ?? []) as OpportunityFlagsRow[]
      return {
        stage,
        rows,
        total: count ?? rows.length,
        value: rows.reduce((sum, row) => sum + (row.estimated_value ?? 0), 0),
      }
    }),
  )

  return results
}

export type OpportunityDetail = {
  opportunity: OpportunityFlagsRow
  account: { id: string; name: string; phone: string | null; account_type: string; city: string | null }
  project: { id: string; name: string } | null
  activities: ActivityRow[]
  events: OpportunityEventRow[]
  allowedStages: Stage[]
}

export async function getOpportunity(id: string): Promise<OpportunityRow> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('opportunities')
    .select('*')
    .eq('id', uuidSchema.parse(id))
    .is('archived_at', null)
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!data) throw notFound('opportunity')
  return data
}

export async function getOpportunityDetail(id: string): Promise<OpportunityDetail> {
  const user = await requireUser()
  const opportunityId = uuidSchema.parse(id)
  const supabase = await createSupabaseServerClient()

  const { data: opportunity, error } = await supabase
    .from('v_opportunity_flags')
    .select('*')
    .eq('id', opportunityId)
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!opportunity?.id) throw notFound('opportunity')

  const [account, project, activities, events] = await Promise.all([
    supabase
      .from('accounts')
      .select('id, name, phone, account_type, city')
      .eq('id', opportunity.account_id as string)
      .maybeSingle(),
    opportunity.project_id
      ? supabase.from('projects').select('id, name').eq('id', opportunity.project_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('activities')
      .select('*')
      .eq('opportunity_id', opportunityId)
      .order('occurred_at', { ascending: false })
      .limit(25),
    supabase
      .from('opportunity_events')
      .select('*')
      .eq('opportunity_id', opportunityId)
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  if (activities.error) throw fromPostgrestError(activities.error)
  if (events.error) throw fromPostgrestError(events.error)

  return {
    opportunity: opportunity as OpportunityFlagsRow,
    // The parent account is normally visible to anyone who can see the
    // opportunity; if a policy ever says otherwise the screen shows the
    // opportunity without leaking the customer's details.
    account: account.data ?? {
      id: opportunity.account_id as string,
      name: 'Customer',
      phone: null,
      account_type: 'OTHER',
      city: null,
    },
    project: project.data ?? null,
    activities: activities.data ?? [],
    events: events.data ?? [],
    // Rendering only. RLS and the service still decide; this stops the UI
    // offering a move the database would refuse (CLAUDE.md §6).
    allowedStages: allowedStagesFor(opportunity.stage as Stage, user.role),
  }
}

function allowedStagesFor(from: Stage, role: Parameters<typeof checkTransition>[0]['role']): Stage[] {
  return STAGE_VALUES.filter(
    (to) => to !== from && checkTransition({ from, to, role, reason: 'probe' }).allowed,
  )
}

// ------------------------------------------------------------------- writes --

export const createOpportunitySchema = z.object({
  accountId: uuidSchema,
  projectId: uuidSchema.optional().nullable(),
  outletId: uuidSchema,
  category: z.enum(CATEGORIES),
  estimatedValuePaise: z.number().int().min(0, { error: 'Enter the estimated value.' }),
  title: z.string().trim().max(200).optional().nullable(),
  materialNotes: optionalText(1000),
  estimatedQuantity: z.number().min(0).optional().nullable(),
  quantityUnit: z.enum(['SQFT', 'SQM', 'NOS', 'SET', 'BOX']).optional().nullable(),
  expectedCloseDate: optionalDate,
  nextAction: z.enum(NEXT_ACTION_TYPES).optional().nullable(),
  nextActionDate: optionalDate,
  nextActionNote: optionalText(500),
  source: z
    .enum([
      'WALK_IN', 'PHONE_ENQUIRY', 'CUSTOMER_REFERRAL', 'ARCHITECT_REFERRAL', 'CONTRACTOR_REFERRAL',
      'SIGNAGE', 'SOCIAL_MEDIA', 'EXHIBITION', 'EXISTING_CUSTOMER', 'OTHER',
    ])
    .default('WALK_IN'),
})

export type CreateOpportunityInput = z.input<typeof createOpportunitySchema>

/**
 * §11.3 — a new opportunity on an existing project or account.
 *
 * **One project has many opportunities.** Nothing here checks whether the project
 * already carries one, and nothing may ever be added that does: a site buys
 * tiles, then sanitaryware, then CP fittings, and each is its own deal (§5.5).
 */
export async function createOpportunity(input: CreateOpportunityInput): Promise<OpportunityRow> {
  const user = await requireUser()
  const data = parseOrThrow(createOpportunitySchema, input)

  if (Boolean(data.nextAction) !== Boolean(data.nextActionDate)) {
    throw new AppError('VALIDATION_FAILED', 'A next action needs both a type and a date — or neither.', {
      field: 'nextActionDate',
    })
  }

  const supabase = await createSupabaseServerClient()

  // The title defaults to the project's name when there is one, the customer's
  // otherwise (§8.4). Reading them is subject to RLS, so a caller who cannot see
  // the parent gets a `NOT_FOUND` from the insert rather than a leaked name.
  let title = data.title?.trim() || null
  if (!title) {
    const [{ data: account }, { data: project }] = await Promise.all([
      supabase.from('accounts').select('name').eq('id', data.accountId).maybeSingle(),
      data.projectId
        ? supabase.from('projects').select('name').eq('id', data.projectId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    if (!account) throw notFound('customer')
    title = opportunityTitle({
      accountName: account.name,
      projectName: project?.name ?? null,
      category: data.category,
    })
  }

  const { data: row, error } = await supabase
    .from('opportunities')
    .insert({
      title,
      account_id: data.accountId,
      project_id: data.projectId ?? null,
      outlet_id: data.outletId,
      owner_id: user.id,
      stage: 'new',
      category: data.category,
      estimated_value: data.estimatedValuePaise,
      material_notes: data.materialNotes,
      estimated_quantity: data.estimatedQuantity ?? null,
      quantity_unit: data.quantityUnit ?? null,
      expected_close_date: data.expectedCloseDate ?? null,
      next_action: data.nextAction ?? null,
      next_action_date: data.nextActionDate ?? null,
      next_action_note: data.nextActionNote,
      source: data.source,
      created_by: user.id,
    })
    .select('*')
    .single()

  if (error) throw fromPostgrestError(error)
  return row
}

/**
 * Editable fields (§11.7 and the detail screen).
 *
 * `stage` and `owner_id` are deliberately absent: they move only through
 * `changeOpportunityStage()` and `reassignOpportunity()`, so every change of
 * either lands in the audit trail with its reason.
 */
export const updateOpportunitySchema = z.object({
  title: z.string().trim().min(2).max(200),
  category: z.enum(CATEGORIES),
  estimatedValuePaise: z.number().int().min(0),
  materialNotes: optionalText(1000),
  estimatedQuantity: z.number().min(0).optional().nullable(),
  quantityUnit: z.enum(['SQFT', 'SQM', 'NOS', 'SET', 'BOX']).optional().nullable(),
  expectedCloseDate: optionalDate,
  projectId: uuidSchema.optional().nullable(),
  quotationRef: optionalText(80),
  quotationDate: optionalDate,
  quotedValuePaise: z.number().int().min(0).optional().nullable(),
  quotationStatus: z
    .enum(['NONE', 'PREPARING', 'SENT', 'UNDER_DISCUSSION', 'REVISED', 'ACCEPTED', 'REJECTED', 'EXPIRED'])
    .optional(),
  quotationValidUntil: optionalDate,
  competitor: optionalText(120),
})

export type UpdateOpportunityInput = z.input<typeof updateOpportunitySchema>

export async function updateOpportunity(
  id: string,
  input: UpdateOpportunityInput,
): Promise<OpportunityRow> {
  await requireUser()
  const data = parseOrThrow(updateOpportunitySchema, input)
  const supabase = await createSupabaseServerClient()

  const { data: row, error } = await supabase
    .from('opportunities')
    .update({
      title: data.title,
      category: data.category,
      estimated_value: data.estimatedValuePaise,
      material_notes: data.materialNotes,
      estimated_quantity: data.estimatedQuantity ?? null,
      quantity_unit: data.quantityUnit ?? null,
      expected_close_date: data.expectedCloseDate ?? null,
      project_id: data.projectId ?? null,
      quotation_ref: data.quotationRef,
      quotation_date: data.quotationDate ?? null,
      quoted_value: data.quotedValuePaise ?? null,
      ...(data.quotationStatus ? { quotation_status: data.quotationStatus } : {}),
      quotation_valid_until: data.quotationValidUntil ?? null,
      competitor: data.competitor,
    })
    .eq('id', uuidSchema.parse(id))
    .is('archived_at', null)
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!row) throw notFound('opportunity')
  return row
}

// ------------------------------------------------------------ next action --

export const updateNextActionSchema = z.union([
  z.object({
    nextAction: z.enum(NEXT_ACTION_TYPES),
    nextActionDate: dateSchema,
    nextActionNote: optionalText(500),
  }),
  // §8.3 — "cannot determine yet". Both fields clear and the opportunity
  // surfaces in the Missing Next Action list. This is a legitimate answer, not a
  // failure to fill the form in.
  z.null(),
])

export type UpdateNextActionInput = z.input<typeof updateNextActionSchema>

/**
 * §11.6 — writes only the next-action fields.
 *
 * The most-used write in the product. A closed opportunity has no next action, so
 * the update refuses rather than resurrecting one in somebody's overdue list.
 */
export async function updateNextAction(
  id: string,
  input: UpdateNextActionInput,
): Promise<OpportunityRow> {
  await requireUser()
  const data = parseOrThrow(updateNextActionSchema, input)
  const opportunityId = uuidSchema.parse(id)
  const supabase = await createSupabaseServerClient()

  const current = await getOpportunity(opportunityId)
  if (current.stage === 'won' || current.stage === 'lost') {
    throw new AppError('VALIDATION_FAILED', 'A closed opportunity has no next action.', {
      field: 'nextActionDate',
    })
  }

  const { data: row, error } = await supabase
    .from('opportunities')
    .update(
      data === null
        ? { next_action: null, next_action_date: null, next_action_note: null }
        : {
            next_action: data.nextAction,
            next_action_date: data.nextActionDate,
            next_action_note: data.nextActionNote,
          },
    )
    .eq('id', opportunityId)
    .is('archived_at', null)
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  // The USING clause hid the row: readable, but not writable by this caller.
  if (!row) throw new AppError('FORBIDDEN', 'You cannot change this opportunity.')
  return row
}

// ---------------------------------------------------------- stage changes --

export const stagePayloadSchema = z.object({
  quotationRef: optionalText(80),
  quotationDate: optionalDate,
  quotedValuePaise: z.number().int().min(0).optional().nullable(),
  finalOrderValuePaise: z.number().int().min(0).optional().nullable(),
  orderReference: optionalText(80),
  lostReason: z.enum(LOST_REASONS).optional().nullable(),
  lostDetail: optionalText(1000),
  competitor: optionalText(120),
  nextAction: z.enum(NEXT_ACTION_TYPES).optional().nullable(),
  nextActionDate: optionalDate,
  nextActionNote: optionalText(500),
})

export type StagePayload = z.input<typeof stagePayloadSchema>

/**
 * §11.7 — the single entry point for every stage change.
 *
 * The matrix in `lib/opportunity/transitions.ts` decides legality, including who
 * may perform an elevated move (ADR-007's `won → qualified` reopen) and when a
 * backward move needs a reason. The RPC then applies §9.3's side effects
 * atomically, and the trigger writes the event — so no path exists that changes a
 * stage without an audit row.
 */
export async function changeOpportunityStage(
  id: string,
  toStage: Stage,
  payload: StagePayload = {},
  reason?: string | null,
): Promise<OpportunityRow> {
  const user = await requireUser()
  const opportunityId = uuidSchema.parse(id)
  const data = parseOrThrow(stagePayloadSchema, payload)

  const current = await getOpportunity(opportunityId)
  const from = current.stage as Stage

  const check = checkTransition({ from, to: toStage, role: user.role, reason })
  if (!check.allowed) {
    switch (check.reason) {
      case 'INVALID_TRANSITION':
        throw new AppError(
          'INVALID_TRANSITION',
          `An opportunity cannot move from ${from.replace(/_/g, ' ')} to ${toStage.replace(/_/g, ' ')}.`,
          { field: 'stage' },
        )
      case 'ROLE_REQUIRED':
        throw new AppError('FORBIDDEN', 'Only a manager or the owner can make that change.', {
          field: 'stage',
        })
      case 'REASON_REQUIRED':
        throw new AppError('VALIDATION_FAILED', 'Give a reason for moving this back.', {
          field: 'reason',
        })
    }
  }

  const supabase = await createSupabaseServerClient()
  const { data: row, error } = await supabase.rpc('change_opportunity_stage', {
    p_opportunity_id: opportunityId,
    p_to_stage: toStage,
    p_reason: reason ?? undefined,
    p_quotation_ref: data.quotationRef ?? undefined,
    p_quotation_date: data.quotationDate ?? undefined,
    p_quoted_value: data.quotedValuePaise ?? undefined,
    p_final_order_value: data.finalOrderValuePaise ?? undefined,
    p_order_reference: data.orderReference ?? undefined,
    p_lost_reason: data.lostReason ?? undefined,
    p_lost_detail: data.lostDetail ?? undefined,
    p_competitor: data.competitor ?? undefined,
    p_next_action: data.nextAction ?? undefined,
    p_next_action_date: data.nextActionDate ?? undefined,
    p_next_action_note: data.nextActionNote ?? undefined,
  })

  if (error) throw fromPostgrestError(error)
  return row as unknown as OpportunityRow
}

/**
 * §11.8 — won. `final_order_value` is required by `won_requires_value`, and the
 * trigger from migration 018 promotes the account to ACTIVE (§8.7).
 *
 * The follow-on opportunity §9.3 asks for is **prompted, never auto-created**:
 * this returns and the UI offers the option. Creating one here would invent a
 * deal nobody agreed to (CLAUDE.md §15).
 */
export async function markOpportunityWon(
  id: string,
  input: { finalOrderValuePaise: number; orderReference?: string | null },
): Promise<OpportunityRow> {
  const value = z
    .number()
    .int()
    .min(0, { error: 'Enter the confirmed order value.' })
    .safeParse(input.finalOrderValuePaise)

  if (!value.success) {
    throw new AppError('VALIDATION_FAILED', 'Enter the confirmed order value before marking this won.', {
      field: 'finalOrderValue',
    })
  }

  return changeOpportunityStage(id, 'won', {
    finalOrderValuePaise: value.data,
    orderReference: input.orderReference ?? null,
  })
}

/** §11.8 — lost. `lost_reason` is required by `lost_requires_reason`. */
export async function markOpportunityLost(
  id: string,
  input: { lostReason: (typeof LOST_REASONS)[number]; lostDetail?: string | null; competitor?: string | null },
): Promise<OpportunityRow> {
  if (!input.lostReason) {
    throw new AppError('VALIDATION_FAILED', 'Choose a reason before marking this lost.', {
      field: 'lostReason',
    })
  }

  return changeOpportunityStage(id, 'lost', {
    lostReason: input.lostReason,
    lostDetail: input.lostDetail ?? null,
    competitor: input.competitor ?? null,
  })
}

/**
 * ADR-007 — reopen. MANAGER/OWNER only, reason required, `won → qualified`.
 *
 * The historical `WON` event is preserved; a `REOPENED` event is appended. There
 * is no silent edit of a win anywhere in the system (§9.2).
 */
export async function reopenOpportunity(id: string, reason: string): Promise<OpportunityRow> {
  const user = await requireUser()
  if (!isManagerOrAbove(user)) {
    throw new AppError('FORBIDDEN', 'Only a manager or the owner can reopen a closed opportunity.')
  }
  if (!reason?.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Give a reason for reopening this.', { field: 'reason' })
  }

  const current = await getOpportunity(uuidSchema.parse(id))
  if (current.stage !== 'won' && current.stage !== 'lost') {
    throw new AppError('VALIDATION_FAILED', 'This opportunity is not closed.', { field: 'stage' })
  }

  return changeOpportunityStage(id, 'qualified', {}, reason)
}

// ------------------------------------------------------------- assignment --

/**
 * §11.9 — assign or reassign. MANAGER/OWNER only.
 *
 * The role check here produces the readable message; `opportunities_update`'s
 * WITH CHECK is what actually stops a salesperson, because after changing
 * `owner_id` the row no longer satisfies `owner_id = current_user_id()`.
 *
 * **Activities keep their original `performed_by`** (§8.1). Nothing in this
 * function touches them, and nothing else may.
 */
export async function reassignOpportunity(
  id: string,
  userId: string,
  reason: string,
): Promise<OpportunityRow> {
  const actor = await requireUser()
  if (!isManagerOrAbove(actor)) {
    throw new AppError('FORBIDDEN', 'Only a manager or the owner can reassign work.')
  }
  if (!reason?.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Give a reason for the reassignment.', { field: 'reason' })
  }

  const supabase = await createSupabaseServerClient()

  // ADR-001 — the reason reaches the audit trigger through a transaction-local
  // GUC. PostgREST gives each statement its own transaction, so a `set_config`
  // sent separately from the update would record an empty reason on every
  // `OWNER_CHANGED` event. The RPC keeps the pair in one transaction.
  const { data: row, error } = await supabase.rpc('reassign_opportunity', {
    p_opportunity_id: uuidSchema.parse(id),
    p_to_user: uuidSchema.parse(userId),
    p_reason: reason,
  })

  if (error) throw fromPostgrestError(error)
  return row as unknown as OpportunityRow
}

/** §11.9 — bulk reassignment of everything one person still owns. */
export async function bulkReassign(
  fromUserId: string,
  toUserId: string,
  reason: string,
): Promise<{ moved: number }> {
  const actor = await requireUser()
  if (!isManagerOrAbove(actor)) {
    throw new AppError('FORBIDDEN', 'Only a manager or the owner can reassign work.')
  }
  if (!reason?.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Give a reason for the reassignment.', { field: 'reason' })
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('bulk_reassign', {
    p_from_user: uuidSchema.parse(fromUserId),
    p_to_user: uuidSchema.parse(toUserId),
    p_reason: reason,
  })

  if (error) throw fromPostgrestError(error)
  return { moved: data ?? 0 }
}
