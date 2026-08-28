import { z } from 'zod'

import { AppError, forbidden, fromPostgrestError } from '@/lib/errors'
import { targetProgress, type TargetProgress } from '@/lib/metrics'
import { isOwner } from '@/lib/permissions'
import { monthsInPeriod, type Period } from '@/lib/period'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'
import { requireManagementAccess, requireUser } from '@/services/auth.service'
import type { SessionUser } from '@/types/domain'

/**
 * Sales targets (Master Phase 3 §10, ADR-021).
 *
 * A target is a **management planning figure, not an accounting record** (§2.2).
 * Nothing in the CRM depends on one existing: every metric computes with or
 * without a target, and a screen with no target set shows an em dash rather than
 * inventing a denominator.
 *
 * Three scopes, one table (ADR-021):
 *   company  `outlet_id is null` — the OWNER's figure for the whole business
 *   outlet   `outlet_id` set     — a branch's figure
 *   person   `outlet_id` + `user_id` — a salesperson's figure at that branch
 *
 * Authorization is the RLS policies on `sales_targets`, which read scope straight
 * off `outlet_id`. The checks in this file fail early with a readable message;
 * they are not the control (CLAUDE.md §6).
 */

const monthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/, { error: 'A target month is the first of a month.' })

export const setTargetSchema = z.object({
  periodMonth: monthSchema,
  outletId: uuidSchema.nullable().default(null),
  userId: uuidSchema.nullable().default(null),
  targetPaise: z
    .number()
    .int({ error: 'A target is a whole number of paise.' })
    .nonnegative({ error: 'A target cannot be negative.' })
    // ₹100 crore in paise. Not a business rule — a typo guard, so a stray zero
    // does not silently produce a target nobody can ever meet.
    .max(100_000_000_000, { error: 'That target looks like a typing error.' }),
  note: z.string().trim().max(280).optional().nullable(),
})

export type SetTargetInput = z.input<typeof setTargetSchema>

export type SalesTarget = {
  id: string
  periodMonth: string
  outletId: string | null
  userId: string | null
  targetPaise: number
  note: string | null
}

function toTarget(row: {
  id: string
  period_month: string
  outlet_id: string | null
  user_id: string | null
  target_paise: number | string
  note: string | null
}): SalesTarget {
  return {
    id: row.id,
    periodMonth: row.period_month,
    outletId: row.outlet_id,
    userId: row.user_id,
    targetPaise: typeof row.target_paise === 'number' ? row.target_paise : Number(row.target_paise),
    note: row.note,
  }
}

/**
 * The management surfaces — dashboard, team, reports, targets, export.
 *
 * **One helper, four services (ADR-042).** Each of these files used to write its
 * own `isManagerOrAbove()` check, and when ADR-040 admitted ADMIN to management
 * reporting the routes and the database were widened and these four were not.
 * The result was the worst possible shape: the route said yes, the service threw,
 * and an administrator got a Server Components error on Dashboard, Team, Reports
 * and every report beneath them.
 *
 * `requireManagementAccess()` mirrors `assert_management_access()` in the
 * database, which is the control.
 */
async function assertManagement(): Promise<SessionUser> {
  return requireManagementAccess()
}

/**
 * Targets covering a reporting period.
 *
 * A period spanning several months returns several rows, and the caller sums
 * them — comparing a quarter's Won Value against one month's target would report
 * a shortfall that does not exist.
 */
export async function listTargets(
  period: Period,
  filters: { outletId?: string | null; userId?: string | null } = {},
): Promise<SalesTarget[]> {
  await assertManagement()
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('sales_targets')
    .select('id, period_month, outlet_id, user_id, target_paise, note')
    .in('period_month', monthsInPeriod(period))

  if (filters.outletId !== undefined) {
    query = filters.outletId === null ? query.is('outlet_id', null) : query.eq('outlet_id', filters.outletId)
  }
  if (filters.userId !== undefined) {
    query = filters.userId === null ? query.is('user_id', null) : query.eq('user_id', filters.userId)
  }

  const { data, error } = await query.order('period_month')
  if (error) throw fromPostgrestError(error)
  return (data ?? []).map(toTarget)
}

