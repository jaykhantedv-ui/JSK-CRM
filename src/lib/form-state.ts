import { AppError, isAppError } from '@/lib/errors'
import { rupeesToPaise } from '@/lib/money'
import { fieldErrors } from '@/lib/validation'
import { z } from 'zod'

/**
 * The shape every Server Action returns to a form.
 *
 * A Server Action does exactly four things (CLAUDE.md §8): authenticate,
 * validate with Zod, call a service, map errors. This is the fourth — one place
 * that turns an `AppError` into something a form can render, so no action invents
 * its own error contract and no component reads a Postgres message (§16.2).
 *
 * **Never lose entered data** (§12.7): the action returns `values` alongside the
 * error, and every form re-renders from them.
 */
export type FormState = {
  ok: boolean
  error: string | null
  fieldErrors: Record<string, string>
  values?: Record<string, string>
  /**
   * The id of the record the action just created.
   *
   * Needed by any flow that continues working on the new record without leaving
   * the screen — a site visit whose photographs upload AFTER the activity is
   * safely committed (§11.5), so a failed upload costs the photo and never the
   * activity.
   */
  createdId?: string
}

export const IDLE_FORM_STATE: FormState = { ok: false, error: null, fieldErrors: {} }

/** Everything the user typed, so a failed submit re-renders instead of clearing. */
export function valuesFrom(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') values[key] = value
  }
  return values
}

export function stateFromError(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof z.ZodError) {
    return { ok: false, error: 'Check the highlighted fields.', fieldErrors: fieldErrors(error), values }
  }

  if (isAppError(error)) {
    return {
      ok: false,
      error: error.message,
      fieldErrors: error.field ? { [error.field]: error.message } : {},
      values,
    }
  }

  // Anything unrecognised is reported in plain language. The detail goes to the
  // server log, never to the screen (§12.6).
  console.error('Unhandled action error', error)
  return { ok: false, error: 'Something went wrong. Try again.', fieldErrors: {}, values }
}

/** Read a required text field, or throw the validation error the form expects. */
export function requireField(formData: FormData, name: string, message: string): string {
  const value = formData.get(name)
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION_FAILED', message, { field: name })
  }
  return value.trim()
}

/**
 * An optional text field. Returns `undefined` rather than `null` for an empty
 * input, because that is what an optional Zod field accepts — and because
 * "not filled in" and "explicitly cleared" are different facts the schemas
 * distinguish.
 */
export function optionalField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * A rupee amount typed by a person, in paise.
 *
 * Conversion happens here and in `lib/money.ts` only — never `parseFloat` on a
 * rupee string anywhere else (CLAUDE.md §9).
 */
export function moneyField(formData: FormData, name: string, message: string): number {
  const raw = optionalField(formData, name)
  if (raw === undefined) throw new AppError('VALIDATION_FAILED', message, { field: name })
  try {
    const paise = rupeesToPaise(raw)
    if (paise === null) throw new AppError('VALIDATION_FAILED', message, { field: name })
    return paise
  } catch (error) {
    if (isAppError(error)) throw error
    throw new AppError('VALIDATION_FAILED', 'Enter an amount in rupees.', { field: name })
  }
}
