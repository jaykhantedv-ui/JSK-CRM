import { describe, expect, it } from 'vitest'

import { parseCsv } from '@/lib/csv'
import { templateCsv, templateColumnsFor } from '@/lib/import/templates'
import {
  missingRequiredColumns,
  parseEnumValue,
  rowsNeedingDecision,
  storedStatusFor,
  validateRows,
  type ValidationContext,
} from '@/lib/import/validate'

/**
 * Import validation — every rule in §20.3.
 *
 * The context is supplied rather than read from a database, which is the whole
 * point of keeping validation pure: the rules about existing data ("owner_email
 * does not match an active user", "account_phone does not resolve") are as
 * directly testable as the ones about formatting.
 */

const OWNER = '00000000-0000-4000-8000-000000001006'
const OUTLET = '00000000-0000-4000-8000-000000002001'
const EXISTING = '00000000-0000-4000-8000-000000003001'

function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    usersByEmail: new Map([['sales.a1@jsk.test', { id: OWNER, outletId: OUTLET }]]),
    outletsByCode: new Map([['ERD', OUTLET]]),
    cities: ['Erode', 'Perundurai'],
    existingAccounts: [],
    existingContacts: [],
    fallbackOwnerId: OWNER,
    fallbackOutletId: OUTLET,
    ...overrides,
  }
}

const validAccount = {
  name: 'Ravi Kumar',
  account_type: 'HOMEOWNER',
  phone: '9843011111',
  email: '',
  owner_email: 'sales.a1@jsk.test',
  city: 'Erode',
}

describe('parseEnumValue — case, space and underscore tolerance (§20.3)', () => {
  const allowed = ['INTERIOR_DESIGNER', 'HOMEOWNER'] as const

  it.each([
    'INTERIOR_DESIGNER',
    'interior_designer',
    'Interior Designer',
    'interior-designer',
    'interiordesigner',
    '  Interior   Designer  ',
  ])('accepts %s', (input) => {
    expect(parseEnumValue(input, allowed)).toBe('INTERIOR_DESIGNER')
  })

  it('refuses a value that is not on the list', () => {
    expect(parseEnumValue('DESIGNER', allowed)).toBeNull()
    expect(parseEnumValue('', allowed)).toBeNull()
    expect(parseEnumValue(null, allowed)).toBeNull()
  })
})

describe('required columns', () => {
  it('names the columns a file is missing', () => {
    expect(missingRequiredColumns('accounts', ['name', 'phone'])).toEqual([
      'account_type',
      'owner_email',
    ])
  })

  it('is satisfied by the shipped template', () => {
    const { headers } = parseCsv(templateCsv('accounts'))
    expect(missingRequiredColumns('accounts', headers)).toEqual([])
    const contacts = parseCsv(templateCsv('contacts'))
    expect(missingRequiredColumns('contacts', contacts.headers)).toEqual([])
  })

  it('ships a template with headers and no sample data (CLAUDE.md §15)', () => {
    const parsed = parseCsv(templateCsv('accounts'))
    expect(parsed.rows).toHaveLength(0)
    expect(parsed.headers).toEqual(templateColumnsFor('accounts').map((column) => column.name))
  })
})

