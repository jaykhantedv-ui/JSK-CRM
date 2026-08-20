import type { Database } from '@/types/database.types'

/**
 * The stage transition matrix (§9.2).
 *
 * This constant map is the whole rule. `changeOpportunityStage()` validates
 * against it and rejects anything else with `INVALID_TRANSITION`. **No component
 * may decide whether a transition is legal** (CLAUDE.md §8).
 *
 * There is no `follow_up` stage and there must never be one: follow-up is an
 * action, not a pipeline position.
 */

export type Stage = Database['public']['Enums']['opportunity_stage']
export type Role = Database['public']['Enums']['user_role']

export const STAGES: readonly Stage[] = [
  'new',
  'qualified',
  'selection',
  'quoted',
  'negotiation',
  'verbal_confirmation',
  'won',
  'lost',
  'nurture',
] as const

/** Terminal stages. Won is final; a mistaken win is corrected, never silently edited. */
export const TERMINAL_STAGES: readonly Stage[] = ['won', 'lost'] as const

/** `nurture` is a holding stage and is excluded from Pipeline Value everywhere (§9.1). */
export const PIPELINE_STAGES: readonly Stage[] = STAGES.filter(
  (stage) => !TERMINAL_STAGES.includes(stage) && stage !== 'nurture',
)

/**
 * The order stages progress in. A move to an earlier position is "backward" and
 * requires a reason (§9.2); skipping forward is allowed, because real sales skip
 * stages.
 */
const FORWARD_ORDER: readonly Stage[] = [
  'new',
  'qualified',
  'selection',
  'quoted',
  'negotiation',
  'verbal_confirmation',
  'won',
] as const

export const TRANSITIONS: Readonly<Record<Stage, readonly Stage[]>> = {
  new: ['qualified', 'nurture', 'lost'],
  qualified: ['selection', 'quoted', 'nurture', 'lost', 'new'],
  selection: ['quoted', 'negotiation', 'nurture', 'lost', 'qualified'],
  quoted: ['negotiation', 'verbal_confirmation', 'nurture', 'lost', 'selection'],
  negotiation: ['verbal_confirmation', 'won', 'quoted', 'nurture', 'lost'],
  verbal_confirmation: ['won', 'negotiation', 'nurture', 'lost'],
  nurture: ['qualified', 'selection', 'quoted', 'lost'],
  // ADR-007: the single approved addition to §9.2's matrix. Reopen-only,
  // MANAGER/OWNER-only, reason required. The service clears `final_order_value`
  // and `closed_at`; the historical WON event is preserved, and `accounts.status`
  // is deliberately NOT changed — the account may hold other won opportunities.
  won: ['qualified'],
  lost: ['new', 'qualified'],
} as const

/** Transitions that only a MANAGER or OWNER may perform (§9.2, ADR-007). */
const ELEVATED_ONLY: ReadonlySet<string> = new Set([
  'won->qualified',
  'lost->new',
  'lost->qualified',
])

export type TransitionCheck =
  | { allowed: true; requiresReason: boolean; requiresElevatedRole: boolean }
  | { allowed: false; reason: 'INVALID_TRANSITION' | 'REASON_REQUIRED' | 'ROLE_REQUIRED' }

export function isValidTransition(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to)
}

/** A move to an earlier position in the pipeline, or any reopen from a terminal stage. */
export function isBackward(from: Stage, to: Stage): boolean {
  if (TERMINAL_STAGES.includes(from)) return true
  if (to === 'nurture') return false
  const fromIndex = FORWARD_ORDER.indexOf(from)
  const toIndex = FORWARD_ORDER.indexOf(to)
  if (fromIndex === -1 || toIndex === -1) return false
  return toIndex < fromIndex
}

export function requiresElevatedRole(from: Stage, to: Stage): boolean {
  return ELEVATED_ONLY.has(`${from}->${to}`)
}

export function canPerform(role: Role | null): boolean {
  return role === 'MANAGER' || role === 'OWNER'
}

/**
 * The single decision point for a stage change. Returns why a transition is
 * refused rather than a bare boolean, so the caller can say something useful.
 */
export function checkTransition(input: {
  from: Stage
  to: Stage
  role: Role | null
  reason?: string | null
}): TransitionCheck {
  const { from, to, role, reason } = input

  if (!isValidTransition(from, to)) return { allowed: false, reason: 'INVALID_TRANSITION' }

  const needsRole = requiresElevatedRole(from, to)
  if (needsRole && !canPerform(role)) return { allowed: false, reason: 'ROLE_REQUIRED' }

  const backward = isBackward(from, to)
  if (backward && !reason?.trim()) return { allowed: false, reason: 'REASON_REQUIRED' }

  return { allowed: true, requiresReason: backward, requiresElevatedRole: needsRole }
}

/** The stages a user in this role may move to from here — for rendering a picker. */
export function allowedTargets(from: Stage, role: Role | null): Stage[] {
  return TRANSITIONS[from].filter((to) => !requiresElevatedRole(from, to) || canPerform(role))
}
