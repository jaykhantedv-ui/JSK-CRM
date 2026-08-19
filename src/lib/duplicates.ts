/**
 * Duplicate confidence scoring (§8.9).
 *
 * **Advisory. Never merges automatically. Never blocks creation outright.**
 * The service asks the database which accounts look similar and this module
 * decides how loudly to say so. The two similarity thresholds are defined HERE,
 * once, and passed into `find_account_duplicates()` — the SQL function takes them
 * as parameters precisely so the numbers are not written down twice.
 *
 * These are §8.9's stated values, not a `TODO-BD` decision, so they are constants
 * rather than `system_settings` keys (CLAUDE.md §3 governs the twelve business
 * decisions; this is not one of them). If the business ever wants to tune them,
 * that is a new settings key and a `/docs/DECISIONS.md` entry.
 */

/** `similarity(name) >= 0.6` **and** the same city (§8.9). */
export const NAME_CITY_SIMILARITY_THRESHOLD = 0.6

/** `similarity(name) >= 0.8` with no city match (§8.9). */
export const NAME_ONLY_SIMILARITY_THRESHOLD = 0.8

/** What the database matched on. Mirrors `find_account_duplicates.signal`. */
export type DuplicateSignal = 'PHONE' | 'EMAIL' | 'NAME_CITY' | 'NAME'

export type DuplicateConfidence = 'EXACT' | 'POSSIBLE' | 'NONE'

export type DuplicateMatch = {
  id: string
  name: string
  accountType: string
  phone: string | null
  email: string | null
  city: string | null
  status: string
  signal: DuplicateSignal
  confidence: DuplicateConfidence
  nameSimilarity: number | null
}

/**
 * Signal → confidence, exactly as §8.9's table reads.
 *
 * A matching phone or email is EXACT and earns a strong warning. A name that
 * merely looks alike is POSSIBLE and earns a review warning that is one click to
 * pass. Nothing here refuses a save.
 */
export function confidenceFor(signal: DuplicateSignal): DuplicateConfidence {
  switch (signal) {
    case 'PHONE':
    case 'EMAIL':
      return 'EXACT'
    case 'NAME_CITY':
    case 'NAME':
      return 'POSSIBLE'
  }
}

/** The strongest confidence in a set of matches — what the warning card leads with. */
export function overallConfidence(matches: readonly { confidence: DuplicateConfidence }[]): DuplicateConfidence {
  if (matches.some((match) => match.confidence === 'EXACT')) return 'EXACT'
  if (matches.length > 0) return 'POSSIBLE'
  return 'NONE'
}

/** The sentence shown above the matched records. Never says "blocked". */
export function duplicateWarningTitle(confidence: DuplicateConfidence, count: number): string {
  const record = count === 1 ? 'customer' : 'customers'
  switch (confidence) {
    case 'EXACT':
      return `${count} existing ${record} with the same phone or email`
    case 'POSSIBLE':
      return `${count} existing ${record} with a similar name`
    case 'NONE':
      return 'No similar customers'
  }
}

/** Why this row was flagged, in words a salesperson reads without training. */
export function signalLabel(signal: DuplicateSignal): string {
  switch (signal) {
    case 'PHONE':
      return 'Same phone number'
    case 'EMAIL':
      return 'Same email'
    case 'NAME_CITY':
      return 'Similar name, same city'
    case 'NAME':
      return 'Similar name'
  }
}
