import { z } from 'zod'

import {
  NAME_CITY_SIMILARITY_THRESHOLD,
  NAME_ONLY_SIMILARITY_THRESHOLD,
  confidenceFor,
  type DuplicateMatch,
  type DuplicateSignal,
} from '@/lib/duplicates'
import { AppError, fromPostgrestError, notFound } from '@/lib/errors'
import { opportunityTitle } from '@/lib/opportunity/title'
import { pageRange, paginate, type PageParams, type Paginated } from '@/lib/pagination'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { optionalPhoneSchema, uuidSchema } from '@/lib/validation'
import { requireUser } from '@/services/auth.service'
import type {
  AccountRow,
  AccountStatus,
  AccountType,
  ActivityRow,
  OpportunityRow,
  ProjectRow,
  SessionUser,
} from '@/types/domain'

/**
 * Accounts — "Customers" everywhere in the UI (§12.2).
 *
 * Authorization is the RLS policies on `accounts`, not anything written here.
 * A salesperson calling `listAccounts()` gets their own records plus the ones
 * they hold work context on, because that is what `accounts_select` says; this
 * service would return the same rows if every check below were deleted. What the
 * service adds is validation, error mapping, defaults, and the atomic
 * multi-table write of §11.1.
 */

const ACCOUNT_COLUMNS =
  'id, name, account_type, phone, alt_phone, whatsapp_phone, email, address, city, area, ' +
  'source, owner_id, status, gstin, notes, outlet_id, last_activity_at, referred_by_contact_id, ' +
  'archived_at, created_at, updated_at'

/**
 * Reachability (ADR-013): an account with neither a phone nor an email answers
 * none of §1.2's five questions. The database constraint `account_reachable` is
 * what makes this true; this only produces the friendlier message first.
 */
const reachable = <T extends { phone?: string | null; email?: string | null }>(value: T, ctx: z.RefinementCtx) => {
  if (!value.phone && !value.email) {
    ctx.addIssue({
      code: 'custom',
      path: ['phone'],
      message: 'Add a phone number or an email for this customer.',
    })
  }
}

export const ACCOUNT_TYPES = [
  'HOMEOWNER', 'CONTRACTOR', 'BUILDER', 'ARCHITECT', 'INTERIOR_DESIGNER',
  'DEALER', 'COMMERCIAL', 'MASON', 'OTHER',
] as const satisfies readonly AccountType[]

export const ACCOUNT_STATUSES = [
  'PROSPECT', 'ACTIVE', 'DORMANT', 'DO_NOT_CONTACT',
] as const satisfies readonly AccountStatus[]

const accountTypeSchema = z.enum(ACCOUNT_TYPES)

const leadSourceSchema = z.enum([
  'WALK_IN', 'PHONE_ENQUIRY', 'CUSTOMER_REFERRAL', 'ARCHITECT_REFERRAL', 'CONTRACTOR_REFERRAL',
  'SIGNAGE', 'SOCIAL_MEDIA', 'EXHIBITION', 'EXISTING_CUSTOMER', 'OTHER',
])

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null))

const optionalEmail = z
  .union([z.string().trim().email({ error: 'Enter a valid email address.' }), z.literal('')])
  .optional()
  .transform((value) => (value ? value.toLowerCase() : null))

export const createAccountSchema = z
  .object({
    name: z.string().trim().min(2, { error: 'Enter at least two characters.' }).max(160),
    accountType: accountTypeSchema,
    outletId: uuidSchema,
    phone: optionalPhoneSchema,
    altPhone: optionalPhoneSchema,
    whatsappPhone: optionalPhoneSchema,
    email: optionalEmail,
    address: optionalText(500),
    city: optionalText(120),
    area: optionalText(120),
    source: leadSourceSchema.default('WALK_IN'),
    gstin: optionalText(20),
    notes: optionalText(2000),
  })
  .superRefine(reachable)

export type CreateAccountInput = z.input<typeof createAccountSchema>

export const updateAccountSchema = createAccountSchema.safeExtend({
  status: z.enum(ACCOUNT_STATUSES).optional(),
})

export type UpdateAccountInput = z.input<typeof updateAccountSchema>

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
 * The outlet a new record belongs to.
 *
 * Outlet names are DATA (ADR-016) — nothing here knows one. A salesperson posted
 * to exactly one outlet never sees the field; anyone with a choice to make must
 * make it, because guessing would silently file a customer against the wrong
 * branch.
 */
