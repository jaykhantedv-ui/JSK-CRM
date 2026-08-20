import { describe, expect, it } from 'vitest'

import {
  UPCOMING_WINDOW_DAYS,
  bucketByNextAction,
  isNextActionDateAcceptable,
  nextActionLabel,
  nextActionState,
  nextActionTone,
  quickDates,
} from '@/lib/next-action'

/**
 * Follow-up and date-state logic (§19.1 "date/overdue calculations across
 * timezone boundaries", §8.3, §10.3).
 *
 * **The evening cases are the reason this file exists.** Asia/Kolkata is UTC+5:30,
 * so between 18:30 and 24:00 IST the UTC date is already tomorrow — or, read the
 * other way, a naive `new Date().toISOString().slice(0,10)` reads as *yesterday*
 * for five and a half hours of every Indian working evening. A salesperson
 * checking their overdue list at 9pm would see the wrong list every single night
 * (SPEC_AUDIT B-10, CLAUDE.md §10).
 */

// 19:00 IST on 19 Aug 2026 is 13:30 UTC on the same day — the ordinary case.
const EVENING_IST = '2026-08-19T13:30:00Z'
// 00:30 IST on 20 Aug 2026 is 19:00 UTC on 19 Aug — the business day has rolled
// over while UTC still says the 19th.
const AFTER_MIDNIGHT_IST = '2026-08-19T19:00:00Z'
// 05:00 IST on 19 Aug is 23:30 UTC on the 18th — UTC is still on the previous day.
const EARLY_MORNING_IST = '2026-08-18T23:30:00Z'

describe('next action state', () => {
  it('is MISSING when there is no date, which is a state and not an absence', () => {
    expect(nextActionState({ nextActionDate: null, stage: 'qualified' })).toBe('MISSING')
  })

  it('is CLOSED for a won or lost opportunity, whatever the date says', () => {
    expect(nextActionState({ nextActionDate: '2020-01-01', stage: 'won' })).toBe('CLOSED')
    expect(nextActionState({ nextActionDate: '2020-01-01', stage: 'lost' })).toBe('CLOSED')
  })

  it('is OVERDUE when the date is before today', () => {
    expect(
      nextActionState({ nextActionDate: '2026-08-18', stage: 'quoted', now: EVENING_IST }),
    ).toBe('OVERDUE')
  })

  it('is DUE_TODAY on the day itself', () => {
    expect(
      nextActionState({ nextActionDate: '2026-08-19', stage: 'quoted', now: EVENING_IST }),
    ).toBe('DUE_TODAY')
  })

  it('is UPCOMING inside the seven-day window and LATER beyond it', () => {
    expect(
      nextActionState({ nextActionDate: '2026-08-26', stage: 'quoted', now: EVENING_IST }),
    ).toBe('UPCOMING')
    expect(
      nextActionState({ nextActionDate: '2026-08-27', stage: 'quoted', now: EVENING_IST }),
    ).toBe('LATER')
  })
})

describe('the business day is Asia/Kolkata, not UTC (B-10)', () => {
  it('after 18:30 IST, work due tomorrow IST is not yet due', () => {
    // 20 Aug in IST. UTC has already ticked over to the 20th at this instant, so
    // a UTC-based comparison would call this "due today" — five and a half hours
    // early, every evening.
    expect(
      nextActionState({ nextActionDate: '2026-08-20', stage: 'quoted', now: AFTER_MIDNIGHT_IST }),
    ).toBe('DUE_TODAY')
    expect(
      nextActionState({ nextActionDate: '2026-08-19', stage: 'quoted', now: AFTER_MIDNIGHT_IST }),
    ).toBe('OVERDUE')
  })

  it('before 05:30 IST, the IST day is already the next UTC day', () => {
    // 05:00 IST on the 19th. UTC still reads the 18th, so a UTC comparison would
    // report work due on the 19th as "upcoming" when it is due right now.
    expect(
      nextActionState({ nextActionDate: '2026-08-19', stage: 'quoted', now: EARLY_MORNING_IST }),
    ).toBe('DUE_TODAY')
  })

  it('the same instant is read consistently by state and label', () => {
    const input = { nextActionDate: '2026-08-19', stage: 'quoted', now: AFTER_MIDNIGHT_IST }
    expect(nextActionState(input)).toBe('OVERDUE')
    expect(nextActionLabel(input)).toBe('Overdue by 1 day')
  })
})

