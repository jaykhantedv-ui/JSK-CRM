import { z } from 'zod'

import { AppError, fromPostgrestError, notFound } from '@/lib/errors'
import { pageRange, paginate, type PageParams, type Paginated } from '@/lib/pagination'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'
import { requireUser } from '@/services/auth.service'
import { INFLUENCE_LEVELS, STAKEHOLDER_ROLES } from '@/services/contact.service'
import type {
  ActivityRow,
  ConstructionStage,
  OpportunityRow,
  ProjectRow,
  ProjectStakeholderRow,
  ProjectStatus,
  ProjectType,
  StakeholderWithTarget,
} from '@/types/domain'

/**
 * Projects (§5.5) — a real construction or interior site.
 *
 * **ONE PROJECT HAS MANY OPPORTUNITIES.** A site buys tiles, then sanitaryware,
 * then CP fittings, and each is a separate deal with its own stage and value.
 * Nothing in this service, and nothing that ever calls it, may assume otherwise:
 * there is no "the project's opportunity", only `listProjectOpportunities()`.
 *
 * `opportunities.project_id` is optional in the other direction (§8.5) — a repeat
 * trade order has no site. The UI encourages a project; it never requires one.
 */

export const PROJECT_TYPES = [
  'INDIVIDUAL_HOUSE', 'VILLA', 'APARTMENT_UNIT', 'APARTMENT_PROJECT',
  'COMMERCIAL', 'HOSPITALITY', 'INSTITUTIONAL', 'RENOVATION', 'OTHER',
] as const satisfies readonly ProjectType[]

export const CONSTRUCTION_STAGES = [
  'PLANNING', 'FOUNDATION', 'STRUCTURE', 'BRICKWORK', 'PLASTERING',
  'FLOORING_STAGE', 'FINISHING', 'COMPLETED', 'RENOVATION', 'UNKNOWN',
] as const satisfies readonly ConstructionStage[]

export const PROJECT_STATUSES = [
  'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ABANDONED',
] as const satisfies readonly ProjectStatus[]

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null))

const optionalInt = (min: number, max: number) =>
  z.number().int().min(min).max(max).optional().nullable()

export const createProjectSchema = z.object({
  name: z.string().trim().min(2, { error: 'Enter at least two characters.' }).max(160),
  accountId: uuidSchema,
  outletId: uuidSchema,
  projectType: z.enum(PROJECT_TYPES),
  // §8.4 — construction stage defaults to UNKNOWN. A salesperson who has not
  // been to the site yet must not have to guess.
  constructionStage: z.enum(CONSTRUCTION_STAGES).default('UNKNOWN'),
  status: z.enum(PROJECT_STATUSES).default('ACTIVE'),
  siteAddress: optionalText(500),
  city: optionalText(120),
  area: optionalText(120),
  builtupAreaSqft: optionalInt(1, 1_000_000),
  floors: optionalInt(0, 200),
  bathrooms: optionalInt(0, 500),
  expectedFlooringDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  estimatedValuePaise: z.number().int().min(0).optional().nullable(),
  notes: optionalText(2000),
})

export type CreateProjectInput = z.input<typeof createProjectSchema>
export type UpdateProjectInput = CreateProjectInput

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

export type ProjectFilters = {
  q?: string | null
  accountId?: string | null
  status?: ProjectStatus | null
  constructionStage?: ConstructionStage | null
  city?: string | null
  ownerId?: string | null
  outletId?: string | null
  mineOnly?: boolean
}

/** §12.2 — the project list filters: construction stage, city, status. */
export function parseProjectFilters(raw: Record<string, string | undefined>): ProjectFilters {
  const asEnum = <T extends string>(value: string | undefined, allowed: readonly T[]): T | null =>
    value && (allowed as readonly string[]).includes(value) ? (value as T) : null

  return {
    q: raw.q?.trim() || null,
    accountId: raw.account?.trim() || null,
    status: asEnum(raw.status, PROJECT_STATUSES),
    constructionStage: asEnum(raw.stage, CONSTRUCTION_STAGES),
    city: raw.city?.trim() || null,
    ownerId: raw.owner?.trim() || null,
    outletId: raw.outlet?.trim() || null,
    mineOnly: raw.mine === '1',
  }
}

