import { describe, expect, it } from 'vitest'

import { monthsInPeriod, parsePeriod, periodFor, periodParams, targetMonthFor } from '@/lib/period'

/**
 * Reporting period boundaries (§19.1 — "date/overdue calculations across
 * timezone boundaries").
 *
 * **The business day is Asia/Kolkata, not UTC** (CLAUDE.md §10). Every assertion
 * below that pins an instant to `T18:30:00.000Z` is checking the same thing:
 * midnight in Erode is 18:30 the previous day in UTC, and a period boundary that
 * forgets it puts five and a half hours of every month in the wrong month.
 */

// 2026-08-20, 21:00 IST — which is 15:30 UTC on the same date. Chosen so the
// evening cases are exercised: this is the window where a naive `new Date()`
// still reads as the previous day in UTC.
const EVENING_IST = new Date('2026-08-20T15:30:00Z')

// 2026-08-20, 00:30 IST — 2026-08-19 19:00 UTC. The UTC date is the PREVIOUS
// day, so anything reading the UTC calendar lands in the wrong month at a
// month boundary.
const JUST_AFTER_MIDNIGHT_IST = new Date('2026-08-19T19:00:00Z')

describe('this month', () => {
  it('runs from the first to the last day of the Asia/Kolkata month', () => {
    const period = periodFor('this_month', EVENING_IST)
    expect(period.fromDate).toBe('2026-08-01')
    expect(period.toDate).toBe('2026-08-31')
  })

  it('starts at midnight IST, which is 18:30 UTC the day before', () => {
    const period = periodFor('this_month', EVENING_IST)
    expect(period.fromInstant).toBe('2026-07-31T18:30:00.000Z')
  })

  it('ends EXCLUSIVELY at midnight IST after the last day', () => {
    const period = periodFor('this_month', EVENING_IST)
    // 1 September 00:00 IST. A deal won at 23:59 IST on 31 August is inside;
    // one won a minute later is not.
    expect(period.toInstant).toBe('2026-08-31T18:30:00.000Z')
  })

  it('resolves the IST month even when UTC is still on the previous day', () => {
    // 00:30 IST on 20 August. In UTC it is 19 August — same month here, but the
    // same arithmetic is what keeps 1 August 00:30 IST out of July.
    const period = periodFor('this_month', JUST_AFTER_MIDNIGHT_IST)
    expect(period.fromDate).toBe('2026-08-01')
  })

  it('puts the first minutes of an IST month in that month, not the previous one', () => {
    // 2026-09-01 00:15 IST is 2026-08-31 18:45 UTC. A UTC-based reading would
    // report August.
    const period = periodFor('this_month', new Date('2026-08-31T18:45:00Z'))
    expect(period.fromDate).toBe('2026-09-01')
    expect(period.toDate).toBe('2026-09-30')
  })
})

describe('last month', () => {
  it('is the whole of the preceding calendar month', () => {
    const period = periodFor('last_month', EVENING_IST)
    expect(period.fromDate).toBe('2026-07-01')
    expect(period.toDate).toBe('2026-07-31')
  })

  it('rolls back across a year boundary', () => {
    const period = periodFor('last_month', new Date('2026-01-15T06:00:00Z'))
    expect(period.fromDate).toBe('2025-12-01')
    expect(period.toDate).toBe('2025-12-31')
  })

  it('handles February in a leap year', () => {
    const period = periodFor('last_month', new Date('2028-03-10T06:00:00Z'))
    expect(period.fromDate).toBe('2028-02-01')
    expect(period.toDate).toBe('2028-02-29')
  })

  it('handles February in a common year', () => {
    const period = periodFor('last_month', new Date('2026-03-10T06:00:00Z'))
    expect(period.toDate).toBe('2026-02-28')
  })
})

describe('rolling windows', () => {
  it('counts today as one of the last 30 days', () => {
    const period = periodFor('last_30_days', EVENING_IST)
    expect(period.toDate).toBe('2026-08-20')
    expect(period.fromDate).toBe('2026-07-22')
  })

  it('counts today as one of the last 90 days', () => {
    const period = periodFor('last_90_days', EVENING_IST)
    expect(period.toDate).toBe('2026-08-20')
    expect(period.fromDate).toBe('2026-05-23')
  })
})

