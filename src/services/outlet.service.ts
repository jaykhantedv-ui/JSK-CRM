import { z } from 'zod'

import { AppError, fromPostgrestError } from '@/lib/errors'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'
import { requireUser } from '@/services/auth.service'
import type { OutletRow } from '@/types/domain'

/**
 * Outlets and outlet scope (ADR-016).
 *
 * Outlets are DATA. Nothing here hard-codes an outlet name, and no role encodes
 * an outlet — a manager's scope is rows in `user_outlets`, which is why one
 * manager can hold several outlets and one outlet can have several managers.
 *
 * Authorization is the RLS policies on `outlets` and `user_outlets`; this service
 * validates and maps errors. Every function reads and writes through the caller's
 * own session, so a salesperson calling any of them gets nothing back.
 */

export const createOutletSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(16)
    .regex(/^[A-Za-z0-9_-]+$/, { error: 'Use letters, digits, hyphen or underscore.' })
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().max(120).optional().nullable(),
})

export type CreateOutletInput = z.input<typeof createOutletSchema>

/**
 * THE branch selector. One helper, every screen (ADR-040).
 *
 * Before this there was no such thing: `/reports`, the management filter bar and
 * three creation forms each filtered `listOutlets()` inline, and each of them got
 * it slightly differently — which is why several branch dropdowns came up empty
 * on the pilot deployment while others did not.
 *
 * Who may work in which branch:
 *
 *   OWNER · ADMIN   every ACTIVE branch, by role. Never enumerated as membership,
 *                   so a branch opened tomorrow appears tomorrow (ADR-016).
 *   MANAGER         the branches they hold, active ones only.
 *   SALESPERSON     their own posting.
 *
 * **A closed branch is never offered.** Chithode exists for the pilot and is
 * closed, so it appears in Settings → Organization → Branches — where it is
 * administered — and in no salesperson's selector.
 *
 * This is a convenience, not a control: `accounts_insert` and its siblings decide
 * what may actually be filed, and a hand-typed branch id gets nowhere (§15).
 */
export async function listAuthorizedOutlets(): Promise<OutletRow[]> {
  const user = await requireUser()
  const outlets = await listOutlets()

  if (user.role === 'OWNER' || user.role === 'ADMIN') return outlets
  return outlets.filter((outlet) => user.outletIds.includes(outlet.id))
}

/** Outlets, newest-inactive last. Every authenticated user may read the list. */
export async function listOutlets(options?: { includeInactive?: boolean }): Promise<OutletRow[]> {
  await requireUser()

  const supabase = await createSupabaseServerClient()
  let query = supabase.from('outlets').select('*').order('name')
  if (!options?.includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) throw fromPostgrestError(error)
  return data
}

export async function createOutlet(input: CreateOutletInput): Promise<OutletRow> {
  const actor = await requireUser()

  const parsed = createOutletSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'Check the highlighted fields.', {
      details: parsed.error.issues,
    })
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('outlets')
    .insert({ ...parsed.data, created_by: actor.id })
    .select()
    .single()

  if (error) throw fromPostgrestError(error)
  return data
}

/**
 * Close or reopen an outlet.
 *
 * Deactivating never touches the records that point at it: history over a closed
 * outlet still reports correctly, which is the whole reason outlets are rows
 * rather than a text column.
 */
export async function setOutletActive(outletId: string, isActive: boolean): Promise<OutletRow> {
  await requireUser()

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('outlets')
    .update({ is_active: isActive })
    .eq('id', uuidSchema.parse(outletId))
    .select()
    .single()

  if (error) throw fromPostgrestError(error)
  return data
}

/** The outlet ids currently in a user's scope. */
export async function listUserOutlets(userId: string): Promise<string[]> {
  await requireUser()

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('user_outlets')
    .select('outlet_id')
    .eq('user_id', uuidSchema.parse(userId))
    .is('revoked_at', null)

  if (error) throw fromPostgrestError(error)
  return data.map((row) => row.outlet_id)
}

/**
 * Replace a user's outlet scope.
 *
 * Moving someone between outlets sets `revoked_at` on what they leave and inserts
 * what they join. **Nothing is deleted** (§8.8): the row that says a person
 * managed an outlet last quarter is the only record of why they could see those
 * deals, and it stays.
 */
export async function setUserOutlets(userId: string, outletIds: string[]): Promise<void> {
  const actor = await requireUser()
  const id = uuidSchema.parse(userId)
  const wanted = new Set(z.array(uuidSchema).parse(outletIds))

  const supabase = await createSupabaseServerClient()

  const { data: current, error: readError } = await supabase
    .from('user_outlets')
    .select('id, outlet_id')
    .eq('user_id', id)
    .is('revoked_at', null)

  if (readError) throw fromPostgrestError(readError)

  const held = new Set(current.map((row) => row.outlet_id))
  const toRevoke = current.filter((row) => !wanted.has(row.outlet_id)).map((row) => row.id)
  const toAdd = [...wanted].filter((outletId) => !held.has(outletId))

  if (toRevoke.length > 0) {
    const { error } = await supabase
      .from('user_outlets')
      .update({ revoked_at: new Date().toISOString() })
      .in('id', toRevoke)
    if (error) throw fromPostgrestError(error)
  }

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from('user_outlets')
      .insert(toAdd.map((outlet_id) => ({ user_id: id, outlet_id, created_by: actor.id })))
    if (error) throw fromPostgrestError(error)
  }
}
