import { describe, expect, it } from 'vitest'

import {
  addDays,
  businessDate,
  businessHour,
  businessToday,
  daysBetween,
  formatDate,
  formatDateTime,
  isDueToday,
  isOverdue,
  relativeDays,
} from '@/lib/dates'

/**
 * Date and overdue calculations across timezone boundaries (§19.1, CLAUDE.md §10).
 *
 * The whole point: **the business day is Asia/Kolkata**, so between 18:30 and
 * 24:00 UTC the IST date is already tomorrow. Every case below sits on or around
 * that boundary, because that is where a naive implementation is wrong — and it
 * is wrong every single evening, on the one list the business depends on most.
 */

describe('businessDate', () => {
  it.each([
    ['2026-08-19T18:29:00Z', '2026-08-19'],
    ['2026-08-19T18:30:00Z', '2026-08-20'], // exactly the boundary
    ['2026-08-19T19:00:00Z', '2026-08-20'],
    ['2026-08-19T23:59:59Z', '2026-08-20'],
    ['2026-08-20T00:00:00Z', '2026-08-20'],
    ['2026-08-20T18:29:59Z', '2026-08-20'],
  ])('%s is the business day %s', (instant, expected) => {
    expect(businessDate(instant)).toBe(expected)
  })

  it('rolls the year over at 18:30 UTC on 31 December', () => {
    expect(businessDate('2025-12-31T18:29:00Z')).toBe('2025-12-31')
    expect(businessDate('2025-12-31T19:00:00Z')).toBe('2026-01-01')
  })

  it('rolls the month over', () => {
    expect(businessDate('2026-02-28T19:00:00Z')).toBe('2026-03-01')
  })

  it('accepts a Date as well as an ISO string', () => {
    expect(businessDate(new Date('2026-08-19T19:00:00Z'))).toBe('2026-08-20')
  })

  it('refuses something that is not a date', () => {
    expect(() => businessDate('not a date')).toThrow(/Not a date/)
  })
})

describe('overdue and due today', () => {
  // 20:00 UTC on the 19th is already the 20th in Erode.
  const eveningInIndia = '2026-08-19T20:00:00Z'

  it('treats the IST date as today, not the UTC one', () => {
    expect(businessToday(eveningInIndia)).toBe('2026-08-20')
  })

  it('is due today when the next action falls on the IST date', () => {
    expect(isDueToday('2026-08-20', eveningInIndia)).toBe(true)
    // A naive UTC implementation would call this "today". It is yesterday.
    expect(isDueToday('2026-08-19', eveningInIndia)).toBe(false)
  })

  it('is overdue the moment the IST day rolls over', () => {
    expect(isOverdue('2026-08-19', eveningInIndia)).toBe(true)
    expect(isOverdue('2026-08-19', '2026-08-19T18:29:00Z')).toBe(false)
  })

  it('is neither when there is no next action', () => {
    expect(isOverdue(null, eveningInIndia)).toBe(false)
    expect(isDueToday(null, eveningInIndia)).toBe(false)
  })

  it('a future date is not overdue', () => {
    expect(isOverdue('2026-08-25', eveningInIndia)).toBe(false)
  })
})

describe('date arithmetic', () => {
  it('counts whole days between business dates', () => {
    expect(daysBetween('2026-08-19', '2026-08-20')).toBe(1)
    expect(daysBetween('2026-08-20', '2026-08-19')).toBe(-1)
    expect(daysBetween('2026-08-19', '2026-08-19')).toBe(0)
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
  })

  it('adds days across a month boundary', () => {
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('display formatting', () => {
  it('renders dates as dd MMM yyyy in Asia/Kolkata', () => {
    expect(formatDate('2026-08-19T19:00:00Z')).toBe('20 Aug 2026')
    expect(formatDate('2026-08-19T06:00:00Z')).toBe('19 Aug 2026')
  })

  it('renders date and time in Asia/Kolkata', () => {
    // 06:00 UTC is 11:30 IST.
    expect(formatDateTime('2026-08-19T06:00:00Z')).toMatch(/19 Aug 2026, 11:30\s*am/i)
  })

  it('gives the Asia/Kolkata hour, for the owner summary gate', () => {
    expect(businessHour('2026-08-19T13:30:00Z')).toBe(19)
    expect(businessHour('2026-08-19T18:31:00Z')).toBe(0)
  })
})

describe('relative recency', () => {
  const now = '2026-08-19T06:00:00Z' // 19 Aug in India

  it.each([
    ['2026-08-19T05:00:00Z', 'today'],
    ['2026-08-18T06:00:00Z', 'yesterday'],
    ['2026-08-16T06:00:00Z', '3 days ago'],
    ['2026-07-19T06:00:00Z', '1 month ago'],
    ['2026-05-19T06:00:00Z', '3 months ago'],
    ['2025-05-19T06:00:00Z', '1 year ago'],
  ])('%s reads as %s', (instant, expected) => {
    expect(relativeDays(instant, now)).toBe(expected)
  })
})
