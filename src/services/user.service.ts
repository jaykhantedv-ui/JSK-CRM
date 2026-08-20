import { z } from 'zod'

import { AppError, forbidden, fromPostgrestError } from '@/lib/errors'
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
})

export const updateUserSchema = z.object({
  id: uuidSchema,
  fullName: fullNameSchema.optional(),
  role: roleSchema.optional(),
  phone: optionalPhoneSchema,
  isActive: z.boolean().optional(),
})

export type CreateUserInput = z.input<typeof createUserSchema>
export type UpdateUserInput = z.input<typeof updateUserSchema>

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
  const { fullName, email, password, role, phone, outletIds } = parsed.data

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
    .update({ full_name: fullName, role, phone })
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
  const { id, fullName, role, phone, isActive } = parsed.data

  if (id === actor.id && isActive === false) {
    throw new AppError('CONFLICT', 'You cannot deactivate your own account.')
  }
  if (id === actor.id && role !== undefined && role !== actor.role) {
    throw new AppError('CONFLICT', 'You cannot change your own role.')
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('users')
    .update({
      ...(fullName !== undefined ? { full_name: fullName } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(isActive !== undefined ? { is_active: isActive } : {}),
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