describe('labels a salesperson can read at a glance (§8.11)', () => {
  it('counts overdue days rather than printing a date', () => {
    expect(nextActionLabel({ nextActionDate: '2026-08-15', stage: 'quoted', now: EVENING_IST })).toBe(
      'Overdue by 4 days',
    )
    expect(nextActionLabel({ nextActionDate: '2026-08-18', stage: 'quoted', now: EVENING_IST })).toBe(
      'Overdue by 1 day',
    )
  })

  it('says Today and Tomorrow rather than a date', () => {
    expect(nextActionLabel({ nextActionDate: '2026-08-19', stage: 'new', now: EVENING_IST })).toBe('Today')
    expect(nextActionLabel({ nextActionDate: '2026-08-20', stage: 'new', now: EVENING_IST })).toBe('Tomorrow')
  })

  it('prompts for an action when there is none', () => {
    expect(nextActionLabel({ nextActionDate: null, stage: 'new' })).toBe('Set next action')
  })
})

describe('tone never carries meaning on its own (§12.1)', () => {
  it('gives overdue and missing distinct tones', () => {
    expect(nextActionTone('OVERDUE')).toBe('overdue')
    expect(nextActionTone('MISSING')).toBe('at-risk')
  })

  it('has a tone for every state, so no state renders unstyled', () => {
    for (const state of ['OVERDUE', 'DUE_TODAY', 'UPCOMING', 'LATER', 'MISSING', 'CLOSED'] as const) {
      expect(nextActionTone(state)).toBeTruthy()
    }
  })
})

describe('quick dates (§11.5)', () => {
  it('offers tomorrow, three days, a week and a fortnight from the IST today', () => {
    expect(quickDates(EVENING_IST).map((option) => option.date)).toEqual([
      '2026-08-20',
      '2026-08-22',
      '2026-08-26',
      '2026-09-02',
    ])
  })

  it('rolls to the next IST day after 18:30, not after midnight UTC', () => {
    // At 00:30 IST on the 20th, "tomorrow" is the 21st.
    expect(quickDates(AFTER_MIDNIGHT_IST)[0].date).toBe('2026-08-21')
  })

  it('never offers a date in the past', () => {
    for (const option of quickDates(EVENING_IST)) {
      expect(isNextActionDateAcceptable(option.date, EVENING_IST)).toBe(true)
    }
  })
})

describe('accepting a next action date (§11.1)', () => {
  it('allows today — "call them back this afternoon" is a real answer', () => {
    expect(isNextActionDateAcceptable('2026-08-19', EVENING_IST)).toBe(true)
  })

  it('rejects yesterday', () => {
    expect(isNextActionDateAcceptable('2026-08-18', EVENING_IST)).toBe(false)
  })
})

describe('bucketing the /today queues (§13.2)', () => {
  const rows = [
    { id: 'a', next_action_date: '2026-08-10', stage: 'quoted' },
    { id: 'b', next_action_date: '2026-08-18', stage: 'negotiation' },
    { id: 'c', next_action_date: '2026-08-19', stage: 'new' },
    { id: 'd', next_action_date: '2026-08-22', stage: 'new' },
    { id: 'e', next_action_date: null, stage: 'qualified' },
    { id: 'f', next_action_date: '2026-09-30', stage: 'nurture' },
    { id: 'g', next_action_date: '2026-08-01', stage: 'won' },
  ]

  it('sorts the four buckets exactly as §13.2 lists them', () => {
    const buckets = bucketByNextAction(rows, EVENING_IST)
    expect(buckets.overdue.map((row) => row.id)).toEqual(['a', 'b'])
    expect(buckets.dueToday.map((row) => row.id)).toEqual(['c'])
    expect(buckets.upcoming.map((row) => row.id)).toEqual(['d'])
    expect(buckets.missing.map((row) => row.id)).toEqual(['e'])
  })

  it('puts the longest-waiting overdue item first', () => {
    // §13.2: "Overdue, oldest first" — the one that has been waiting longest is
    // the one to call first.
    expect(bucketByNextAction(rows, EVENING_IST).overdue[0].id).toBe('a')
  })

  it('leaves closed opportunities out of every queue', () => {
    const buckets = bucketByNextAction(rows, EVENING_IST)
    const everything = [...buckets.overdue, ...buckets.dueToday, ...buckets.upcoming, ...buckets.missing]
    expect(everything.map((row) => row.id)).not.toContain('g')
  })

  it('leaves far-future work out of the seven-day window', () => {
    expect(bucketByNextAction(rows, EVENING_IST).upcoming.map((row) => row.id)).not.toContain('f')
  })

  it('uses the seven-day horizon §13.1 defines', () => {
    expect(UPCOMING_WINDOW_DAYS).toBe(7)
  })
})
