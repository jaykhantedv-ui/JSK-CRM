import { z } from 'zod'

import { AppError, forbidden, fromPostgrestError } from '@/lib/errors'
import {
  assembleOrganization,
  buildReportingTree,
  type PersonRow,
  type ReportingNode,
} from '@/lib/organization'
import {
  MANAGER_ROLE_FOR,
  canAdministerOwner,
  canReportTo,
  roleLabel,
  type Role,
} from '@/lib/permissions'
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

// The shapes the organisation screens render. The assembly itself is pure and
// lives in `lib/organization.ts`; this service is the part that talks to the
// database (CLAUDE.md §8).
export type { PersonRow, ReportingNode }

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

/**
 * Only an OWNER may create, alter or deactivate an OWNER (ADR-042).
 *
 * `guard_owner_role()` in migration 032 is the control for anything written
 * through the caller's own session. **This is the control for `createUser`**,
 * which writes the role with the SERVICE-ROLE client — `auth.uid()` is null
 * there, so the trigger exempts it by design (§15.7). Reversing that order, or
 * omitting this, is how an administrator mints themselves an owner.
 */
async function assertMayAdministerOwner(actor: SessionUser, targetRole?: Role): Promise<void> {
  if (targetRole !== 'OWNER') return
  if (!canAdministerOwner(actor)) {
    throw forbidden('Only the owner can make somebody an owner.')
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
  await assertMayAdministerOwner(actor, role)
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

  const supabase = await createSupabaseServerClient()

  // Read the stored row first. Through the caller's own session, so RLS decides
  // whether they may see this person at all, and so every check below compares
  // against what IS rather than against what was submitted.
  const { data: existing, error: readError } = await supabase
    .from('users')
    .select('role, manager_id')
    .eq('id', id)
    .maybeSingle()
  if (readError) throw fromPostgrestError(readError)
  if (!existing) throw new AppError('NOT_FOUND', 'That person is not on the team.')

  // Promoting somebody to owner, or touching the one who is. The database
  // refuses both for a non-owner (032); saying so here gives a sentence rather
  // than a silent zero-row update.
  await assertMayAdministerOwner(actor, role)
  if (existing.role === 'OWNER' && !canAdministerOwner(actor)) {
    throw forbidden("Only the owner can change the owner's account.")
  }

  // The self-edit guards, COMPARED AGAINST THE STORED VALUE. An edit form posts
  // every field it renders, so an owner correcting their own name resubmits
  // their own role and their own (empty) reporting line — which is not an
  // attempt to change either, and refusing it made the owner the one person who
  // could not be edited.
  if (id === actor.id) {
    if (isActive === false) {
      throw new AppError('CONFLICT', 'You cannot deactivate your own account.')
    }
    if (role !== undefined && role !== existing.role) {
      throw new AppError('CONFLICT', 'You cannot change your own role.')
    }
    if (managerId !== undefined && (managerId ?? null) !== existing.manager_id) {
      throw new AppError('CONFLICT', 'You cannot change who you report to.')
    }
  }

  // Validate the line against the role the person will HAVE, not the one they
  // have now: changing both at once is the ordinary case when someone is
  // promoted to sales head.
  if (role !== undefined || managerId !== undefined) {
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
 * THE organisation loader (ADR-040, ADR-041). One helper, every screen that
 * needs the reporting line.
 *
 * **Three plain queries, no PostgREST embedding.** The previous version asked
 * PostgREST to embed `users` into itself —
 * `manager:users!users_manager_id_fkey(...)` — and on the office server's
 * PostgREST 12.2.12 that relationship is not exposed, so both organisation
 * screens answered:
 *
 *     PGRST200 — Could not find a relationship between 'users' and 'users'
 *
 * The foreign key genuinely exists and reloading the schema cache did not help.
 * Rather than depend on a resource-embedding feature that a supported PostgREST
 * declines to offer, the join is done here, in memory, over three sets that
 * are each bounded by row-level security:
 *
 *   users         `users_select`        — everyone the caller may read
 *   user_outlets  `user_outlets_select` — their branch assignments
 *   outlets       `outlets_select`      — branch names, readable by all
 *
 * **Nothing is widened.** No service-role client, no `SECURITY DEFINER` helper,
 * no second query for a manager the caller cannot see. The set is exactly what
 * one `select * from public.users` returns for that caller and no more, which is
 * the same set the embedded version was filtered down to.
 */
export async function loadOrganization(): Promise<PersonRow[]> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('*')
    .order('full_name')

  if (usersError) throw fromPostgrestError(usersError)
  if (users.length === 0) return []

  const ids = users.map((user) => user.id)

  // Scoped twice over, and deliberately: `user_outlets_select` bounds it, and
  // the `in` narrows it to the people already on screen so the two sets cannot
  // disagree about who exists.
  const { data: links, error: linksError } = await supabase
    .from('user_outlets')
    .select('user_id, outlet_id, revoked_at')
    .in('user_id', ids)
    .is('revoked_at', null)

  if (linksError) throw fromPostgrestError(linksError)

  const { data: branches, error: branchesError } = await supabase
    .from('outlets')
    .select('id, name')

  if (branchesError) throw fromPostgrestError(branchesError)

  return assembleOrganization(users, links ?? [], branches ?? [])
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

export async function getReportingStructure(): Promise<ReportingNode[]> {
  return buildReportingTree(await loadOrganization())
}


