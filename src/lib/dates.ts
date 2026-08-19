/**
 * Dates and times (§8.11, §17.3, CLAUDE.md §10).
 *
 * **Stored UTC as `timestamptz`. Displayed Asia/Kolkata. Always.**
 *
 * The business day is Asia/Kolkata, not the server's timezone and not the
 * database session's. On Supabase the session is UTC, so between 18:30 and 24:00
 * IST a bare `current_date` still reads as yesterday — the overdue list would be
 * wrong every single evening (SPEC_AUDIT B-10). SQL handles this with
 * `(now() at time zone 'Asia/Kolkata')::date`; this module is the TypeScript half
 * of the same rule.
 *
 * Rendering uses `Intl.DateTimeFormat`, not `date-fns-tz` (M-13). The platform
 * already knows the IANA zone; a dependency to restate it earns nothing.
 */

export const BUSINESS_TIME_ZONE = 'Asia/Kolkata'

const ISO_DATE_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const DISPLAY_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const DISPLAY_DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new TypeError(`Not a date: ${String(value)}`)
  return date
}

/**
 * The calendar date in Asia/Kolkata, as `yyyy-MM-dd`.
 *
 * This is the TypeScript equivalent of `(ts at time zone 'Asia/Kolkata')::date`
 * and the only correct way to ask "which business day is this instant on?".
 */
export function businessDate(value: Date | string = new Date()): string {
  return ISO_DATE_PARTS.format(toDate(value))
}

/** Today's business day in Asia/Kolkata, as `yyyy-MM-dd`. */
export function businessToday(now: Date | string = new Date()): string {
  return businessDate(now)
}

/** `dd MMM yyyy` — the display format for every date in the application (§8.11). */
export function formatDate(value: Date | string): string {
  return DISPLAY_DATE.format(toDate(value))
}

/** `dd MMM yyyy, hh:mm am` in Asia/Kolkata. */
export function formatDateTime(value: Date | string): string {
  return DISPLAY_DATE_TIME.format(toDate(value))
}

/** Whole days between two `yyyy-MM-dd` business dates. Positive means `b` is later. */
export function daysBetween(a: string, b: string): number {
  const MS_PER_DAY = 86_400_000
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY)
}

/** Add days to a `yyyy-MM-dd` business date. */
export function addDays(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
  return shifted.toISOString().slice(0, 10)
}

/**
 * A next action is overdue when its date is before today **in Asia/Kolkata**
 * (§10.3). Closed opportunities have no next action, so the caller passes only
 * active ones.
 */
export function isOverdue(nextActionDate: string | null, now: Date | string = new Date()): boolean {
  if (!nextActionDate) return false
  return nextActionDate < businessToday(now)
}

export function isDueToday(nextActionDate: string | null, now: Date | string = new Date()): boolean {
  if (!nextActionDate) return false
  return nextActionDate === businessToday(now)
}

/** Relative recency for timelines: "today", "3 days ago", "2 months ago" (§8.11). */
export function relativeDays(value: Date | string, now: Date | string = new Date()): string {
  const days = daysBetween(businessDate(value), businessToday(now))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`
  const years = Math.floor(days / 365)
  return years === 1 ? '1 year ago' : `${years} years ago`
}

/** The current hour (0–23) in Asia/Kolkata. Used by the owner-summary gate (ADR-011). */
export function businessHour(now: Date | string = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: BUSINESS_TIME_ZONE,
      hour: '2-digit',
      hour12: false,
    }).format(toDate(now)),
  )
}
