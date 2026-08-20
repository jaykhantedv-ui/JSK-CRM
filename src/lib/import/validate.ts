import { normalizePhone } from '@/lib/phone'

import { templateColumnsFor, type ImportEntity } from './templates'

/**
 * Import validation (§20.3).
 *
 * **Pure.** Nothing here touches a database. Everything it needs to know about
 * the world — which owner emails are real, which outlet codes exist, which
 * accounts a contact could attach to, which cities are configured — arrives as a
 * `ValidationContext` that the service assembles. That is what makes every rule
 * in §20.3 directly unit-testable, including the ones about existing data.
 *
 * The tolerance rule is deliberate and one-directional: **enum parsing forgives
 * case, spaces, hyphens and underscores; nothing else forgives anything.** A
 * business typing `interior designer` in a spreadsheet means
 * `INTERIOR_DESIGNER` and it would be obtuse to reject it. A missing phone
 * number is not a formatting question.
 */

/** §20.3's outcomes, mapped onto `import_row_status`. */
export type RowStatus = 'VALID' | 'WARNING' | 'ERROR'

export type RowMessage = {
  level: 'ERROR' | 'WARNING'
  field?: string
  message: string
}

export type ExistingAccount = {
  id: string
  name: string
  phoneNormalized: string | null
  emailNormalized: string | null
  ownerId: string
  outletId: string
}

export type ExistingContact = {
  id: string
  fullName: string
  phoneNormalized: string | null
  emailNormalized: string | null
}

export type ValidationContext = {
  /** Active users, keyed by lower-cased email (§20.3: "does not match an active user"). */
  usersByEmail: Map<string, { id: string; outletId: string | null }>
  /** Outlets keyed by upper-cased code. */
  outletsByCode: Map<string, string>
  /** `system_settings.cities` — an unknown city is a WARNING, never an ERROR. */
  cities: readonly string[]
  /** Existing accounts, for duplicate analysis and for `account_phone` resolution. */
  existingAccounts: readonly ExistingAccount[]
  existingContacts: readonly ExistingContact[]
  /** Fallback owner when a contact names none: the person running the import. */
  fallbackOwnerId: string
  fallbackOutletId: string | null
}

export type ValidatedRow = {
  rowNumber: number
  raw: Record<string, string>
  status: RowStatus
  messages: RowMessage[]
  normalized: Record<string, unknown> | null
  /** Set when this row matches something already in the database. */
  duplicateOf?: string
  duplicateConfidence?: 'EXACT' | 'POSSIBLE'
}

/**
 * Case, space, hyphen and underscore tolerant enum matching (§20.3).
 *
 * `Interior Designer`, `interior-designer`, `INTERIOR_DESIGNER` and
 * `interiordesigner` all resolve. Anything else returns null and the caller
 * reports the valid values, because "invalid value" without the list is an error
 * message that cannot be acted on.
 */
export function parseEnumValue<T extends string>(
  raw: string | undefined | null,
  allowed: readonly T[],
): T | null {
  if (!raw) return null
  const canonical = raw.trim().toLowerCase().replace(/[\s_-]+/g, '')
  return allowed.find((value) => value.toLowerCase().replace(/[\s_-]+/g, '') === canonical) ?? null
}

const ACCOUNT_TYPES = [
  'HOMEOWNER', 'CONTRACTOR', 'BUILDER', 'ARCHITECT', 'INTERIOR_DESIGNER',
  'DEALER', 'COMMERCIAL', 'MASON', 'OTHER',
] as const

const ACCOUNT_STATUSES = ['PROSPECT', 'ACTIVE', 'DORMANT', 'DO_NOT_CONTACT'] as const

const LEAD_SOURCES = [
  'WALK_IN', 'PHONE_ENQUIRY', 'CUSTOMER_REFERRAL', 'ARCHITECT_REFERRAL',
  'CONTRACTOR_REFERRAL', 'SIGNAGE', 'SOCIAL_MEDIA', 'EXHIBITION', 'EXISTING_CUSTOMER', 'OTHER',
] as const

const STAKEHOLDER_ROLES = [
  'OWNER_BUYER', 'SPOUSE_FAMILY', 'ARCHITECT', 'INTERIOR_DESIGNER', 'CONTRACTOR',
  'BUILDER', 'SITE_ENGINEER', 'MASON', 'PURCHASE_MANAGER', 'DEALER', 'OTHER',
] as const

const INFLUENCE_LEVELS = [
  'DECISION_MAKER', 'STRONG_INFLUENCER', 'INFLUENCER', 'EXECUTOR', 'INFORMATION_ONLY',
] as const