export async function listProjects(
  filters: ProjectFilters,
  params: PageParams,
): Promise<Paginated<ProjectRow>> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()
  const { from, to } = pageRange(params)

  let query = supabase.from('projects').select('*', { count: 'exact' }).is('archived_at', null)

  if (filters.mineOnly) query = query.eq('owner_id', user.id)
  if (filters.ownerId) query = query.eq('owner_id', filters.ownerId)
  if (filters.outletId) query = query.eq('outlet_id', filters.outletId)
  if (filters.accountId) query = query.eq('account_id', filters.accountId)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.constructionStage) query = query.eq('construction_stage', filters.constructionStage)
  if (filters.city) query = query.eq('city', filters.city)

  const term = filters.q?.trim()
  if (term && term.length >= 2) {
    query = query.ilike('name', `%${term.replace(/[,()*%_]/g, ' ').trim()}%`)
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw fromPostgrestError(error)
  return paginate(data ?? [], count ?? 0, params)
}

export async function getProject(id: string): Promise<ProjectRow> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', uuidSchema.parse(id))
    .is('archived_at', null)
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!data) throw notFound('project')
  return data
}

export type { StakeholderWithTarget } from '@/types/domain'

export type ProjectDetail = {
  project: ProjectRow
  account: { id: string; name: string; phone: string | null } | null
  opportunities: OpportunityRow[]
  stakeholders: StakeholderWithTarget[]
  activities: ActivityRow[]
}

export async function getProjectDetail(id: string): Promise<ProjectDetail> {
  const projectId = uuidSchema.parse(id)
  const project = await getProject(projectId)
  const supabase = await createSupabaseServerClient()

  const [account, opportunities, stakeholders, activities] = await Promise.all([
    supabase.from('accounts').select('id, name, phone').eq('id', project.account_id).maybeSingle(),
    // MANY opportunities. Never `.single()`, never `.limit(1)`.
    supabase
      .from('opportunities')
      .select('*')
      .eq('project_id', projectId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('project_stakeholders')
      .select('*, contact:contacts(id, full_name, phone, email), account:accounts(id, name, phone)')
      .eq('project_id', projectId)
      .order('is_primary', { ascending: false }),
    supabase
      .from('activities')
      .select('*')
      .eq('project_id', projectId)
      .order('occurred_at', { ascending: false })
      .limit(10),
  ])

  if (opportunities.error) throw fromPostgrestError(opportunities.error)
  if (stakeholders.error) throw fromPostgrestError(stakeholders.error)
  if (activities.error) throw fromPostgrestError(activities.error)

  return {
    project,
    account: account.data ?? null,
    opportunities: opportunities.data ?? [],
    stakeholders: (stakeholders.data ?? []) as unknown as StakeholderWithTarget[],
    activities: activities.data ?? [],
  }
}

export async function listProjectOpportunities(projectId: string): Promise<OpportunityRow[]> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('opportunities')
    .select('*')
    .eq('project_id', uuidSchema.parse(projectId))
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw fromPostgrestError(error)
  return data ?? []
}

// ------------------------------------------------------------------ writes --

/**
 * §11.2 — a project on an existing customer.
 *
 * The owner inherits the account's owner, not the creator: a manager adding a
 * site to a salesperson's customer must not quietly take the record off them.
 */
export async function createProject(input: CreateProjectInput): Promise<ProjectRow> {
  const user = await requireUser()
  const data = parseOrThrow(createProjectSchema, input)
  const supabase = await createSupabaseServerClient()

  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id, owner_id')
    .eq('id', data.accountId)
    .is('archived_at', null)
    .maybeSingle()

  if (accountError) throw fromPostgrestError(accountError)
  if (!account) throw notFound('customer')

  const { data: row, error } = await supabase
    .from('projects')
    .insert({
      name: data.name,
      account_id: data.accountId,
      outlet_id: data.outletId,
      project_type: data.projectType,
      construction_stage: data.constructionStage,
      status: data.status,
      site_address: data.siteAddress,
      city: data.city,
      area: data.area,
      builtup_area_sqft: data.builtupAreaSqft ?? null,
      floors: data.floors ?? null,
      bathrooms: data.bathrooms ?? null,
      expected_flooring_date: data.expectedFlooringDate ?? null,
      estimated_value: data.estimatedValuePaise ?? null,
      notes: data.notes,
      owner_id: account.owner_id ?? user.id,
      created_by: user.id,
    })
    .select('*')
    .single()

  if (error) throw fromPostgrestError(error)
  return row
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<ProjectRow> {
  await requireUser()
  const data = parseOrThrow(createProjectSchema, input)
  const supabase = await createSupabaseServerClient()

  const { data: row, error } = await supabase
    .from('projects')
    .update({
      name: data.name,
      project_type: data.projectType,
      construction_stage: data.constructionStage,
      status: data.status,
      site_address: data.siteAddress,
      city: data.city,
      area: data.area,
      builtup_area_sqft: data.builtupAreaSqft ?? null,
      floors: data.floors ?? null,
      bathrooms: data.bathrooms ?? null,
      expected_flooring_date: data.expectedFlooringDate ?? null,
      estimated_value: data.estimatedValuePaise ?? null,
      notes: data.notes,
      outlet_id: data.outletId,
    })
    .eq('id', uuidSchema.parse(id))
    .is('archived_at', null)
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!row) throw notFound('project')
  return row
}