describe('quarter and year', () => {
  it('resolves the calendar quarter the day falls in', () => {
    expect(periodFor('this_quarter', EVENING_IST).fromDate).toBe('2026-07-01')
    expect(periodFor('this_quarter', EVENING_IST).toDate).toBe('2026-09-30')
  })

  it('resolves each of the four quarters', () => {
    const at = (iso: string) => periodFor('this_quarter', new Date(iso))
    expect(at('2026-02-10T06:00:00Z').fromDate).toBe('2026-01-01')
    expect(at('2026-05-10T06:00:00Z').fromDate).toBe('2026-04-01')
    expect(at('2026-08-10T06:00:00Z').fromDate).toBe('2026-07-01')
    expect(at('2026-11-10T06:00:00Z').fromDate).toBe('2026-10-01')
    expect(at('2026-11-10T06:00:00Z').toDate).toBe('2026-12-31')
  })

  it('resolves the calendar year', () => {
    const period = periodFor('this_year', EVENING_IST)
    expect(period.fromDate).toBe('2026-01-01')
    expect(period.toDate).toBe('2026-12-31')
  })
})

describe('parsing from URL parameters', () => {
  it('defaults to this month when nothing is supplied', () => {
    expect(parsePeriod({}, EVENING_IST).key).toBe('this_month')
  })

  it('never throws on a hostile or mistyped value', () => {
    expect(parsePeriod({ period: 'DROP TABLE' }, EVENING_IST).key).toBe('this_month')
    expect(parsePeriod({ period: '../../etc' }, EVENING_IST).key).toBe('this_month')
    expect(parsePeriod({ from: 'yesterday', to: 'soon' }, EVENING_IST).key).toBe('this_month')
  })

  it('accepts a valid custom range', () => {
    const period = parsePeriod({ period: 'custom', from: '2026-04-01', to: '2026-06-30' }, EVENING_IST)
    expect(period.key).toBe('custom')
    expect(period.fromDate).toBe('2026-04-01')
    expect(period.toInstant).toBe('2026-06-30T18:30:00.000Z')
  })

  it('repairs a reversed custom range instead of reporting nothing', () => {
    const period = parsePeriod({ period: 'custom', from: '2026-06-30', to: '2026-04-01' }, EVENING_IST)
    expect(period.fromDate).toBe('2026-04-01')
    expect(period.toDate).toBe('2026-06-30')
  })

  it('falls back when a custom range is half-filled', () => {
    expect(parsePeriod({ period: 'custom', from: '2026-04-01' }, EVENING_IST).key).toBe('this_month')
  })

  it('infers a custom range from bare from/to parameters', () => {
    const period = parsePeriod({ from: '2026-04-01', to: '2026-04-30' }, EVENING_IST)
    expect(period.key).toBe('custom')
  })

  it('round-trips through periodParams', () => {
    const named = periodFor('last_90_days', EVENING_IST)
    expect(periodParams(named)).toEqual({ period: 'last_90_days' })
    expect(parsePeriod(periodParams(named), EVENING_IST).fromDate).toBe(named.fromDate)

    const custom = parsePeriod({ period: 'custom', from: '2026-02-01', to: '2026-02-28' }, EVENING_IST)
    expect(periodParams(custom)).toEqual({ period: 'custom', from: '2026-02-01', to: '2026-02-28' })
    expect(parsePeriod(periodParams(custom), EVENING_IST).toDate).toBe('2026-02-28')
  })
})

describe('target months', () => {
  it('takes a single-month period to its own month', () => {
    expect(targetMonthFor(periodFor('this_month', EVENING_IST))).toBe('2026-08-01')
    expect(monthsInPeriod(periodFor('this_month', EVENING_IST))).toEqual(['2026-08-01'])
  })

  it('enumerates every month a quarter covers, so targets sum correctly', () => {
    // Comparing a quarter's Won Value against ONE month's target would report a
    // shortfall that does not exist.
    expect(monthsInPeriod(periodFor('this_quarter', EVENING_IST))).toEqual([
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
    ])
  })

  it('enumerates twelve months for a year', () => {
    expect(monthsInPeriod(periodFor('this_year', EVENING_IST))).toHaveLength(12)
  })

  it('enumerates the months a rolling window straddles', () => {
    expect(monthsInPeriod(periodFor('last_30_days', EVENING_IST))).toEqual([
      '2026-07-01',
      '2026-08-01',
    ])
  })
})