export function resolveDefaultOutlet(user: SessionUser): string | null {
  return user.outletIds.length === 1 ? user.outletIds[0] : null
}

// -------------------------------------------------------------------- reads --

export type AccountFilters = {
  q?: string | null
  status?: AccountStatus | null
  accountType?: AccountType | null
  city?: string | null
  ownerId?: string | null
  outletId?: string | null
  mineOnly?: boolean
}

/**
 * Filters arrive from URL search params, so they are strings from an address bar
 * a user can edit. Anything that is not a real enum member is dropped rather than
 * passed through — an unknown value would otherwise reach PostgREST and come back
 * as a raw database error (§16.2).
 */
export function parseAccountFilters(raw: Record<string, string | undefined>): AccountFilters {
  const asEnum = <T extends string>(value: string | undefined, allowed: readonly T[]): T | null =>
    value && (allowed as readonly string[]).includes(value) ? (value as T) : null

  return {
    q: raw.q?.trim() || null,
    status: asEnum(raw.status, ACCOUNT_STATUSES),
    accountType: asEnum(raw.type, ACCOUNT_TYPES),
    city: raw.city?.trim() || null,
    ownerId: raw.owner?.trim() || null,
    outletId: raw.outlet?.trim() || null,
    mineOnly: raw.mine === '1',
  }
}

/**
 * The customer list (§12.2). Always paginated — §12.8 forbids an unbounded list
 * query anywhere — and always filtered to `archived_at is null` (CLAUDE.md §11).
 */
export async function listAccounts(
  filters: AccountFilters,
  params: PageParams,
): Promise<Paginated<AccountRow>> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()
  const { from, to } = pageRange(params)

  let query = supabase
    .from('accounts')
    .select(ACCOUNT_COLUMNS, { count: 'exact' })
    .is('archived_at', null)

  if (filters.mineOnly) query = query.eq('owner_id', user.id)
  if (filters.ownerId) query = query.eq('owner_id', filters.ownerId)
  if (filters.outletId) query = query.eq('outlet_id', filters.outletId)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.accountType) query = query.eq('account_type', filters.accountType)
  if (filters.city) query = query.eq('city', filters.city)

  const term = filters.q?.trim()
  if (term && term.length >= 2) {
    // PostgREST `or` takes a comma-separated filter list; a comma or parenthesis
    // inside the term would break out of it, so both are stripped rather than
    // escaped. The value still reaches Postgres as a bound parameter.
    const safe = term.replace(/[,()*]/g, ' ').trim()
    const digits = term.replace(/\D/g, '')
    const clauses = [`name.ilike.%${safe}%`]
    if (digits.length >= 4) clauses.push(`phone_normalized.like.%${digits}%`)
    query = query.or(clauses.join(','))
  }

  const { data, error, count } = await query
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw fromPostgrestError(error)
  return paginate((data ?? []) as unknown as AccountRow[], count ?? 0, params)
}

export async function getAccount(id: string): Promise<AccountRow> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', uuidSchema.parse(id))
    .is('archived_at', null)
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  // RLS returns nothing for a record this user may not see, and "invisible" must
  // read exactly like "does not exist" (§25).
  if (!data) throw notFound('customer')
  return data as unknown as AccountRow
}

export type Account360 = {
  account: AccountRow
  openOpportunities: OpportunityRow[]
  closedOpportunities: OpportunityRow[]
  projects: ProjectRow[]
  recentActivities: ActivityRow[]
  wonValuePaise: number
  pipelineValuePaise: number
}

/**
 * Customer 360 (§12.4) — the most-used screen in the application.
 *
 * One account, its opportunities split open/closed, its projects and the three
 * most recent activities. `activities.account_id` is always populated (§5.8),
 * which is what makes the timeline a single indexed query rather than a union
 * across every child table.
 */
