import { describe, expect, it } from 'vitest'

import { formatPhone, normalizePhone, whatsappDeepLink } from '@/lib/phone'

/**
 * Phone normalisation (§5.3).
 *
 * These cases are duplicated in the integration suite against
 * `public.normalize_phone()`. **They must stay identical.** The database computes
 * `phone_normalized` as a generated column, and if the two implementations drift,
 * duplicate detection silently stops finding duplicates.
 */

describe('normalizePhone', () => {
  it.each([
    ['+91 98430 12345', '9843012345'],
    ['098430-12345', '9843012345'],
    ['91 (98430) 12345', '9843012345'],
    ['9843012345', '9843012345'],
    ['+919843012345', '9843012345'],
    ['  98430 12345  ', '9843012345'],
    ['98430.12345', '9843012345'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected)
  })

  it('returns null when fewer than ten digits remain', () => {
    // A partial number must never masquerade as a match.
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('   ')).toBeNull()
    expect(normalizePhone('no digits here')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone(undefined)).toBeNull()
  })

  it('keeps the trailing ten digits of a longer string', () => {
    expect(normalizePhone('0091 98430 12345')).toBe('9843012345')
  })
})

describe('formatPhone', () => {
  it('splits an Indian mobile number for reading', () => {
    expect(formatPhone('+919843012345')).toBe('98430 12345')
  })

  it('returns null for something unusable rather than showing junk', () => {
    expect(formatPhone('123')).toBeNull()
  })
})

describe('whatsappDeepLink', () => {
  it('builds a wa.me link with the country code', () => {
    expect(whatsappDeepLink('98430 12345')).toBe('https://wa.me/919843012345')
  })

  it('encodes prefilled text', () => {
    expect(whatsappDeepLink('9843012345', 'Hi Ravi, your quote is ready')).toBe(
      'https://wa.me/919843012345?text=Hi%20Ravi%2C%20your%20quote%20is%20ready',
    )
  })

  it('refuses an unusable number', () => {
    expect(() => whatsappDeepLink('123')).toThrow(/usable phone number/)
  })
})