describe('account rows', () => {
  it('accepts a complete row', () => {
    const { rows } = validateRows('accounts', [validAccount], context())
    expect(rows[0].status).toBe('VALID')
    expect(rows[0].normalized).toMatchObject({
      name: 'Ravi Kumar',
      account_type: 'HOMEOWNER',
      owner_id: OWNER,
      outlet_id: OUTLET,
      // Historical records are not walk-ins: a paper register says nothing about
      // how the customer arrived, and recording WALK_IN would invent data.
      source: 'OTHER',
      status: 'PROSPECT',
    })
  })

  it('rejects a missing required field', () => {
    const { rows } = validateRows('accounts', [{ ...validAccount, name: '' }], context())
    expect(rows[0].status).toBe('ERROR')
    expect(rows[0].messages[0].message).toMatch(/name is required/i)
    expect(rows[0].normalized).toBeNull()
  })

  it('rejects an unrecognised enum and lists the valid values', () => {
    const { rows } = validateRows(
      'accounts',
      [{ ...validAccount, account_type: 'PLUMBER' }],
      context(),
    )
    expect(rows[0].status).toBe('ERROR')
    expect(rows[0].messages[0].message).toContain('HOMEOWNER')
  })

  it.each(['12345', '1234567890', '5843011111'])('rejects the phone %s', (phone) => {
    const { rows } = validateRows('accounts', [{ ...validAccount, phone }], context())
    expect(rows[0].status).toBe('ERROR')
  })

  it('rejects an invalid email', () => {
    const { rows } = validateRows(
      'accounts',
      [{ ...validAccount, phone: '', email: 'not-an-email' }],
      context(),
    )
    expect(rows[0].status).toBe('ERROR')
  })

  it('rejects a row with neither phone nor email (ADR-013)', () => {
    const { rows } = validateRows('accounts', [{ ...validAccount, phone: '', email: '' }], context())
    expect(rows[0].status).toBe('ERROR')
    expect(rows[0].messages.some((m) => /phone number or an email/i.test(m.message))).toBe(true)
  })

  it('rejects an owner_email that is not an active user', () => {
    const { rows } = validateRows(
      'accounts',
      [{ ...validAccount, owner_email: 'nobody@jsk.test' }],
      context(),
    )
    expect(rows[0].status).toBe('ERROR')
    expect(rows[0].messages[0].message).toMatch(/no active user/i)
  })

  it('rejects an unknown outlet code', () => {
    const { rows } = validateRows(
      'accounts',
      [{ ...validAccount, outlet_code: 'ZZZ' }],
      context(),
    )
    expect(rows[0].status).toBe('ERROR')
    expect(rows[0].messages[0].message).toMatch(/no outlet/i)
  })

  it('WARNS on an unknown city and still imports it (§20.3)', () => {
    const { rows } = validateRows('accounts', [{ ...validAccount, city: 'Chennimalai' }], context())
    expect(rows[0].status).toBe('WARNING')
    expect(rows[0].normalized).not.toBeNull()
    expect(rows[0].normalized?.city).toBe('Chennimalai')
  })
})

describe('in-file duplicates (§20.3)', () => {
  it('marks EVERY row sharing a phone as an ERROR, not just the later one', () => {
    const { rows, counts } = validateRows(
      'accounts',
      [
        validAccount,
        { ...validAccount, name: 'Ravi K' },
        { ...validAccount, name: 'Someone Else', phone: '9843099999' },
      ],
      context(),
    )

    expect(rows[0].status).toBe('ERROR')
    expect(rows[1].status).toBe('ERROR')
    expect(rows[2].status).toBe('VALID')
    expect(counts.error).toBe(2)
    // Naming both line numbers is what makes the message actionable.
    expect(rows[0].messages.at(-1)?.message).toContain('rows 1, 2')
  })

  it('catches a duplicated email too', () => {
    const row = { ...validAccount, phone: '', email: 'ravi@example.com' }
    const { rows } = validateRows('accounts', [row, { ...row, name: 'Other' }], context())
    expect(rows.every((r) => r.status === 'ERROR')).toBe(true)
  })

  it('does not flag two rows that merely share a blank phone', () => {
    const row = { ...validAccount, phone: '', email: 'a@example.com' }
    const other = { ...validAccount, name: 'Bala', phone: '', email: 'b@example.com' }
    const { rows } = validateRows('accounts', [row, other], context())
    expect(rows.every((r) => r.status === 'VALID')).toBe(true)
  })
})