// ----------------------------------------------------------- stakeholders --
// §5.6, §11.4. The UI calls these **"People on this project"** — the word
// "stakeholder" is a schema name, not something a salesperson should read.

export const addStakeholderSchema = z
  .object({
    projectId: uuidSchema,
    contactId: uuidSchema.optional().nullable(),
    accountId: uuidSchema.optional().nullable(),
    role: z.enum(STAKEHOLDER_ROLES),
    influence: z.enum(INFLUENCE_LEVELS).default('INFLUENCER'),
    isPrimary: z.boolean().default(false),
    notes: z.string().trim().max(1000).optional().nullable().transform((v) => (v ? v : null)),
  })
  .superRefine((value, ctx) => {
    // `stakeholder_target` — a link has to point at somebody.
    if (!value.contactId && !value.accountId) {
      ctx.addIssue({
        code: 'custom',
        path: ['contactId'],
        message: 'Choose a person or a company for this stakeholder.',
      })
    }
  })

export type AddStakeholderInput = z.input<typeof addStakeholderSchema>

export async function addProjectStakeholder(
  input: AddStakeholderInput,
): Promise<ProjectStakeholderRow> {
  const user = await requireUser()
  const data = parseOrThrow(addStakeholderSchema, input)
  const supabase = await createSupabaseServerClient()

  const { data: row, error } = await supabase
    .from('project_stakeholders')
    .insert({
      project_id: data.projectId,
      contact_id: data.contactId ?? null,
      account_id: data.accountId ?? null,
      role: data.role,
      influence: data.influence,
      is_primary: data.isPrimary,
      notes: data.notes,
      created_by: user.id,
    })
    .select('*')
    .single()

  // `one_primary_per_project` comes back as a friendly message through the
  // constraint map in `lib/errors.ts` rather than as a unique-violation.
  if (error) throw fromPostgrestError(error)
  return row
}

/**
 * The one approved hard delete in the schema (ADR-004).
 *
 * A stakeholder row is a relationship link carrying no history, no ownership and
 * no money, so removing a wrongly-added person is a correction rather than the
 * destruction of a record. **Nothing else in the application may delete anything.**
 */
export async function removeProjectStakeholder(stakeholderId: string): Promise<void> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('project_stakeholders')
    .delete()
    .eq('id', uuidSchema.parse(stakeholderId))

  if (error) throw fromPostgrestError(error)
}

/**
 * §5.6 — at most one primary per project, enforced by the
 * `one_primary_per_project` partial unique index.
 *
 * The old primary is cleared first, in a separate statement. Both are ordinary
 * updates the index arbitrates: if two people race, one of them loses and sees
 * "This site already has a primary contact", which is the correct outcome.
 */
export async function setPrimaryStakeholder(
  projectId: string,
  stakeholderId: string,
): Promise<void> {
  await requireUser()
  const supabase = await createSupabaseServerClient()
  const project = uuidSchema.parse(projectId)
  const stakeholder = uuidSchema.parse(stakeholderId)

  const { error: clearError } = await supabase
    .from('project_stakeholders')
    .update({ is_primary: false })
    .eq('project_id', project)
    .eq('is_primary', true)
    .neq('id', stakeholder)

  if (clearError) throw fromPostgrestError(clearError)

  const { data, error } = await supabase
    .from('project_stakeholders')
    .update({ is_primary: true })
    .eq('id', stakeholder)
    .eq('project_id', project)
    .select('id')
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!data) throw notFound('stakeholder')
}
