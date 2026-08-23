import { cache } from 'react'

import { AppError } from '@/lib/errors'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { SessionUser } from '@/types/domain'

/**
 * Session and identity (§3.2, §15.8).
 *
 * Sessions live in httpOnly cookies handled by `@supabase/ssr`. Passwords are
 * Supabase Auth's problem — no custom crypto, ever (§17.1).
 *
 * **There is no self-registration.** Users are created by OWNER or ADMIN through
 * `user.service.ts` (ADR-009), and sign-up is disabled in `config.toml` for every
 * environment. Nothing here creates a user.
 */

/**
 * The signed-in user with their role and outlet scope, or null.
 *
 * Returns null for a deactivated user even when their JWT is still valid: §3.2
 * says deactivation blocks login, and a token issued minutes earlier stays valid
 * for up to an hour, so the check has to happen on read. The database agrees —
 * `public.current_user_id()` filters on `is_active` too, so a deactivated user
 * with a live token can see nothing regardless of what this returns.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()
  if (!authUser) return null

  const { data, error } = await supabase
    .from('users')
    // The FK hint is required, not cosmetic: `user_outlets` references `users`
    // twice — once as the member, once as `created_by` — so an unhinted embed is
    // ambiguous and PostgREST refuses it.
    .select('id, email, full_name, role, is_active, manager_id, user_outlets!user_outlets_user_id_fkey(outlet_id, revoked_at)')
    .eq('id', authUser.id)
    .maybeSingle()

  if (error || !data || !data.is_active) return null

  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    role: data.role,
    isActive: data.is_active,
    outletIds: (data.user_outlets ?? [])
      .filter((row) => row.revoked_at === null)
      .map((row) => row.outlet_id),
    managerId: data.manager_id,
  }
})

/** The signed-in user, or a `FORBIDDEN` error. The first line of every service. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new AppError('FORBIDDEN', 'Sign in to continue.')
  return user
}

/**
 * ROUTE AUTHORIZATION (ADR-040). The second of three controls.
 *
 * Hiding a navigation item is not a control and never was: `/reports` was
 * reachable by typing it, and rendered — an index of eleven links, each of which
 * then returned nothing, which reads as a broken screen rather than a refusal.
 * These are what a gated page calls first, so the answer is a refusal.
 *
 * The controls, in order of strength:
 *
 *   1. row-level security  what a query returns. Holds against a direct
 *                          PostgREST call with the caller's own JWT (§15).
 *   2. these               whether the route renders at all.
 *   3. navigation          what is worth offering.
 *
 * Remove 2 and 3 and the data is still safe. Remove 1 and nothing else matters.
 */
export async function requireRole(...roles: SessionUser['role'][]): Promise<SessionUser> {
  const user = await requireUser()
  if (!roles.includes(user.role)) {
    throw new AppError('FORBIDDEN', 'This screen is not part of your role.')
  }
  return user
}

/**
 * The management surfaces: dashboard, team and every report.
 *
 * Mirrors `assert_management_access()`, which is the control — a salesperson
 * calling one of those RPCs directly is refused by the database whatever this
 * does.
 */
export async function requireManagementAccess(): Promise<SessionUser> {
  return requireRole('MANAGER', 'OWNER', 'ADMIN')
}

/** Organisation and configuration: branches, people, settings, import. */
export async function requireOwnerOrAdmin(): Promise<SessionUser> {
  return requireRole('OWNER', 'ADMIN')
}

/** Sign in with email and password. Rate limiting is Supabase Auth's own (C-5). */
export async function signIn(email: string, password: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Deliberately identical for a wrong password, an unknown email and a
    // deactivated account: distinguishing them tells an attacker which emails
    // are real (§25).
    throw new AppError('FORBIDDEN', 'Those details did not match an active account.')
  }

  // A deactivated user can still hold valid credentials — Supabase Auth does not
  // know about `public.users.is_active`. Sign them straight back out so no
  // session cookie survives the attempt.
  const user = await getCurrentUser()
  if (!user) {
    await supabase.auth.signOut()
    throw new AppError('FORBIDDEN', 'Those details did not match an active account.')
  }
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
}
