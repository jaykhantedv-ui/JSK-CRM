import { BUSINESS_UTC_OFFSET, businessDayStart, businessMonthStart, businessToday } from '@/lib/dates'

/**
 * Reporting periods (Master Phase 3 §16 — "support sensible date filtering").
 *
 * **A period is resolved once, here, into two instants**, and every dashboard
 * tile, report and export in the request compares against the same pair. Two
 * screens that each decide for themselves what "this month" means is how a
 * manager ends up with two different Won Values on one morning.
 *
 * THE BUSINESS DAY IS Asia/Kolkata (CLAUDE.md §10). A period boundary computed
 * as UTC midnight puts the first five and a half hours of every Indian day in the
 * wrong month — a deal won at 11pm IST on the 31st would land in the next month's
 * report. `businessDayStart()` is what makes the boundary an instant that means
 * "midnight in Erode".
 *
 * The end is EXCLUSIVE (`from <= t < to`). A closed interval on a `timestamptz`
 * either drops the last day or double-counts its boundary, depending on which
 * mistake you make; an exclusive end has neither failure mode.
 */

export const PERIOD_KEYS = [
  'this_month',
  'last_month',
  'last_30_days',
  'last_90_days',
  'this_quarter',
  'this_year',
  'custom',
] as const

export type PeriodKey = (typeof PERIOD_KEYS)[number]

export type Period = {
  key: PeriodKey
  label: string
  /** Inclusive first business day, `yyyy-MM-dd` in Asia/Kolkata. */
  fromDate: string
  /** Inclusive last business day, `yyyy-MM-dd` — what the UI shows. */
  toDate: string
  /** Inclusive start instant, ISO UTC. */
  fromInstant: string
  /** **Exclusive** end instant, ISO UTC — the day after `toDate` begins. */
  toInstant: string
}

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  this_quarter: 'This quarter',
  this_year: 'This year',
  custom: 'Custom range',
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** The last day of the month `date` falls in, as `yyyy-MM-dd`. */
function monthEnd(date: string): string {
  const [year, month] = date.split('-').map(Number)
  // Day 0 of the following month is the last day of this one, and `Date.UTC`
  // rolls December into January without special-casing.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

function monthStartOffset(date: string, months: number): string {
  const [year, month] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10)
}

/** The first day of the calendar quarter `date` falls in. */
function quarterStart(date: string): string {
  const [year, month] = date.split('-').map(Number)
  return new Date(Date.UTC(year, Math.floor((month - 1) / 3) * 3, 1)).toISOString().slice(0, 10)
}

function build(key: PeriodKey, fromDate: string, toDate: string, label?: string): Period {
  return {
    key,
    label: label ?? PERIOD_LABELS[key],
    fromDate,
    toDate,
    fromInstant: businessDayStart(fromDate),
    // Exclusive: midnight at the start of the day AFTER the last day in range.
    toInstant: businessDayStart(shiftDays(toDate, 1)),
  }
}

/**
 * Resolve a period from URL parameters. **Never throws** — a hostile or
 * mistyped `?from=` falls back to the default rather than turning a dashboard
 * into an error page, which is the same discipline `parsePageParams` follows.
 */
export function parsePeriod(
  raw: { period?: string | null; from?: string | null; to?: string | null } = {},
  now: Date | string = new Date(),
): Period {
  const requested = (PERIOD_KEYS as readonly string[]).includes(raw.period ?? '')
    ? (raw.period as PeriodKey)
    : null

  if (requested === 'custom' || (!requested && raw.from && raw.to)) {
    const from = raw.from && ISO_DATE.test(raw.from) ? raw.from : null
    const to = raw.to && ISO_DATE.test(raw.to) ? raw.to : null

    if (from && to) {
      // A reversed range is a typo, not an instruction to report nothing.
      const [start, end] = from <= to ? [from, to] : [to, from]
      return build('custom', start, end, `${start} to ${end}`)
    }
    // "Custom" without a usable range is not an error, it is an unfinished form.
    return periodFor('this_month', now)
  }

  return periodFor(requested ?? 'this_month', now)
}

export function periodFor(key: PeriodKey, now: Date | string = new Date()): Period {
  const today = businessToday(now)

  switch (key) {
    case 'this_month':
      return build(key, businessMonthStart(today), monthEnd(today))

    case 'last_month': {
      const start = monthStartOffset(today, -1)
      return build(key, start, monthEnd(start))
    }

    // A rolling window INCLUDES today, so "last 30 days" is today plus the 29
    // before it. Starting 30 days back would be a 31-day window.
    case 'last_30_days':
      return build(key, shiftDays(today, -29), today)

    case 'last_90_days':
      return build(key, shiftDays(today, -89), today)

    case 'this_quarter': {
      const start = quarterStart(today)
      return build(key, start, monthEnd(monthStartOffset(start, 2)))
    }

    case 'this_year':
      return build(key, `${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`)

    case 'custom':
      // Nothing to derive a custom range from; the caller wanted a default.
      return build('this_month', businessMonthStart(today), monthEnd(today))
  }
}

/** The month a period's targets belong to — the first of `fromDate`'s month. */
export function targetMonthFor(period: Period): string {
  return businessMonthStart(period.fromDate)
}

/**
 * The months a period covers, as month-start dates.
 *
 * A target is set per month, so a period spanning several months has to sum
 * several targets. Silently comparing a quarter's Won Value against one month's
 * target would report a 300% shortfall that does not exist.
 */
export function monthsInPeriod(period: Period): string[] {
  const months: string[] = []
  let cursor = businessMonthStart(period.fromDate)
  const last = businessMonthStart(period.toDate)

  // Bounded by construction: a period cannot exceed a year, and the guard keeps a
  // malformed range from spinning.
  for (let index = 0; index <= 24 && cursor <= last; index += 1) {
    months.push(cursor)
    cursor = monthStartOffset(cursor, 1)
  }

  return months
}

/** `?period=` and friends, for building a link that keeps the current range. */
export function periodParams(period: Period): Record<string, string> {
  return period.key === 'custom'
    ? { period: 'custom', from: period.fromDate, to: period.toDate }
    : { period: period.key }
}

export { BUSINESS_UTC_OFFSET }