/**
 * The caller's OWN targets — the only ones a salesperson may read (ADR-040).
 *
 * `listTargets` above is gated to management because a branch target and the
 * company figure are management planning data (ADR-021), and that has not
 * changed. What ADR-040 changed is the one row set FOR this person: they are
 * measured against it, so they can see it. `sales_targets_select` is what
 * actually decides, and it grants exactly `user_id = current_user_id()`.
 */
export async function listMyTargets(period: Period): Promise<SalesTarget[]> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('sales_targets')
    .select('id, period_month, outlet_id, user_id, target_paise, note')
    .eq('user_id', user.id)
    .in('period_month', monthsInPeriod(period))
    .order('period_month')

  if (error) throw fromPostgrestError(error)
  return (data ?? []).map(toTarget)
}

/**
 * Every target for a month, whatever its scope — the maintenance screen's list.
 *
 * RLS decides what comes back: a manager sees their branches' targets and their
 * people's, and never the company figure.
 */
export async function listTargetsForMonth(periodMonth: string): Promise<SalesTarget[]> {
  await assertManagement()
  const month = monthSchema.parse(periodMonth)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('sales_targets')
    .select('id, period_month, outlet_id, user_id, target_paise, note')
    .eq('period_month', month)

  if (error) throw fromPostgrestError(error)
  return (data ?? []).map(toTarget)
}

/**
 * Sum the targets that apply to one scope over a period.
 *
 * Returns `null` — not zero — when no target row exists. "No target" and "a
 * target of zero" are different facts and must not render alike (§13.1, and the
 * `targetProgress` tests).
 */
export function sumTargets(targets: readonly SalesTarget[]): number | null {
  if (targets.length === 0) return null
  return targets.reduce((sum, target) => sum + target.targetPaise, 0)
}

/**
 * Progress against target for a scope, ready for a tile.
 *
 * `outletId: null` with `userId: null` asks for the company figure, which only an
 * OWNER can read; a manager gets no rows and therefore an unmeasurable result,
 * which is the honest answer rather than an error.
 */
export async function getTargetProgress(
  period: Period,
  achievedPaise: number,
  filters: { outletId?: string | null; userId?: string | null } = {},
): Promise<TargetProgress> {
  const targets = await listTargets(period, filters)
  return targetProgress(achievedPaise, sumTargets(targets))
}

/**
 * Create or update one target.
 *
 * An upsert on the scope's unique index rather than a read-then-write: two
 * managers editing the same branch's target in the same minute must not produce
 * two rows, and the partial unique indexes in migration 021 are what guarantee
 * they cannot.
 */
export async function setTarget(input: SetTargetInput): Promise<SalesTarget> {
  const actor = await assertManagement()

  const parsed = setTargetSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'Check the highlighted fields.', {
      field: parsed.error.issues[0]?.path.join('.'),
      details: parsed.error.issues,
    })
  }
  const { periodMonth, outletId, userId, targetPaise, note } = parsed.data

  // Mirrors `target_user_requires_outlet` so the caller gets a sentence rather
  // than a constraint name. The constraint is still the backstop (CLAUDE.md §5).
  if (userId && !outletId) {
    throw new AppError('VALIDATION_FAILED', 'Choose the branch this person is being targeted at.', {
      field: 'outletId',
    })
  }

  // The company figure is the owner's. A manager setting one would be setting a
  // number for branches they do not manage; the RLS policy refuses it too, and
  // this is the readable half of the same rule.
  if (!outletId && !isOwner(actor)) {
    throw forbidden('Only the owner sets the company target.')
  }

  const supabase = await createSupabaseServerClient()

  // `onConflict` names the partial unique index for the scope being written.
  const conflictTarget = userId
    ? 'sales_targets_user_month'
    : outletId
      ? 'sales_targets_outlet_month'
      : 'sales_targets_company_month'

  const { data, error } = await supabase
    .from('sales_targets')
    .upsert(
      {
        period_month: periodMonth,
        outlet_id: outletId,
        user_id: userId,
        target_paise: targetPaise,
        note: note ?? null,
        created_by: actor.id,
        updated_by: actor.id,
      },
      { onConflict: conflictTarget },
    )
    .select('id, period_month, outlet_id, user_id, target_paise, note')
    .single()

  if (error) throw fromPostgrestError(error)
  return toTarget(data)
}