/** `yes`, `y`, `true`, `1` — and their negatives. Anything else is an error. */
function parseBoolean(raw: string | undefined): boolean | null {
  if (!raw) return null
  const value = raw.trim().toLowerCase()
  if (['yes', 'y', 'true', '1'].includes(value)) return true
  if (['no', 'n', 'false', '0'].includes(value)) return false
  return null
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * §20.3: "Phone does not normalise to 10 digits starting 6–9".
 *
 * `normalizePhone` is the shared normaliser — the same logic the database's
 * generated column uses — and this adds the Indian mobile prefix rule on top.
 */
function validatePhone(raw: string | null): { normalized: string | null; error: string | null } {
  if (!raw) return { normalized: null, error: null }
  const normalized = normalizePhone(raw)
  if (!normalized) return { normalized: null, error: 'Phone number needs at least ten digits.' }
  if (!/^[6-9]/.test(normalized)) {
    return { normalized: null, error: 'An Indian mobile number starts with 6, 7, 8 or 9.' }
  }
  return { normalized, error: null }
}

/** Which columns of the template are missing from the uploaded file. */
export function missingRequiredColumns(entity: ImportEntity, headers: readonly string[]): string[] {
  return templateColumnsFor(entity)
    .filter((column) => column.required && !headers.includes(column.name))
    .map((column) => column.name)
}

type RowAccumulator = {
  messages: RowMessage[]
  error: (message: string, field?: string) => void
  warn: (message: string, field?: string) => void
}

function accumulator(): RowAccumulator {
  const messages: RowMessage[] = []
  return {
    messages,
    error: (message, field) => messages.push({ level: 'ERROR', field, message }),
    warn: (message, field) => messages.push({ level: 'WARNING', field, message }),
  }
}

function statusFrom(messages: readonly RowMessage[]): RowStatus {
  if (messages.some((message) => message.level === 'ERROR')) return 'ERROR'
  if (messages.length > 0) return 'WARNING'
  return 'VALID'
}

/** One account row against §20.3. */
function validateAccountRow(
  raw: Record<string, string>,
  rowNumber: number,
  context: ValidationContext,
): ValidatedRow {
  const acc = accumulator()

  const name = blankToNull(raw.name)
  if (!name) acc.error('Name is required.', 'name')
  else if (name.length < 2) acc.error('Name needs at least two characters.', 'name')

  const accountType = parseEnumValue(raw.account_type, ACCOUNT_TYPES)
  if (!raw.account_type?.trim()) {
    acc.error('Customer type is required.', 'account_type')
  } else if (!accountType) {
    acc.error(`Not a valid customer type. Use one of: ${ACCOUNT_TYPES.join(', ')}.`, 'account_type')
  }

  const phoneInput = blankToNull(raw.phone)
  const phone = validatePhone(phoneInput)
  if (phone.error) acc.error(phone.error, 'phone')

  const email = blankToNull(raw.email)?.toLowerCase() ?? null
  if (email && !EMAIL_PATTERN.test(email)) acc.error('Not a valid email address.', 'email')

  // ADR-013's `account_reachable`, checked here so the reviewer sees it as a row
  // message rather than as a constraint violation at execution time.
  if (!phone.normalized && !email) {
    acc.error('Every customer needs a phone number or an email.', 'phone')
  }

  const ownerEmail = blankToNull(raw.owner_email)?.toLowerCase() ?? null
  const owner = ownerEmail ? context.usersByEmail.get(ownerEmail) : undefined
  if (!ownerEmail) acc.error('Owner email is required.', 'owner_email')
  else if (!owner) acc.error('No active user has that email address.', 'owner_email')

  const outletCode = blankToNull(raw.outlet_code)?.toUpperCase() ?? null
  let outletId: string | null = null
  if (outletCode) {
    outletId = context.outletsByCode.get(outletCode) ?? null
    if (!outletId) acc.error('No outlet has that code.', 'outlet_code')
  } else {
    outletId = owner?.outletId ?? context.fallbackOutletId
    if (!outletId && owner) {
      acc.error('This owner is not posted to an outlet. Add an outlet_code column.', 'outlet_code')
    }
  }

  const status = raw.status?.trim() ? parseEnumValue(raw.status, ACCOUNT_STATUSES) : 'PROSPECT'
  if (!status) {
    acc.error(`Not a valid status. Use one of: ${ACCOUNT_STATUSES.join(', ')}.`, 'status')
  }

  // Historical records have no meaningful lead source, so OTHER rather than
  // §5.3's WALK_IN default: recording every paper-register customer as a walk-in
  // would put invented data into the source report.
  const source = raw.source?.trim() ? parseEnumValue(raw.source, LEAD_SOURCES) : 'OTHER'
  if (!source) {
    acc.error(`Not a valid source. Use one of: ${LEAD_SOURCES.join(', ')}.`, 'source')
  }

  const city = blankToNull(raw.city)
  // §20.3: an unknown city is a WARNING. It imports, flagged for normalisation —
  // refusing it would strand a real customer over a spelling.
  if (city && !context.cities.some((known) => known.toLowerCase() === city.toLowerCase())) {
    acc.warn('Not one of the configured taluks. Imported as typed.', 'city')
  }

  const messages = acc.messages
  const status_ = statusFrom(messages)

  return {
    rowNumber,
    raw,
    status: status_,
    messages,
    normalized:
      status_ === 'ERROR'
        ? null
        : {
            name,
            account_type: accountType,
            phone: phoneInput,
            email,
            address: blankToNull(raw.address),
            city,
            area: blankToNull(raw.area),
            source,
            notes: blankToNull(raw.notes),
            status,
            owner_id: owner?.id ?? null,
            outlet_id: outletId,
            legacy_ref: blankToNull(raw.legacy_ref),
          },
  }
}

/** One contact row against §20.3. */
function validateContactRow(
  raw: Record<string, string>,
  rowNumber: number,
  context: ValidationContext,
): ValidatedRow {
  const acc = accumulator()

  const fullName = blankToNull(raw.full_name)
  if (!fullName) acc.error('Name is required.', 'full_name')

  const phoneInput = blankToNull(raw.phone)
  const phone = validatePhone(phoneInput)
  if (phone.error) acc.error(phone.error, 'phone')

  const email = blankToNull(raw.email)?.toLowerCase() ?? null
  if (email && !EMAIL_PATTERN.test(email)) acc.error('Not a valid email address.', 'email')

  if (!phone.normalized && !email) {
    acc.error('Every contact needs a phone number or an email.', 'phone')
  }

  // §20.3: "`account_phone` does not resolve" is an ERROR. A contact whose
  // customer cannot be found would import as an orphan, which is worse than not
  // importing at all.
  const accountPhoneRaw = blankToNull(raw.account_phone)
  let account: ExistingAccount | undefined
  if (accountPhoneRaw) {
    const accountPhone = normalizePhone(accountPhoneRaw)
    account = accountPhone
      ? context.existingAccounts.find((candidate) => candidate.phoneNormalized === accountPhone)
      : undefined
    if (!account) acc.error('No existing customer has that phone number.', 'account_phone')
  }

  const role = raw.role?.trim() ? parseEnumValue(raw.role, STAKEHOLDER_ROLES) : 'OTHER'
  if (!role) acc.error(`Not a valid role. Use one of: ${STAKEHOLDER_ROLES.join(', ')}.`, 'role')

  const influence = raw.influence?.trim()
    ? parseEnumValue(raw.influence, INFLUENCE_LEVELS)
    : 'INFLUENCER'
  if (!influence) {
    acc.error(`Not a valid influence level. Use one of: ${INFLUENCE_LEVELS.join(', ')}.`, 'influence')
  }

  let isReferralSource: boolean | null = false
  if (raw.is_referral_source?.trim()) {
    isReferralSource = parseBoolean(raw.is_referral_source)
    if (isReferralSource === null) acc.error('Use yes or no.', 'is_referral_source')
  }

  const ownerEmail = blankToNull(raw.owner_email)?.toLowerCase() ?? null
  let ownerId: string | null = null
  if (ownerEmail) {
    const owner = context.usersByEmail.get(ownerEmail)
    if (!owner) acc.error('No active user has that email address.', 'owner_email')
    else ownerId = owner.id
  } else {
    // The linked customer's owner, else whoever is running the import. Never an
    // invented user (CLAUDE.md §15).
    ownerId = account?.ownerId ?? context.fallbackOwnerId
  }

  const messages = acc.messages
  const status = statusFrom(messages)

  return {
    rowNumber,
    raw,
    status,
    messages,
    normalized:
      status === 'ERROR'
        ? null
        : {
            full_name: fullName,
            phone: phoneInput,
            email,
            account_id: account?.id ?? null,
            role,
            influence,
            is_referral_source: isReferralSource,
            notes: blankToNull(raw.notes),
            owner_id: ownerId,
            legacy_ref: blankToNull(raw.legacy_ref),
          },
  }
}

/**
 * §20.3: "Duplicate phone/email **within the file** — ERROR, deduplicate the file
 * first."
 *
 * Deliberately harsher than a duplicate against existing data, which gets a
 * review decision. Two rows in one file claiming the same phone number is a
 * defect in the file, and no per-row decision can sensibly resolve it: importing
 * both creates the duplicate, and the reviewer has no way to tell which row is
 * the good one. ALL rows sharing the value are flagged, not just the second one —
 * marking only the later one would imply the first is fine.
 */
function flagInFileDuplicates(rows: ValidatedRow[]): void {
  const seen = new Map<string, number[]>()

  rows.forEach((row, index) => {
    if (!row.normalized) return
    const phone = normalizePhone(row.normalized.phone as string | null)
    const email = (row.normalized.email as string | null) ?? null

    if (phone) {
      const key = `phone:${phone}`
      seen.set(key, [...(seen.get(key) ?? []), index])
    }
    if (email) {
      const key = `email:${email}`
      seen.set(key, [...(seen.get(key) ?? []), index])
    }
  })

  for (const [key, indexes] of seen) {
    if (indexes.length < 2) continue
    const field = key.startsWith('phone:') ? 'phone' : 'email'
    const lines = indexes.map((index) => rows[index].rowNumber).join(', ')
    for (const index of indexes) {
      rows[index].messages.push({
        level: 'ERROR',
        field,
        message: `The same ${field} appears on rows ${lines}. Remove the duplicates from the file first.`,
      })
      rows[index].status = 'ERROR'
      rows[index].normalized = null
    }
  }
}

/**
 * §20.3's last rule: a row matching an existing record needs a DECISION.
 *
 * Phone or email match → DUPLICATE_EXACT. An exactly equal name →
 * DUPLICATE_POSSIBLE. Name similarity beyond that is not attempted here: the
 * trigram scoring in §8.9 lives in the database, and duplicating a fuzzy-match
 * rule in TypeScript is how two definitions of "similar" come to disagree
 * (CLAUDE.md §8). An exact name match needs no fuzziness to be worth a look.
 */
function flagExistingDuplicates(rows: ValidatedRow[], entity: ImportEntity, context: ValidationContext): void {
  for (const row of rows) {
    if (!row.normalized) continue

    const phone = normalizePhone(row.normalized.phone as string | null)
    const email = (row.normalized.email as string | null) ?? null
    const name = ((entity === 'accounts' ? row.normalized.name : row.normalized.full_name) ??
      '') as string

    if (entity === 'accounts') {
      const exact = context.existingAccounts.find(
        (candidate) =>
          (phone && candidate.phoneNormalized === phone) ||
          (email && candidate.emailNormalized === email),
      )
      if (exact) {
        row.duplicateOf = exact.id
        row.duplicateConfidence = 'EXACT'
        continue
      }
      const byName = context.existingAccounts.find(
        (candidate) => candidate.name.trim().toLowerCase() === name.trim().toLowerCase(),
      )
      if (byName) {
        row.duplicateOf = byName.id
        row.duplicateConfidence = 'POSSIBLE'
      }
      continue
    }

    const exact = context.existingContacts.find(
      (candidate) =>
        (phone && candidate.phoneNormalized === phone) ||
        (email && candidate.emailNormalized === email),
    )
    if (exact) {
      row.duplicateOf = exact.id
      row.duplicateConfidence = 'EXACT'
      continue
    }
    const byName = context.existingContacts.find(
      (candidate) => candidate.fullName.trim().toLowerCase() === name.trim().toLowerCase(),
    )
    if (byName) {
      row.duplicateOf = byName.id
      row.duplicateConfidence = 'POSSIBLE'
    }
  }
}

export type ValidationResult = {
  rows: ValidatedRow[]
  counts: { total: number; valid: number; warning: number; error: number; duplicate: number }
}

/** Validate every row of a parsed file. The whole of §20.3, in order. */
export function validateRows(
  entity: ImportEntity,
  rawRows: readonly Record<string, string>[],
  context: ValidationContext,
): ValidationResult {
  const rows = rawRows.map((raw, index) =>
    entity === 'accounts'
      ? validateAccountRow(raw, index + 1, context)
      : validateContactRow(raw, index + 1, context),
  )

  // In-file duplicates first: a row that is an in-file duplicate is an ERROR and
  // must not then also be offered as a reviewable duplicate of existing data.
  flagInFileDuplicates(rows)
  flagExistingDuplicates(rows, entity, context)

  return {
    rows,
    counts: {
      total: rows.length,
      valid: rows.filter((row) => row.status === 'VALID' && !row.duplicateOf).length,
      warning: rows.filter((row) => row.status === 'WARNING' && !row.duplicateOf).length,
      error: rows.filter((row) => row.status === 'ERROR').length,
      duplicate: rows.filter((row) => row.duplicateOf && row.status !== 'ERROR').length,
    },
  }
}

/** The `import_row_status` a validated row is stored as. */
export function storedStatusFor(row: ValidatedRow): string {
  if (row.status === 'ERROR') return 'ERROR'
  if (row.duplicateConfidence === 'EXACT') return 'DUPLICATE_EXACT'
  if (row.duplicateConfidence === 'POSSIBLE') return 'DUPLICATE_POSSIBLE'
  return row.status
}

/** §20.4: rows awaiting a decision block execution. */
export function rowsNeedingDecision(
  rows: readonly { status: string; decision: string | null }[],
): number {
  return rows.filter(
    (row) =>
      (row.status === 'DUPLICATE_EXACT' || row.status === 'DUPLICATE_POSSIBLE') &&
      row.decision === null,
  ).length
}
