import { describe, expect, it } from 'vitest'

import {
  NAME_CITY_SIMILARITY_THRESHOLD,
  NAME_ONLY_SIMILARITY_THRESHOLD,
  confidenceFor,
  duplicateWarningTitle,
  overallConfidence,
  signalLabel,
  type DuplicateConfidence,
  type DuplicateSignal,
} from '@/lib/duplicates'

/**
 * Duplicate confidence scoring (§19.1, §8.9).
 *
 * The behaviour under test is the whole of §8.9's table: a matching phone or
 * email is EXACT, a similar name is POSSIBLE, and **nothing is ever a reason to
 * block a save**. The last part is not testable here because there is no code
 * path that could block — which is the point; the integration suite proves a
 * duplicate account still saves.
 */
describe('duplicate confidence (§8.9)', () => {
  it('treats a matching phone as an exact match', () => {
    expect(confidenceFor('PHONE')).toBe('EXACT')
  })

  it('treats a matching email as an exact match', () => {
    expect(confidenceFor('EMAIL')).toBe('EXACT')
  })

  it('treats a similar name with the same city as possible, not exact', () => {
    expect(confidenceFor('NAME_CITY')).toBe('POSSIBLE')
  })

  it('treats a similar name alone as possible', () => {
    expect(confidenceFor('NAME')).toBe('POSSIBLE')
  })

  it('covers every signal the database can return', () => {
    const signals: DuplicateSignal[] = ['PHONE', 'EMAIL', 'NAME_CITY', 'NAME']
    for (const signal of signals) {
      expect(['EXACT', 'POSSIBLE']).toContain(confidenceFor(signal))
    }
  })
})

describe('overall confidence', () => {
  it('is NONE when nothing matched', () => {
    expect(overallConfidence([])).toBe('NONE')
  })

  it('is POSSIBLE when only name matches were found', () => {
    expect(overallConfidence([{ confidence: 'POSSIBLE' }, { confidence: 'POSSIBLE' }])).toBe('POSSIBLE')
  })

  it('is EXACT when any match is exact, whatever else is in the list', () => {
    // The warning card leads with the strongest signal — an exact phone match
    // buried under three fuzzy name matches must still raise the strong warning.
    expect(overallConfidence([{ confidence: 'POSSIBLE' }, { confidence: 'EXACT' }])).toBe('EXACT')
  })
})

describe('thresholds match §8.9 exactly', () => {
  it('uses 0.6 for a name match backed by the same city', () => {
    expect(NAME_CITY_SIMILARITY_THRESHOLD).toBe(0.6)
  })

  it('uses 0.8 for a name match with no city to back it', () => {
    expect(NAME_ONLY_SIMILARITY_THRESHOLD).toBe(0.8)
  })

  it('is stricter without a city than with one', () => {
    expect(NAME_ONLY_SIMILARITY_THRESHOLD).toBeGreaterThan(NAME_CITY_SIMILARITY_THRESHOLD)
  })
})

describe('warning copy', () => {
  it('never tells the user they are blocked', () => {
    const confidences: DuplicateConfidence[] = ['EXACT', 'POSSIBLE', 'NONE']
    for (const confidence of confidences) {
      const title = duplicateWarningTitle(confidence, 2)
      expect(title.toLowerCase()).not.toMatch(/block|cannot|not allowed|denied/)
    }
  })

  it('reads naturally for one match and for several', () => {
    expect(duplicateWarningTitle('EXACT', 1)).toContain('customer with')
    expect(duplicateWarningTitle('EXACT', 3)).toContain('customers with')
  })

  it('explains each signal in words a salesperson can act on', () => {
    expect(signalLabel('PHONE')).toBe('Same phone number')
    expect(signalLabel('EMAIL')).toBe('Same email')
    expect(signalLabel('NAME_CITY')).toBe('Similar name, same city')
    expect(signalLabel('NAME')).toBe('Similar name')
  })
})