export async function getAccount360(id: string): Promise<Account360> {
  const accountId = uuidSchema.parse(id)
  const account = await getAccount(accountId)
  const supabase = await createSupabaseServerClient()

  const [opportunities, projects, activities] = await Promise.all([
    supabase
      .from('opportunities')
      .select('*')
      .eq('account_id', accountId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('projects')
      .select('*')
      .eq('account_id', accountId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(25),
    // §12.4 — exactly three activities above the fold.
    supabase
      .from('activities')
      .select('*')
      .eq('account_id', accountId)
      .order('occurred_at', { ascending: false })
      .limit(3),
  ])

  if (opportunities.error) throw fromPostgrestError(opportunities.error)
  if (projects.error) throw fromPostgrestError(projects.error)
  if (activities.error) throw fromPostgrestError(activities.error)

  const all = opportunities.data ?? []
  const open = all.filter((o) => o.stage !== 'won' && o.stage !== 'lost')

  return {
    account,
    openOpportunities: open,
    closedOpportunities: all.filter((o) => o.stage === 'won' || o.stage === 'lost'),
    projects: projects.data ?? [],
    recentActivities: activities.data ?? [],
    // §13.1 — Won Value is the final order value; Pipeline Value excludes
    // `nurture` as well as the two terminal stages.
    wonValuePaise: all
      .filter((o) => o.stage === 'won')
      .reduce((sum, o) => sum + (o.final_order_value ?? 0), 0),
    pipelineValuePaise: open
      .filter((o) => o.stage !== 'nurture')
      .reduce((sum, o) => sum + o.estimated_value, 0),
  }
}

// ------------------------------------------------------------------- writes --

export async function createAccount(input: CreateAccountInput): Promise<AccountRow> {
  const user = await requireUser()
  const data = parseOrThrow(createAccountSchema, input)
  const supabase = await createSupabaseServerClient()

  const { data: row, error } = await supabase
    .from('accounts')
    .insert({
      name: data.name,
      account_type: data.accountType,
      phone: data.phone,
      alt_phone: data.altPhone,
      whatsapp_phone: data.whatsappPhone,
      email: data.email,
      address: data.address,
      city: data.city,
      area: data.area,
      source: data.source,
      gstin: data.gstin,
      notes: data.notes,
      outlet_id: data.outletId,
      // §8.4 — owner defaults to the current user, status to PROSPECT.
      owner_id: user.id,
      status: 'PROSPECT',
      created_by: user.id,
    })
    .select(ACCOUNT_COLUMNS)
    .single()

  if (error) throw fromPostgrestError(error)
  return row as unknown as AccountRow
}

export async function updateAccount(id: string, input: UpdateAccountInput): Promise<AccountRow> {
  await requireUser()
  const data = parseOrThrow(updateAccountSchema, input)
  const supabase = await createSupabaseServerClient()

  const { data: row, error } = await supabase
    .from('accounts')
    .update({
      name: data.name,
      account_type: data.accountType,
      phone: data.phone,
      alt_phone: data.altPhone,
      whatsapp_phone: data.whatsappPhone,
      email: data.email,
      address: data.address,
      city: data.city,
      area: data.area,
      source: data.source,
      gstin: data.gstin,
      notes: data.notes,
      outlet_id: data.outletId,
      ...(data.status ? { status: data.status } : {}),
    })
    .eq('id', uuidSchema.parse(id))
    .is('archived_at', null)
    .select(ACCOUNT_COLUMNS)
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!row) throw notFound('customer')
  return row as unknown as AccountRow
}

// -------------------------------------------------------------- duplicates --

export const checkDuplicatesSchema = z.object({
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  name: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  excludeId: uuidSchema.optional().nullable(),
})

export type CheckDuplicatesInput = z.input<typeof checkDuplicatesSchema>

/**
 * Advisory duplicate detection (§8.9).
 *
 * **Warns. Never merges. Never blocks.** The caller is free to ignore the result
 * entirely, and `createAccount` does not consult it — that is deliberate, and is
 * what "never block creation outright" means in code rather than in prose.
 *
 * The SQL runs as the caller, so a near-identical account belonging to a
 * salesperson in another outlet is not returned. That is the correct trade:
 * surfacing it would leak a record the user has no right to see (§25), and RLS is
 * the boundary (CLAUDE.md §6).
 */
export async function checkDuplicates(input: CheckDuplicatesInput): Promise<DuplicateMatch[]> {
  await requireUser()
  const data = parseOrThrow(checkDuplicatesSchema, input)

  if (!data.phone && !data.email && !(data.name && data.name.length >= 3)) return []

  const supabase = await createSupabaseServerClient()
  const { data: rows, error } = await supabase.rpc('find_account_duplicates', {
    p_name_city_threshold: NAME_CITY_SIMILARITY_THRESHOLD,
    p_name_only_threshold: NAME_ONLY_SIMILARITY_THRESHOLD,
    p_phone: data.phone ?? undefined,
    p_email: data.email ?? undefined,
    p_name: data.name ?? undefined,
    p_city: data.city ?? undefined,
    p_exclude_id: data.excludeId ?? undefined,
  })

  if (error) throw fromPostgrestError(error)

  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    accountType: row.account_type,
    phone: row.phone,
    email: row.email,
    city: row.city,
    status: row.status,
    signal: row.signal as DuplicateSignal,
    confidence: confidenceFor(row.signal as DuplicateSignal),
    nameSimilarity: row.name_similarity,
  }))
}

