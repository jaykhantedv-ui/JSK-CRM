/**
 * File validation for uploads (§15.6, M-14).
 *
 * **THE EXTENSION IS NOT EVIDENCE AND NEITHER IS THE CLIENT'S MIME TYPE.** Both
 * are chosen by whoever is uploading. `payload.exe` renamed to `photo.jpg`, sent
 * with `Content-Type: image/jpeg`, passes every check that trusts what it was
 * told. So the file's own first bytes decide what it is, and everything else is
 * treated as a hint.
 *
 * M-14 closed this without adding a dependency: `file-type` is **not installed**,
 * and this is the hand-rolled signature check for the four types §15.6 allows.
 * Four formats is a small enough surface to read in one screen and verify by eye,
 * which is worth more here than a general-purpose detector.
 */

/** §15.6. Adding to this list is a specification change, not a code change. */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

/** §15.6: 10 MB. Also declared on the bucket in migration 024 as a backstop. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024

/** §20.1: 5 MB and 5,000 rows for an import file. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_ROWS = 5000

export const EXTENSION_FOR_MIME: Record<AllowedMimeType, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
}

/**
 * Signature matchers, one per allowed type.
 *
 * WebP is the reason these are predicates rather than a byte-prefix table: its
 * signature is split — `RIFF` at offset 0 and `WEBP` at offset 8, with a
 * four-byte length in between — so a prefix comparison cannot express it, and a
 * check that only looked for `RIFF` would accept a WAV or an AVI just as happily.
 */
const SIGNATURES: ReadonlyArray<{ mime: AllowedMimeType; matches: (bytes: Uint8Array) => boolean }> =
  [
    {
      mime: 'image/jpeg',
      // SOI marker. Every JPEG variant — JFIF, Exif, raw — begins with it.
      matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    },
    {
      mime: 'image/png',
      matches: (b) =>
        b.length >= 8 &&
        b[0] === 0x89 &&
        b[1] === 0x50 &&
        b[2] === 0x4e &&
        b[3] === 0x47 &&
        b[4] === 0x0d &&
        b[5] === 0x0a &&
        b[6] === 0x1a &&
        b[7] === 0x0a,
    },
    {
      mime: 'image/webp',
      matches: (b) =>
        b.length >= 12 &&
        b[0] === 0x52 && // R
        b[1] === 0x49 && // I
        b[2] === 0x46 && // F
        b[3] === 0x46 && // F
        b[8] === 0x57 && // W
        b[9] === 0x45 && // E
        b[10] === 0x42 && // B
        b[11] === 0x50, // P
    },
    {
      mime: 'application/pdf',
      // `%PDF-`. The spec permits leading junk before the header; this does not,
      // deliberately — a "PDF" with 400 bytes of anything in front of it is not a
      // file a salesperson produced from the quotation system.
      matches: (b) =>
        b.length >= 5 &&
        b[0] === 0x25 &&
        b[1] === 0x50 &&
        b[2] === 0x44 &&
        b[3] === 0x46 &&
        b[4] === 0x2d,
    },
  ]

/** How many bytes `detectMimeType` needs. The longest signature is WebP's twelve. */
export const SIGNATURE_BYTES = 12

/** The type these bytes actually are, or null for anything not on the allow-list. */
export function detectMimeType(bytes: Uint8Array): AllowedMimeType | null {
  return SIGNATURES.find((signature) => signature.matches(bytes))?.mime ?? null
}

export type FileRejection = {
  reason: 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'TYPE_MISMATCH'
  message: string
}

export type FileValidation =
  | { ok: true; mimeType: AllowedMimeType }
  | { ok: false; rejection: FileRejection }

/**
 * Validate one upload: size, then true type, then the claim against the truth.
 *
 * The order matters. Size is checked first because it is the cheapest refusal and
 * the one that protects everything after it. The claimed type is checked LAST and
 * only as a consistency test — a `.pdf` whose bytes are a JPEG is refused not
 * because the bytes are wrong but because the two disagree, and a file that lies
 * about itself is not one to store under a name that will be trusted later.
 */
export function validateUpload(input: {
  size: number
  declaredMimeType?: string | null
  fileName?: string | null
  head: Uint8Array
}): FileValidation {
  if (input.size <= 0) {
    return { ok: false, rejection: { reason: 'EMPTY', message: 'That file is empty.' } }
  }

  if (input.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      rejection: {
        reason: 'TOO_LARGE',
        message: `Files must be ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB or smaller.`,
      },
    }
  }

  const actual = detectMimeType(input.head)
  if (!actual) {
    return {
      ok: false,
      rejection: {
        reason: 'UNSUPPORTED_TYPE',
        message: 'Only JPG, PNG, WebP images and PDF files can be attached.',
      },
    }
  }

  const declared = input.declaredMimeType?.trim().toLowerCase()
  if (declared && declared !== (actual as string)) {
    return {
      ok: false,
      rejection: {
        reason: 'TYPE_MISMATCH',
        message: 'That file does not match the type it claims to be.',
      },
    }
  }

  const extension = input.fileName?.split('.').pop()?.toLowerCase()
  if (extension && !EXTENSION_FOR_MIME[actual].includes(extension)) {
    return {
      ok: false,
      rejection: {
        reason: 'TYPE_MISMATCH',
        message: 'That file does not match the type its name claims.',
      },
    }
  }

  return { ok: true, mimeType: actual }
}

/**
 * Make a filename safe to put in a storage path.
 *
 * The stored object name is `{uuid}-{filename}`, so the filename half must not be
 * able to introduce a `/` and climb into another entity's folder — the path
 * prefix is the authorization key (migration 024) and a traversal there would be
 * an authorization bypass, not a cosmetic bug. Everything outside a conservative
 * allow-list becomes `-`.
 */
export function sanitizeFileName(name: string): string {
  const trimmed = name.trim().replace(/^.*[/\\]/, '')
  const cleaned = trimmed.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-{2,}/g, '-')
  const bounded = cleaned.slice(0, 120)
  return bounded.replace(/^[.-]+/, '') || 'file'
}

export type StorageEntityType = 'account' | 'project' | 'opportunity' | 'activity'

export const STORAGE_ENTITY_TYPES: readonly StorageEntityType[] = [
  'account',
  'project',
  'opportunity',
  'activity',
]

/**
 * Build the object path. §15.6 fixes this format exactly:
 *   `{entity_type}/{entity_id}/{uuid}-{filename}`
 *
 * Migration 024's policies parse it back apart, so a change here is a change to
 * the authorization rule and both must move together.
 */
export function buildStoragePath(
  entityType: StorageEntityType,
  entityId: string,
  fileName: string,
  uuid: string,
): string {
  return `${entityType}/${entityId}/${uuid}-${sanitizeFileName(fileName)}`
}

/** The `{entity_type, entity_id}` a path points at, or null if it is malformed. */
export function parseStoragePath(
  path: string,
): { entityType: StorageEntityType; entityId: string } | null {
  const [entityType, entityId, ...rest] = path.split('/')
  if (!entityType || !entityId || rest.length === 0) return null
  if (!STORAGE_ENTITY_TYPES.includes(entityType as StorageEntityType)) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) return null
  return { entityType: entityType as StorageEntityType, entityId }
}

/** The name shown in the UI: the original filename, with the uuid prefix removed. */
export function displayFileName(path: string): string {
  const last = path.split('/').pop() ?? path
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '')
}
