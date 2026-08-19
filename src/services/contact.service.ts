import { z } from 'zod'

import { AppError, fromPostgrestError, notFound } from '@/lib/errors'
import { pageRange, paginate, type PageParams, type Paginated } from '@/lib/pagination'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { optionalPhoneSchema, uuidSchema } from '@/lib/validation'
import { requireUser } from '@/services/auth.service'
import type { ContactRow, InfluenceLevel, StakeholderRole } from '@/types/domain'

/**
 * Contacts (§5.4).
 *
 * **A contact is an additional person, not a mandatory customer record.** A
 * simple homeowner needs no contact row at all — the account carries their phone
 * — and the UI must never force one (§5.4). Contacts exist for the other people
 * around a project: the spouse, the architect, the site engineer, the mason.
 *
 * A contact has no outlet of its own. It is reachable through the account it
 * belongs to or through the person who owns it, which is exactly what
 * `contacts_select` says.
 */

export const STAKEHOLDER_ROLES = [
  'OWNER_BUYER', 'SPOUSE_FAMILY', 'ARCHITECT', 'INTERIOR_DESIGNER', 'CONTRACTOR',
  'BUILDER', 'SITE_ENGINEER', 'MASON', 'PURCHASE_MANAGER', 'DEALER', 'OTHER',
] as const satisfies readonly StakeholderRole[]

export const INFLUENCE_LEVELS = [
  'DECISION_MAKER', 'STRONG_INFLUENCER', 'INFLUENCER', 'EXECUTOR', 'INFORMATION_ONLY',
] as const satisfies readonly InfluenceLevel[]

const CONTACT_CHANNELS = ['CALL', 'WHATSAPP', 'IN_PERSON', 'EMAIL'] as const

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null))

const optionalEmail = z
  .union([z.string().trim().email({ error: 'Enter a valid email address.' }), z.literal('')])
  .optional()
  .transform((value) => (value ? value.toLowerCase() : null))

export const createContactSchema = z
  .object({
    fullName: z.string().trim().min(2, { error: 'Enter at least two characters.' }).max(120),
    accountId: uuidSchema.optional().nullable(),
    /** The company this person works for, when it is itself a customer (§5.4). */
    linkedAccountId: uuidSchema.optional().nullable(),
    phone: optionalPhoneSchema,
    altPhone: optionalPhoneSchema,
    email: optionalEmail,
    role: z.enum(STAKEHOLDER_ROLES).default('OTHER'),
    influence: z.enum(INFLUENCE_LEVELS).default('INFLUENCER'),
    preferredChannel: z.enum(CONTACT_CHANNELS).default('CALL'),
    isReferralSource: z.boolean().default(false),
    notes: optionalText(2000),
  })
  .superRefine((value, ctx) => {
    // `contact_reachable` — the database is what makes this true; this only says
    // it in a sentence a salesperson can act on.
    if (!value.phone && !value.email) {
      ctx.addIssue({
        code: 'custom',
        path: ['phone'],
        message: 'Add a phone number or an email for this contact.',
      })
    }
  })

export type CreateContactInput = z.input<typeof createContactSchema>
export type UpdateContactInput = CreateContactInput

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

export type ContactFilters = {
  q?: string | null
  accountId?: string | null
  role?: StakeholderRole | null
  referralOnly?: boolean
  mineOnly?: boolean
}

export function parseContactFilters(raw: Record<string, string | undefined>): ContactFilters {
  return {
    q: raw.q?.trim() || null,
    accountId: raw.account?.trim() || null,
    role:
      raw.role && (STAKEHOLDER_ROLES as readonly string[]).includes(raw.role)
        ? (raw.role as StakeholderRole)
        : null,
    referralOnly: raw.referral === '1',
    mineOnly: raw.mine === '1',
  }
}

export async function listContacts(
  filters: ContactFilters,
  params: PageParams,
): Promise<Paginated<ContactRow>> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()
  const { from, to } = pageRange(params)

  let query = supabase.from('contacts').select('*', { count: 'exact' }).is('archived_at', null)

  if (filters.mineOnly) query = query.eq('owner_id', user.id)
  if (filters.accountId) query = query.eq('account_id', filters.accountId)
  if (filters.role) query = query.eq('role', filters.role)
  if (filters.referralOnly) query = query.eq('is_referral_source', true)

  const term = filters.q?.trim()
  if (term && term.length >= 2) {
    const safe = term.replace(/[,()*]/g, ' ').trim()
    const digits = term.replace(/\D/g, '')
    const clauses = [`full_name.ilike.%${safe}%`]
    if (digits.length >= 4) clauses.push(`phone_normalized.like.%${digits}%`)
    query = query.or(clauses.join(','))
  }

  const { data, error, count } = await query
    .order('full_name', { ascending: true })
    .range(from, to)

  if (error) throw fromPostgrestError(error)
  return paginate(data ?? [], count ?? 0, params)
}

export async function getContact(id: string): Promise<ContactRow> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', uuidSchema.parse(id))
    .is('archived_at', null)
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!data) throw notFound('contact')
  return data
}

export async function createContact(input: CreateContactInput): Promise<ContactRow> {
  const user = await requireUser()
  const data = parseOrThrow(createContactSchema, input)
  const supabase = await createSupabaseServerClient()

  const { data: row, error } = await supabase
    .from('contacts')
    .insert({
      full_name: data.fullName,
      account_id: data.accountId ?? null,
      linked_account_id: data.linkedAccountId ?? null,
      phone: data.phone,
      alt_phone: data.altPhone,
      email: data.email,
      role: data.role,
      influence: data.influence,
      preferred_channel: data.preferredChannel,
      is_referral_source: data.isReferralSource,
      notes: data.notes,
      owner_id: user.id,
      created_by: user.id,
    })
    .select('*')
    .single()

  if (error) throw fromPostgrestError(error)
  return row
}

export async function updateContact(id: string, input: UpdateContactInput): Promise<ContactRow> {
  await requireUser()
  const data = parseOrThrow(createContactSchema, input)
  const supabase = await createSupabaseServerClient()

  const { data: row, error } = await supabase
    .from('contacts')
    .update({
      full_name: data.fullName,
      account_id: data.accountId ?? null,
      linked_account_id: data.linkedAccountId ?? null,
      phone: data.phone,
      alt_phone: data.altPhone,
      email: data.email,
      role: data.role,
      influence: data.influence,
      preferred_channel: data.preferredChannel,
      is_referral_source: data.isReferralSource,
      notes: data.notes,
    })
    .eq('id', uuidSchema.parse(id))
    .is('archived_at', null)
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!row) throw notFound('contact')
  return row
}

/**
 * Find people to add to a project (§11.4) — by name or phone, within what the
 * caller may already see. Bounded; this backs a type-ahead, not a report.
 */
export async function searchContactsForStakeholder(term: string, limit = 10): Promise<ContactRow[]> {
  await requireUser()
  const trimmed = term.trim()
  if (trimmed.length < 2) return []

  const supabase = await createSupabaseServerClient()
  const safe = trimmed.replace(/[,()*]/g, ' ').trim()
  const digits = trimmed.replace(/\D/g, '')
  const clauses = [`full_name.ilike.%${safe}%`]
  if (digits.length >= 4) clauses.push(`phone_normalized.like.%${digits}%`)

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .is('archived_at', null)
    .or(clauses.join(','))
    .order('full_name')
    .limit(Math.min(limit, 25))

  if (error) throw fromPostgrestError(error)
  return data ?? []
}