// ------------------------------------------- the primary mobile flow (§11.1) --

export const createAccountWithOpportunitySchema = createAccountSchema.safeExtend({
  category: z.enum(['TILES', 'MARBLE', 'GRANITE', 'SANITARYWARE', 'CP_FITTINGS', 'ALLIED', 'MIXED']),
  estimatedValuePaise: z.number().int().min(0, { error: 'Enter the estimated value.' }),
  title: z.string().trim().max(200).optional().nullable(),
  materialNotes: optionalText(1000),
  expectedCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  nextAction: z
    .enum([
      'CALL', 'SHOWROOM_VISIT', 'SITE_VISIT', 'SEND_QUOTATION', 'SHARE_SAMPLES',
      'QUOTATION_FOLLOWUP', 'PRICE_DISCUSSION', 'AWAIT_CUSTOMER', 'OTHER',
    ])
    .optional()
    .nullable(),
  nextActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  nextActionNote: optionalText(500),
  projectId: uuidSchema.optional().nullable(),
})

export type CreateAccountWithOpportunityInput = z.input<typeof createAccountWithOpportunitySchema>

export type CreateAccountWithOpportunityResult = {
  accountId: string
  opportunityId: string
  activityId: string
}

/**
 * §11.1 — customer and opportunity in one flow, target sixty seconds.
 *
 * One RPC, therefore one transaction (§16.3): account → opportunity → opening
 * activity, with the trigger writing `opportunity_events.CREATED` on the way
 * through. Sequential client calls could leave a customer with no enquiry
 * attached, which is exactly the half-finished record a notebook never produces.
 *
 * **`next_action` and `next_action_date` are both-or-neither** — the
 * `next_action_pairing` constraint enforces it, and this rejects the mismatch
 * first so the message names the field.
 */
export async function createAccountWithOpportunity(
  input: CreateAccountWithOpportunityInput,
): Promise<CreateAccountWithOpportunityResult> {
  await requireUser()
  const data = parseOrThrow(createAccountWithOpportunitySchema, input)

  if (Boolean(data.nextAction) !== Boolean(data.nextActionDate)) {
    throw new AppError('VALIDATION_FAILED', 'A next action needs both a type and a date — or neither.', {
      field: 'nextActionDate',
    })
  }

  const supabase = await createSupabaseServerClient()
  const { data: rows, error } = await supabase
    .rpc('create_account_with_opportunity', {
      p_name: data.name,
      p_account_type: data.accountType,
      p_outlet_id: data.outletId,
      p_category: data.category,
      p_estimated_value: data.estimatedValuePaise,
      // §8.4 — auto-generated and editable. No project exists yet in this flow,
      // so the account name is the subject.
      p_title: data.title?.trim() || opportunityTitle({ accountName: data.name, category: data.category }),
      p_phone: data.phone ?? undefined,
      p_email: data.email ?? undefined,
      p_city: data.city ?? undefined,
      p_area: data.area ?? undefined,
      p_address: data.address ?? undefined,
      p_source: data.source,
      p_notes: data.notes ?? undefined,
      p_next_action: data.nextAction ?? undefined,
      p_next_action_date: data.nextActionDate ?? undefined,
      p_next_action_note: data.nextActionNote ?? undefined,
      p_expected_close_date: data.expectedCloseDate ?? undefined,
      p_material_notes: data.materialNotes ?? undefined,
      p_project_id: data.projectId ?? undefined,
    })
    .single()

  if (error) throw fromPostgrestError(error)
  if (!rows) throw new AppError('INTERNAL', 'The customer could not be created. Try again.')

  return {
    accountId: rows.account_id,
    opportunityId: rows.opportunity_id,
    activityId: rows.activity_id,
  }
}
