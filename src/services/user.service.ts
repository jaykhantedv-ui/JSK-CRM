import { z } from 'zod'

import { AppError, forbidden, fromPostgrestError } from '@/lib/errors'
import { MANAGER_ROLE_FOR, canReportTo, roleLabel, type Role } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { emailSchema, fullNameSchema, optionalPhoneSchema, roleSchema, uuidSchema } from '@/lib/validation'
import { requireUser } from '@/services/auth.service'
import type { SessionUser, UserRow } from '@/types/domain'

/**
 * User provisioning and administration (§3.2, ADR-009).
 *
 * **There is no self-registration.** Creating a Supabase Auth user server-side
 * needs `auth.admin.createUser()`, which needs the service-role key, and §15.7
 * otherwise restricts that key to cron routes and the import executor. ADR-009
 * makes this file the third permitted caller — **on one condition**:
 *
 *   THE OWNER/ADMIN CHECK RUNS BEFORE THE ADMIN CLIENT IS TOUCHED.
 *
 * Reversing that order is a privilege-escalation hole, which is why
 * `assertCanManageUsers()` is the first statement of every function here and why
 * a salesperson calling `createUser` is rejected before any admin call is made.
 */

export const createUserSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: z.string().min(8, { error: 'Use at least eight characters.' }).max(72),
  role: roleSchema,
  phone: optionalPhoneSchema,
  outletIds: z.array(uuidSchema).default([]),
  /**
   * Who they report to (ADR-040). Optional at this boundary because the OWNER has
   * nobody to report to; `assertReportingLine` below decides when it is required,
   * and `guard_user_hierarchy()` in the database decides for certain.
   */
  managerId: uuidSchema.nullish(),
})

export const updateUserSchema = z.object({
  id: uuidSchema,
  fullName: fullNameSchema.optional(),
  role: roleSchema.optional(),
  phone: optionalPhoneSchema,
  isActive: z.boolean().optional(),
  managerId: uuidSchema.nullish(),
})

export type CreateUserInput = z.input<typeof createUserSchema>
export type UpdateUserInput = z.input<typeof updateUserSchema>

/**
 * A person as the organisation screens list them: their line, their branches and
 * whether they are still with the business.
 */
export type PersonRow = UserRow & {
  managerName: string | null
  managerRole: Role | null
  outletIds: string[]
  outletNames: string[]
}

/**
 * Is this a reporting line the business allows (ADR-040)?
 *
 * The database refuses an illegal one outright — `guard_user_hierarchy()` is the
 * control — so this exists to say WHY in words a person can act on, before the
 * form is submitted. Same rule, stated once in `lib/permissions.ts` and read from
 * there by both.
 */
