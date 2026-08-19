/**
 * The error contract (§16.2).
 *
 * Services throw `AppError`. **A raw Postgres error must never reach the UI** —
 * `fromPostgrestError` maps database failures onto the contract, and check
 * constraints get a message written for a salesperson holding a phone, not for a
 * developer reading a stack trace.
 */

export type AppErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_TRANSITION'
  | 'DUPLICATE_WARNING'
  | 'CONSTRAINT_VIOLATION'
  | 'CONFLICT'
  | 'INTERNAL'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly field?: string
  readonly details?: unknown

  constructor(code: AppErrorCode, message: string, options?: { field?: string; details?: unknown }) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.field = options?.field
    this.details = options?.details
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * Constraint name → the message the user sees.
 *
 * Every database constraint that a user action can trip needs an entry. A missing
 * entry is not a crash — `fromPostgrestError` falls back to a generic message —
 * but it is a defect, because the generic message tells the user nothing about
 * what to fix.
 */
const CONSTRAINT_MESSAGES: Record<string, { message: string; field?: string }> = {
  // opportunities (§5.7, ADR-006)
  won_requires_value: {
    message: 'Enter the confirmed order value before marking this won.',
    field: 'final_order_value',
  },
  won_requires_closed: { message: 'A won opportunity needs a close date.', field: 'closed_at' },
  lost_requires_reason: { message: 'Choose a reason before marking this lost.', field: 'lost_reason' },
  lost_requires_closed: { message: 'A lost opportunity needs a close date.', field: 'closed_at' },
  quoted_requires_quotation: {
    message: 'Add the quotation reference, date and quoted value before moving to Quoted.',
    field: 'quotation_ref',
  },
  next_action_pairing: {
    message: 'A next action needs both a type and a date — or neither.',
    field: 'next_action_date',
  },
  nurture_needs_date: {
    message: 'Set the date to revisit this before moving it to Nurture.',
    field: 'next_action_date',
  },
  // accounts and contacts (§5.4, ADR-013)
  account_reachable: { message: 'Add a phone number or an email for this customer.', field: 'phone' },
  contact_reachable: { message: 'Add a phone number or an email for this contact.', field: 'phone' },
  // project stakeholders (§5.6)
  stakeholder_target: { message: 'Choose a person or a company for this stakeholder.' },
  one_primary_per_project: {
    message: 'This site already has a primary contact. Change that one first.',
    field: 'is_primary',
  },
  // users and outlets (§5.2, ADR-016)
  users_email_key: { message: 'A user with this email already exists.', field: 'email' },
  outlets_code_key: { message: 'An outlet with this code already exists.', field: 'code' },
  user_outlets_current_unique: { message: 'This user is already assigned to that outlet.', field: 'outlet_id' },
}

/** The shape `@supabase/supabase-js` returns in `{ error }`. */
export type PostgrestLikeError = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

/** `violates check constraint "won_requires_value"` → `won_requires_value` */
function constraintNameFrom(error: PostgrestLikeError): string | undefined {
  const haystack = `${error.message ?? ''} ${error.details ?? ''}`
  return /constraint "([^"]+)"/.exec(haystack)?.[1]
}

export function fromPostgrestError(error: PostgrestLikeError): AppError {
  const constraint = constraintNameFrom(error)
  const known = constraint ? CONSTRAINT_MESSAGES[constraint] : undefined
  if (known) {
    return new AppError('CONSTRAINT_VIOLATION', known.message, {
      field: known.field,
      details: { constraint },
    })
  }

  switch (error.code) {
    case '23514': // check_violation
      return new AppError('CONSTRAINT_VIOLATION', 'That change is not allowed by a business rule.', {
        details: { constraint },
      })
    case '23505': // unique_violation
      return new AppError('CONFLICT', 'A record with these details already exists.', {
        details: { constraint },
      })
    case '23503': // foreign_key_violation
      return new AppError('CONFLICT', 'A linked record is missing or still in use.', {
        details: { constraint },
      })
    case '23502': // not_null_violation
      return new AppError('VALIDATION_FAILED', 'A required field is missing.', { details: { constraint } })
    case '42501': // insufficient_privilege — including the guard triggers in 015
      return new AppError('FORBIDDEN', error.message ?? 'You do not have permission to do that.')
    case 'PGRST116': // no rows where exactly one was expected
      return new AppError('NOT_FOUND', 'That record no longer exists, or you cannot see it.')
    default:
      // Never surface the database's own words: they leak schema detail and mean
      // nothing to the person reading them.
      return new AppError('INTERNAL', 'Something went wrong. Try again.', {
        details: { code: error.code },
      })
  }
}

/**
 * Row-level security answers "invisible" and "forbidden" identically: the row is
 * simply not there. §25 and M-03 require the UI to say the same thing in both
 * cases, so an attacker cannot probe for existence.
 */
export function notFound(what = 'record'): AppError {
  return new AppError('NOT_FOUND', `That ${what} no longer exists, or you cannot see it.`)
}

export function forbidden(message = 'You do not have permission to do that.'): AppError {
  return new AppError('FORBIDDEN', message)
}
