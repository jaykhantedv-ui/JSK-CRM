/**
 * Money (§8.11, §17.3, CLAUDE.md §9).
 *
 * **Money is `bigint` paise in the database. Never float. Never rupees.**
 * Rupee conversion happens ONLY here, at the UI and CSV boundaries.
 *
 * `number` in TypeScript is exact to 2^53, which is ₹90,000 crore in paise —
 * comfortably beyond anything this business will quote. The risk is not overflow,
 * it is a stray `parseFloat` turning ₹1,20,000.50 into a rounding error that
 * compounds through a pipeline total. **Never `parseFloat` a rupee string.**
 */

export const PAISE_PER_RUPEE = 100

/**
 * Read a money column returned by Supabase.
 *
 * PostgREST may serialise `bigint` as a JSON number or as a string depending on
 * the column and the client, so both are handled deliberately rather than
 * coerced. A value that is not an exact integer count of paise is a bug in the
 * caller's query, not something to round away silently.
 */
export function paiseFromDb(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new TypeError(`Money must be whole paise, received ${value}`)
    return value
  }
  const trimmed = value.trim()
  if (!/^-?\d+$/.test(trimmed)) throw new TypeError(`Money must be whole paise, received "${value}"`)
  return Number(trimmed)
}

/**
 * Parse a rupee amount typed by a person, or read from a CSV, into paise.
 *
 * Accepts `4,20,000`, `₹4,20,000`, `420000.50` and `  420000  `. Returns null for
 * empty input so a form can distinguish "not filled in" from zero. Throws on
 * anything else rather than guessing — a silently mis-parsed price is worse than
 * a rejected one.
 */
export function rupeesToPaise(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new TypeError(`Not a rupee amount: ${input}`)
    return Math.round(input * PAISE_PER_RUPEE)
  }

  const cleaned = input.replace(/[₹,\s]/g, '')
  if (cleaned === '') return null
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) throw new TypeError(`Not a rupee amount: "${input}"`)

  // Integer arithmetic on the two halves, so no float ever touches the value.
  const negative = cleaned.startsWith('-')
  const [whole, fraction = ''] = cleaned.replace('-', '').split('.')
  const paise = Number(whole) * PAISE_PER_RUPEE + Number(fraction.padEnd(2, '0'))
  return negative ? -paise : paise
}

/** Paise to a rupee number. For display and CSV export only — never for storage. */
export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE
}

/**
 * Indian-grouped currency: `₹4,20,000`. Paise are dropped by default, because a
 * pipeline figure in rupees and paise is noise on a phone screen.
 */
export function formatPaise(paise: number, options?: { showPaise?: boolean }): string {
  const showPaise = options?.showPaise ?? false
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showPaise ? 2 : 0,
    maximumFractionDigits: showPaise ? 2 : 0,
  }).format(paiseToRupees(paise))
}

/**
 * Compact Indian phrasing for tiles where the exact figure is not the point:
 * `₹1.2 Cr`, `₹4.5 L`, `₹4,200`.
 */
export function formatPaiseCompact(paise: number): string {
  const rupees = paiseToRupees(paise)
  const abs = Math.abs(rupees)
  const sign = rupees < 0 ? '-' : ''
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(abs >= 100_000_000 ? 0 : 1)} Cr`
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(abs >= 10_000_000 ? 0 : 1)} L`
  return formatPaise(paise)
}

/**
 * Weighted pipeline value (§13.1). The probability comes from
 * `system_settings.stage_probabilities` and is passed in — it is never a constant
 * in application code (CLAUDE.md §3).
 */
export function weightedPaise(estimatedPaise: number, probabilityPercent: number): number {
  return Math.round((estimatedPaise * probabilityPercent) / 100)
}
