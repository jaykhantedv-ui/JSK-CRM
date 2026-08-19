import { addDays, businessToday, daysBetween } from '@/lib/dates'
import type { Database } from '@/types/database.types'

/**
 * Next actions and follow-up state (§8.3, §10.3, §13.1).
 *
 * **This is the most important feature in the product.** The stated business
 * problem is salespeople forgetting follow-ups, so the question this module
 * answers — *what do I need to do today?* — is the one the application exists to
 * answer.
 *
 * Every state here is DERIVED, never stored (§5.7). The database defines the same
 * states in `v_opportunity_flags`; this is the TypeScript half, used for
 * rendering and for grouping a list the query already scoped. The two must agree,
 * and both compute the business day in Asia/Kolkata rather than in the session
 * timezone — between 18:30 and midnight IST a naive `current_date` still reads as
 * yesterday and the overdue list is silently wrong every evening (CLAUDE.md §10).
 */

export type NextActionType = Database['public']['Enums']['next_action_type']

/**
 * Where a next action sits relative to today.
 *
 * `MISSING` is a first-class state, not an absence: an active opportunity with no
 * next action is the exception the whole accountability model is built around
 * (§8.3). It is never hidden and never silently defaulted to a date.
 */
export type NextActionState = 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING' | 'LATER' | 'MISSING' | 'CLOSED'

/** The seven-day horizon of §13.1's "Upcoming" metric. */
export const UPCOMING_WINDOW_DAYS = 7

export function nextActionState(input: {
  nextActionDate: string | null
  stage: string
  now?: Date | string
}): NextActionState {
  const { nextActionDate, stage } = input
  if (stage === 'won' || stage === 'lost') return 'CLOSED'
  if (!nextActionDate) return 'MISSING'

  const today = businessToday(input.now ?? new Date())
  const days = daysBetween(today, nextActionDate)

  if (days < 0) return 'OVERDUE'
  if (days === 0) return 'DUE_TODAY'
  if (days <= UPCOMING_WINDOW_DAYS) return 'UPCOMING'
  return 'LATER'
}

/**
 * The chip label. §8.11 asks for relative recency — a salesperson reads "Overdue
 * by 4 days" instantly and has to work out what "18 Aug 2026" means.
 */
export function nextActionLabel(input: {
  nextActionDate: string | null
  stage: string
  now?: Date | string
}): string {
  const state = nextActionState(input)
  if (state === 'CLOSED') return 'Closed'
  if (state === 'MISSING') return 'Set next action'

  const today = businessToday(input.now ?? new Date())
  const days = daysBetween(today, input.nextActionDate as string)

  if (days < 0) return days === -1 ? 'Overdue by 1 day' : `Overdue by ${Math.abs(days)} days`
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days <= UPCOMING_WINDOW_DAYS) return `In ${days} days`
  return `In ${days} days`
}

/**
 * Severity for the chip, so colour is chosen in one place.
 *
 * §12.1: **never colour alone.** Every caller pairs this with the label above or
 * an icon; the tone is the second signal, not the only one.
 */
export function nextActionTone(state: NextActionState): 'overdue' | 'at-risk' | 'active' | 'muted' {
  switch (state) {
    case 'OVERDUE':
      return 'overdue'
    case 'MISSING':
      return 'at-risk'
    case 'DUE_TODAY':
    case 'UPCOMING':
      return 'active'
    case 'LATER':
    case 'CLOSED':
      return 'muted'
  }
}

/**
 * The quick-date buttons of §11.5 — "Tomorrow / 3 days / 1 week / Pick date /
 * Can't say yet". These four are the offsets; the picker and the
 * cannot-determine choice are UI affordances rather than dates.
 *
 * They exist because typing a date on a phone is the slowest part of logging an
 * activity, and slow is what loses to a notebook (§1.4).
 */
export const QUICK_DATE_OFFSETS = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
] as const

export function quickDates(now: Date | string = new Date()): { label: string; date: string }[] {
  const today = businessToday(now)
  return QUICK_DATE_OFFSETS.map((option) => ({
    label: option.label,
    date: addDays(today, option.days),
  }))
}

/**
 * §11.1 — a next action date may not be in the past. Today is allowed: "call them
 * back this afternoon" is a real and common answer.
 */
export function isNextActionDateAcceptable(date: string, now: Date | string = new Date()): boolean {
  return date >= businessToday(now)
}

/** Human labels for the enum. The UI never renders a raw enum value. */
export const NEXT_ACTION_LABELS: Record<NextActionType, string> = {
  CALL: 'Call',
  SHOWROOM_VISIT: 'Showroom visit',
  SITE_VISIT: 'Site visit',
  SEND_QUOTATION: 'Send quotation',
  SHARE_SAMPLES: 'Share samples',
  QUOTATION_FOLLOWUP: 'Quotation follow-up',
  PRICE_DISCUSSION: 'Price discussion',
  AWAIT_CUSTOMER: 'Waiting on customer',
  OTHER: 'Other',
}

/**
 * Group a scoped list into the four buckets `/today` shows, in the order §13.2
 * lists them. The query has already limited the rows to the ones this user may
 * see; this only decides which heading each falls under.
 */
export function bucketByNextAction<T extends { next_action_date: string | null; stage: string }>(
  rows: readonly T[],
  now: Date | string = new Date(),
): { overdue: T[]; dueToday: T[]; upcoming: T[]; missing: T[] } {
  const buckets = { overdue: [] as T[], dueToday: [] as T[], upcoming: [] as T[], missing: [] as T[] }

  for (const row of rows) {
    switch (nextActionState({ nextActionDate: row.next_action_date, stage: row.stage, now })) {
      case 'OVERDUE':
        buckets.overdue.push(row)
        break
      case 'DUE_TODAY':
        buckets.dueToday.push(row)
        break
      case 'UPCOMING':
        buckets.upcoming.push(row)
        break
      case 'MISSING':
        buckets.missing.push(row)
        break
      default:
        break
    }
  }

  // Oldest first in the overdue list (§13.2): the one that has been waiting
  // longest is the one to call first.
  buckets.overdue.sort((a, b) => (a.next_action_date ?? '').localeCompare(b.next_action_date ?? ''))
  buckets.dueToday.sort((a, b) => (a.next_action_date ?? '').localeCompare(b.next_action_date ?? ''))
  buckets.upcoming.sort((a, b) => (a.next_action_date ?? '').localeCompare(b.next_action_date ?? ''))

  return buckets
}