describe('duplicates against existing records (§20.3, §20.4)', () => {
  const existing = context({
    existingAccounts: [
      {
        id: EXISTING,
        name: 'Ravi Kumar',
        phoneNormalized: '9843011111',
        emailNormalized: null,
        ownerId: OWNER,
        outletId: OUTLET,
      },
    ],
  })

  it('flags a matching phone as DUPLICATE_EXACT', () => {
    const { rows } = validateRows('accounts', [validAccount], existing)
    expect(rows[0].duplicateConfidence).toBe('EXACT')
    expect(rows[0].duplicateOf).toBe(EXISTING)
    expect(storedStatusFor(rows[0])).toBe('DUPLICATE_EXACT')
  })

  it('flags an identical name with a different phone as DUPLICATE_POSSIBLE', () => {
    const { rows } = validateRows(
      'accounts',
      [{ ...validAccount, phone: '9843077777' }],
      existing,
    )
    expect(rows[0].duplicateConfidence).toBe('POSSIBLE')
    expect(storedStatusFor(rows[0])).toBe('DUPLICATE_POSSIBLE')
  })

  it('does not flag an unrelated row', () => {
    const { rows } = validateRows(
      'accounts',
      [{ ...validAccount, name: 'Meena', phone: '9843088888' }],
      existing,
    )
    expect(rows[0].duplicateOf).toBeUndefined()
    expect(storedStatusFor(rows[0])).toBe('VALID')
  })

  it('an in-file duplicate stays an ERROR rather than becoming reviewable', () => {
    const { rows } = validateRows('accounts', [validAccount, validAccount], existing)
    expect(rows.every((row) => storedStatusFor(row) === 'ERROR')).toBe(true)
  })
})

describe('contact rows', () => {
  const withAccount = context({
    existingAccounts: [
      {
        id: EXISTING,
        name: 'Ravi Kumar',
        phoneNormalized: '9843011111',
        emailNormalized: null,
        ownerId: OWNER,
        outletId: OUTLET,
      },
    ],
  })

  it('resolves account_phone to the account and inherits its owner', () => {
    const { rows } = validateRows(
      'contacts',
      [{ full_name: 'Meena Ravi', phone: '9843055555', account_phone: '98430 11111' }],
      withAccount,
    )
    expect(rows[0].status).toBe('VALID')
    expect(rows[0].normalized).toMatchObject({ account_id: EXISTING, owner_id: OWNER })
  })

  it('rejects an account_phone that does not resolve (§20.3)', () => {
    const { rows } = validateRows(
      'contacts',
      [{ full_name: 'Meena', phone: '9843055555', account_phone: '9999999999' }],
      withAccount,
    )
    expect(rows[0].status).toBe('ERROR')
    expect(rows[0].messages[0].message).toMatch(/no existing customer/i)
  })

  it('defaults role and influence', () => {
    const { rows } = validateRows(
      'contacts',
      [{ full_name: 'Meena', phone: '9843055555' }],
      withAccount,
    )
    expect(rows[0].normalized).toMatchObject({
      role: 'OTHER',
      influence: 'INFLUENCER',
      is_referral_source: false,
    })
  })

  it('rejects an unparseable yes/no', () => {
    const { rows } = validateRows(
      'contacts',
      [{ full_name: 'Meena', phone: '9843055555', is_referral_source: 'maybe' }],
      withAccount,
    )
    expect(rows[0].status).toBe('ERROR')
  })

  it.each([
    ['yes', true],
    ['Y', true],
    ['TRUE', true],
    ['no', false],
    ['0', false],
  ])('reads %s as %s', (input, expected) => {
    const { rows } = validateRows(
      'contacts',
      [{ full_name: 'Meena', phone: '9843055555', is_referral_source: input }],
      withAccount,
    )
    expect(rows[0].normalized?.is_referral_source).toBe(expected)
  })
})

describe('rowsNeedingDecision (§20.4)', () => {
  it('counts only undecided duplicates', () => {
    expect(
      rowsNeedingDecision([
        { status: 'DUPLICATE_EXACT', decision: null },
        { status: 'DUPLICATE_POSSIBLE', decision: 'SKIP' },
        { status: 'VALID', decision: null },
        { status: 'ERROR', decision: null },
      ]),
    ).toBe(1)
  })

  it('is zero when every duplicate has been ruled on', () => {
    expect(
      rowsNeedingDecision([
        { status: 'DUPLICATE_EXACT', decision: 'IMPORT' },
        { status: 'DUPLICATE_POSSIBLE', decision: 'LINK_EXISTING' },
      ]),
    ).toBe(0)
  })
})
