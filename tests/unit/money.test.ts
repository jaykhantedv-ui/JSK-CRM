import { describe, expect, it } from 'vitest'

import {
  formatPaise,
  formatPaiseCompact,
  paiseFromDb,
  paiseToRupees,
  rupeesToPaise,
  weightedPaise,
} from '@/lib/money'

/**
 * Money is bigint paise (§8.11, CLAUDE.md §9). The tests that matter here are the
 * ones about NOT losing precision: a rounding error in a quotation is a rounding
 * error in an invoice.
 */

describe('reading money from the database', () => {
  it('accepts the number and the string PostgREST may return for a bigint', () => {
    expect(paiseFromDb(4200000)).toBe(4200000)
    expect(paiseFromDb('4200000')).toBe(4200000)
    expect(paiseFromDb('  4200000  ')).toBe(4200000)
    expect(paiseFromDb(null)).toBeNull()
    expect(paiseFromDb(undefined)).toBeNull()
  })

  it('refuses a fractional value rather than rounding it away', () => {
    expect(() => paiseFromDb(4200000.5)).toThrow(/whole paise/)
    expect(() => paiseFromDb('4200000.5')).toThrow(/whole paise/)
  })

  it('refuses text that is not a number', () => {
    expect(() => paiseFromDb('₹4,20,000')).toThrow(/whole paise/)
  })
})

describe('parsing rupees typed by a person', () => {
  it.each([
    ['420000', 42000000],
    ['4,20,000', 42000000],
    ['₹4,20,000', 42000000],
    ['  420000  ', 42000000],
    ['420000.50', 42000050],
    ['420000.5', 42000050],
    ['0', 0],
    ['-1500', -150000],
  ])('%s becomes %d paise', (input, expected) => {
    expect(rupeesToPaise(input)).toBe(expected)
  })

  it('treats empty input as "not filled in", not as zero', () => {
    expect(rupeesToPaise('')).toBeNull()
    expect(rupeesToPaise('   ')).toBeNull()
    // A lone currency symbol carries no amount — the same as an empty field, not
    // a typo to reject.
    expect(rupeesToPaise('₹')).toBeNull()
  })

  it.each(['abc', '4.2.0', '420000.555', '4e5', '12,00,000rs'])(
    'refuses "%s" rather than guessing',
    (input) => {
      expect(() => rupeesToPaise(input)).toThrow(/rupee amount/)
    },
  )

  it('never goes through parseFloat, so decimal halves stay exact', () => {
    // 0.1 + 0.2 territory: the two-halves integer path must not drift.
    expect(rupeesToPaise('0.10')).toBe(10)
    expect(rupeesToPaise('0.20')).toBe(20)
    expect(rupeesToPaise('1234567.89')).toBe(123456789)
  })

  it('round-trips through paiseToRupees', () => {
    expect(paiseToRupees(rupeesToPaise('420000.50')!)).toBe(420000.5)
  })
})

describe('formatting', () => {
  it('uses Indian grouping', () => {
    expect(formatPaise(42000000)).toBe('₹4,20,000')
    expect(formatPaise(100000000)).toBe('₹10,00,000')
    expect(formatPaise(0)).toBe('₹0')
  })

  it('shows paise only when asked', () => {
    expect(formatPaise(42000050)).toBe('₹4,20,001')
    expect(formatPaise(42000050, { showPaise: true })).toBe('₹4,20,000.50')
  })

  it('abbreviates in lakhs and crores for tiles', () => {
    expect(formatPaiseCompact(420000)).toBe('₹4,200')
    expect(formatPaiseCompact(42000000)).toBe('₹4.2 L')
    expect(formatPaiseCompact(1200000000)).toBe('₹1.2 Cr')
    expect(formatPaiseCompact(-42000000)).toBe('-₹4.2 L')
  })
})

describe('weighted pipeline value', () => {
  it('applies the probability the caller was given', () => {
    // The probability comes from system_settings, never from a constant here.
    expect(weightedPaise(42000000, 60)).toBe(25200000)
    expect(weightedPaise(42000000, 0)).toBe(0)
    expect(weightedPaise(42000000, 100)).toBe(42000000)
  })

  it('rounds to whole paise', () => {
    expect(weightedPaise(101, 25)).toBe(25)
    expect(Number.isInteger(weightedPaise(4200001, 33))).toBe(true)
  })
})
