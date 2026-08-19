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

/**
 * The month abbreviation comes from `en-US`, deliberately, and the parts are
 * reassembled by hand.
 *
 * `en-GB` renders September as **"Sept"** — four letters — while every other
 * month is three. §8.11 specifies `dd MMM yyyy`, so an `en-GB` formatter produces
 * "19 Sept 2026" one month in twelve and quietly breaks the alignment of every
 * date column in the application. `en-US` abbreviates every month to three
 * letters but orders the parts as "Sep 19, 2026", so the ordering is imposed here
 * rather than taken from the locale.
 */
const DISPLAY_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const DISPLAY_TIME_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

function partsOf(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
}

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
  const parts = partsOf(DISPLAY_PARTS, toDate(value))
  return `${parts.day} ${parts.month} ${parts.year}`
}

/** `dd MMM yyyy, hh:mm am` in Asia/Kolkata. */
export function formatDateTime(value: Date | string): string {
  const date = toDate(value)
  const time = partsOf(DISPLAY_TIME_PARTS, date)
  return `${formatDate(date)}, ${time.hour}:${time.minute} ${(time.dayPeriod ?? '').toLowerCase()}`
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

/**
 * Asia/Kolkata is UTC+05:30 all year. India has observed no daylight saving since
 * 1945, so a fixed offset is a statement of fact here rather than a shortcut —
 * and it is what lets a business-day boundary be expressed without `date-fns-tz`,
 * which is deliberately not installed (M-13).
 */
export const BUSINESS_UTC_OFFSET = '+05:30'

/**
 * The instant a business day begins, as an ISO UTC string.
 *
 * Period boundaries — "won this month", "closed in the last 90 days" — compare
 * against `timestamptz` columns, so the boundary has to be an instant. Taking
 * midnight in UTC instead would put the first five and a half hours of every
 * Indian day in the previous period (CLAUDE.md §10).
 */
export function businessDayStart(date: string): string {
  return new Date(`${date}T00:00:00${BUSINESS_UTC_OFFSET}`).toISOString()
}

/** The first day of the month `date` falls in, as `yyyy-MM-dd` in Asia/Kolkata. */
export function businessMonthStart(date: string = businessToday()): string {
  return `${date.slice(0, 7)}-01`
}

/**
 * A wall-clock `yyyy-MM-ddTHH:mm` from a `datetime-local` input, as an ISO UTC
 * instant.
 *
 * The browser hands over a local time with **no timezone at all**. Sending it
 * straight to a `timestamptz` column makes PostgreSQL read it in the session
 * timezone — UTC on Supabase — so an activity logged at 2pm in Erode would be
 * stored as 2pm UTC and read back as 7:30pm IST. Every back-dated activity would
 * land five and a half hours late (CLAUDE.md §10).
 *
 * Returns null for anything that is not a wall-clock string, so a caller can tell
 * "not supplied" from "supplied and wrong".
 */
export function businessLocalToUtc(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null
  const instant = new Date(`${value}${BUSINESS_UTC_OFFSET}`)
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString()
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
