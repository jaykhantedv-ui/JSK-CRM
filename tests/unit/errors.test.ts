import { describe, expect, it } from 'vitest'

import { AppError, forbidden, fromPostgrestError, isAppError, notFound } from '@/lib/errors'

/**
 * The error contract (§16.2).
 *
 * **A raw Postgres error must never reach the UI.** These tests assert both
 * halves of that: the friendly message a user sees, and the absence of database
 * wording when the constraint is one we do not have a message for.
 */

describe('AppError', () => {
  it('carries the code, field and details', () => {
    const error = new AppError('VALIDATION_FAILED', 'Check the fields.', { field: 'phone' })
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.field).toBe('phone')
    expect(isAppError(error)).toBe(true)
    expect(isAppError(new Error('plain'))).toBe(false)
  })
})

describe('constraint violations become messages a salesperson can act on', () => {
  it.each([
    ['won_requires_value', 'Enter the confirmed order value before marking this won.'],
    ['lost_requires_reason', 'Choose a reason before marking this lost.'],
    ['account_reachable', 'Add a phone number or an email for this customer.'],
    ['contact_reachable', 'Add a phone number or an email for this contact.'],
    ['nurture_needs_date', 'Set the date to revisit this before moving it to Nurture.'],
    ['one_primary_per_project', 'This site already has a primary contact. Change that one first.'],
  ])('%s', (constraint, message) => {
    const error = fromPostgrestError({
      code: '23514',
      message: `new row for relation "opportunities" violates check constraint "${constraint}"`,
    })
    expect(error.code).toBe('CONSTRAINT_VIOLATION')
    expect(error.message).toBe(message)
  })

  it('names the field so a form can highlight it', () => {
    const error = fromPostgrestError({
      code: '23514',
      message: 'violates check constraint "quoted_requires_quotation"',
    })
    expect(error.field).toBe('quotation_ref')
  })

  it('falls back to a plain message for an unmapped constraint, leaking nothing', () => {
    const error = fromPostgrestError({
      code: '23514',
      message: 'new row for relation "opportunities" violates check constraint "some_new_rule"',
    })
    expect(error.code).toBe('CONSTRAINT_VIOLATION')
    expect(error.message).toBe('That change is not allowed by a business rule.')
    expect(error.message).not.toContain('some_new_rule')
    expect(error.message).not.toContain('relation')
  })
})

describe('postgres error codes', () => {
  it.each([
    ['23505', 'CONFLICT'],
    ['23503', 'CONFLICT'],
    ['23502', 'VALIDATION_FAILED'],
    ['42501', 'FORBIDDEN'],
    ['PGRST116', 'NOT_FOUND'],
    ['XX000', 'INTERNAL'],
  ])('%s maps to %s', (code, expected) => {
    expect(fromPostgrestError({ code, message: 'raw database wording' }).code).toBe(expected)
  })

  it('never surfaces the database wording for an unknown failure', () => {
    const error = fromPostgrestError({
      code: 'XX000',
      message: 'relation "public.opportunities" does not exist at character 15',
    })
    expect(error.message).toBe('Something went wrong. Try again.')
    expect(error.message).not.toContain('opportunities')
  })

  it('maps a unique violation on users.email to a specific message', () => {
    const error = fromPostgrestError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "users_email_key"',
    })
    expect(error.message).toBe('A user with this email already exists.')
    expect(error.field).toBe('email')
  })
})

describe('invisible and forbidden read the same', () => {
  it('says the same thing for a missing row and a hidden one', () => {
    // Distinguishing them lets an attacker probe for existence (§25, M-03).
    expect(notFound('customer').message).toBe(
      'That customer no longer exists, or you cannot see it.',
    )
    expect(fromPostgrestError({ code: 'PGRST116' }).message).toBe(
      'That record no longer exists, or you cannot see it.',
    )
  })

  it('has a plain forbidden message', () => {
    expect(forbidden().code).toBe('FORBIDDEN')
  })
})
