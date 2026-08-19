import { z } from 'zod'

/**
 * Shared validation primitives (§15.8).
 *
 * **Every mutation is validated server-side with Zod regardless of what the
 * client did.** These are the pieces more than one schema needs; a schema used by
 * exactly one service belongs next to that service, not here.
 */

export const uuidSchema = z.uuid({ error: 'Not a valid id.' })

export const emailSchema = z
  .string()
  .trim()
  .min(1, { error: 'Email is required.' })
  .max(320)
  .email({ error: 'Enter a valid email address.' })
  .transform((value) => value.toLowerCase())

/**
 * An Indian mobile number, validated the way `normalize_phone()` normalises it:
 * at least ten digits once punctuation is removed. Deliberately permissive about
 * formatting — a salesperson typing `+91 98430 12345` on a phone must not be
 * stopped by a space.
 */
export const phoneSchema = z
  .string()
  .trim()
  .refine((value) => value.replace(/\D/g, '').length >= 10, {
    error: 'Enter at least ten digits.',
  })

export const optionalPhoneSchema = z
  .union([phoneSchema, z.literal('')])
  .optional()
  .transform((value) => (value ? value : null))

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, { error: 'Enter at least two characters.' })
  .max(120)

export const roleSchema = z.enum(['SALESPERSON', 'MANAGER', 'OWNER', 'ADMIN'])

/**
 * A money amount typed in rupees. The transform to paise lives in `lib/money.ts`;
 * this only proves the text is a rupee amount, so the error message can be about
 * the input rather than about a parse failure downstream.
 */
export const rupeeStringSchema = z
  .string()
  .trim()
  .refine((value) => /^₹?\s*-?[\d,]+(\.\d{1,2})?$/.test(value), {
    error: 'Enter an amount in rupees.',
  })

/** `yyyy-MM-dd`, the wire format for every date the application sends. */
export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Enter a date.' })

/**
 * Turn a `ZodError` into the field-keyed shape a form needs, so a Server Action
 * can return it without every action reinventing the mapping.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    result[key] ??= issue.message
  }
  return result
}