async function assertReportingLine(
  role: Role,
  managerId: string | null | undefined,
): Promise<void> {
  const required = MANAGER_ROLE_FOR[role]

  if (required === null) {
    if (managerId) {
      throw new AppError('VALIDATION_FAILED', 'The owner reports to nobody.', { field: 'managerId' })
    }
    return
  }

  if (!managerId) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Choose who this ${roleLabel(role).toLowerCase()} reports to.`,
      { field: 'managerId' },
    )
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('users')
    .select('id, role, is_active')
    .eq('id', managerId)
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!data) {
    throw new AppError('VALIDATION_FAILED', 'That person is not on the team.', { field: 'managerId' })
  }
  if (!canReportTo(role, data.role)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `A ${roleLabel(role).toLowerCase()} reports to ${
        required === 'MANAGER' ? 'a sales head' : required === 'ADMIN' ? 'an administrator' : 'the owner'
      }.`,
      { field: 'managerId' },
    )
  }
  if (!data.is_active) {
    throw new AppError('VALIDATION_FAILED', 'That person is deactivated.', { field: 'managerId' })
  }
}

/** OWNER and ADMIN manage users (§3.1). Nobody else, in any circumstance. */
async function assertCanManageUsers(): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
    throw forbidden('Only an owner or an administrator can manage users.')
  }
  return user
}

/**
 * Create a user and their auth account.
 *
 * `handle_new_auth_user()` mirrors the new `auth.users` row into `public.users`
 * as an active SALESPERSON; the role and outlet scope are applied here,
 * afterwards, server-side. The trigger deliberately ignores any role in the
 * sign-up metadata so user creation can never become a role-escalation path.
 */
export async function createUser(input: CreateUserInput): Promise<UserRow> {
  // FIRST. Before the admin client exists (ADR-009).
  const actor = await assertCanManageUsers()

  const parsed = createUserSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'Check the highlighted fields.', {
      details: parsed.error.issues,
    })
  }
  const { fullName, email, password, role, phone, outletIds, managerId } = parsed.data

  // Before the admin client is touched, and before an Auth account exists: a
  // rejected line after `createUser` would leave an account to clean up.
  await assertReportingLine(role, managerId)

  const admin = createAdminClient()

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (authError || !created.user) {
    if (authError?.message?.toLowerCase().includes('already')) {
      throw new AppError('CONFLICT', 'A user with this email already exists.', { field: 'email' })
    }
    throw new AppError('INTERNAL', 'Could not create the sign-in account.', { details: authError })
  }

  const { data: user, error: userError } = await admin
    .from('users')
    .update({ full_name: fullName, role, phone, manager_id: managerId ?? null })
    .eq('id', created.user.id)
    .select()
    .single()

  if (userError) {
    // The auth account exists but the profile did not take. Remove it rather than
    // leaving an account that can sign in and resolve to nothing.
    await admin.auth.admin.deleteUser(created.user.id)
    throw fromPostgrestError(userError)
  }

  if (outletIds.length > 0) {
    const { error: scopeError } = await admin.from('user_outlets').insert(
      outletIds.map((outlet_id) => ({ user_id: created.user!.id, outlet_id, created_by: actor.id })),
    )
    if (scopeError) throw fromPostgrestError(scopeError)
  }

  return user
}

/**
 * Update a user's name, role, phone or active flag.
 *
 * Runs through the caller's own session, so the RLS policies on `public.users`
 * apply: this cannot become a back door around them. Deactivation takes effect
 * immediately at the database boundary, because every policy resolves ownership
 * through `public.current_user_id()`, which filters on `is_active`.
 */
export async function updateUser(input: UpdateUserInput): Promise<UserRow> {
  const actor = await assertCanManageUsers()

  const parsed = updateUserSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'Check the highlighted fields.', {
      details: parsed.error.issues,
    })
  }
  const { id, fullName, role, phone, isActive, managerId } = parsed.data

  if (id === actor.id && isActive === false) {
    throw new AppError('CONFLICT', 'You cannot deactivate your own account.')
  }
  if (id === actor.id && role !== undefined && role !== actor.role) {
    throw new AppError('CONFLICT', 'You cannot change your own role.')
  }
  if (id === actor.id && managerId !== undefined) {
    throw new AppError('CONFLICT', 'You cannot change who you report to.')
  }

  const supabase = await createSupabaseServerClient()

  // Validate the line against the role the person will HAVE, not the one they
  // have now: changing both at once is the ordinary case when someone is
  // promoted to sales head.
  if (role !== undefined || managerId !== undefined) {
    const { data: existing, error: readError } = await supabase
      .from('users')
      .select('role, manager_id')
      .eq('id', id)
      .maybeSingle()
    if (readError) throw fromPostgrestError(readError)
    if (!existing) throw new AppError('NOT_FOUND', 'That person is not on the team.')

    await assertReportingLine(
      role ?? existing.role,
      managerId === undefined ? existing.manager_id : managerId,
    )
  }
  const { data, error } = await supabase
    .from('users')
    .update({
      ...(fullName !== undefined ? { full_name: fullName } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(isActive !== undefined ? { is_active: isActive } : {}),
      ...(managerId !== undefined ? { manager_id: managerId ?? null } : {}),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw fromPostgrestError(error)
  return data
}

/** Users the caller can see. RLS decides the set, not this query. */
export async function listUsers(): Promise<UserRow[]> {
  await requireUser()

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('users')
    .select('*')
    // The system actor (ADR-003) is never a person and never appears in a list.
    .eq('is_active', true)
    .order('full_name')

  if (error) throw fromPostgrestError(error)
  return data
}

/**
 * Everyone the caller may see, with their line and branches resolved (ADR-040).
 *
 * The set is decided by `users_select`, not here: an OWNER or ADMIN gets the
 * whole organisation, a sales head gets their own team, and a salesperson gets
 * themselves and the sales head whose name appears on their records.
 */
export async function listPeople(): Promise<PersonRow[]> {
  await requireUser()

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('users')
    // Two FK hints, both required rather than cosmetic: `users` references itself
    // through `manager_id`, and `user_outlets` references `users` twice — once as
    // the member and once as `created_by` — so an unhinted embed is ambiguous and
    // PostgREST refuses it. Written as ONE string literal because the generated
    // types resolve the shape from it at compile time.
    .select(
      '*, manager:users!users_manager_id_fkey(id, full_name, role), user_outlets!user_outlets_user_id_fkey(outlet_id, revoked_at, outlets(id, name))',
    )
    .order('full_name')

  if (error) throw fromPostgrestError(error)

  return data.map((row) => {
    const held = (row.user_outlets ?? []).filter((link) => link.revoked_at === null)
    const { manager, user_outlets: _links, ...user } = row
    // A self-referencing embed comes back as an array from the generated types —
    // PostgREST cannot tell a to-one from a to-many on the same table — and there
    // is at most one manager.
    const boss = Array.isArray(manager) ? manager[0] : manager
    return {
      ...(user as UserRow),
      managerName: boss?.full_name ?? null,
      managerRole: (boss?.role as Role | undefined) ?? null,
      outletIds: held.map((link) => link.outlet_id),
      outletNames: held.map((link) => link.outlets?.name).filter((name): name is string => !!name),
    }
  })
}

/**
 * The people a person of this role may be given as a manager.
 *
 * Derived from `MANAGER_ROLE_FOR`, so the dropdown cannot offer a choice
 * `guard_user_hierarchy()` will refuse — a salesperson is only ever offered sales
 * heads, and a sales head only ever administrators.
 */
export async function listEligibleManagers(role: Role): Promise<UserRow[]> {
  await requireUser()

  const required = MANAGER_ROLE_FOR[role]
  if (required === null) return []

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('role', required)
    .eq('is_active', true)
    .order('full_name')

  if (error) throw fromPostgrestError(error)
  return data
}

/** A sales head and the people who report to them, for the structure screen. */
export type ReportingNode = {
  person: Pick<UserRow, 'id' | 'full_name' | 'email' | 'role' | 'is_active'>
  reports: ReportingNode[]
}

/**
 * The organisation as a tree, built from the flat list.
 *
 * Roots are the people whose manager is not in the visible set — the OWNER for an
 * administrator, and the sales head themselves for a sales head — so the tree is
 * always well-formed for whoever is looking at it.
 */
export async function getReportingStructure(): Promise<ReportingNode[]> {
  const people = await listPeople()

  const nodes = new Map<string, ReportingNode>(
    people.map((person) => [
      person.id,
      {
        person: {
          id: person.id,
          full_name: person.full_name,
          email: person.email,
          role: person.role,
          is_active: person.is_active,
        },
        reports: [],
      },
    ]),
  )

  const roots: ReportingNode[] = []
  for (const person of people) {
    const node = nodes.get(person.id)!
    const parent = person.manager_id ? nodes.get(person.manager_id) : undefined
    if (parent) parent.reports.push(node)
    else roots.push(node)
  }
  return roots
}
