import { describe, expect, it } from 'vitest'

import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  buildStoragePath,
  detectMimeType,
  displayFileName,
  parseStoragePath,
  sanitizeFileName,
  validateUpload,
} from '@/lib/files'

/**
 * File validation (§15.6, M-14).
 *
 * **The disguised executable is the test that matters.** §19.4 names it
 * explicitly: a file renamed `.jpg` and sent with `Content-Type: image/jpeg`
 * must be refused on its BYTES. Every other case here exists to prove the check
 * is a signature check and not an extension check wearing a hat.
 */

const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
const png = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const webp = () =>
  Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])
const pdf = () => Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 0, 0, 0])
/** `MZ` — a Windows executable. */
const exe = () => Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 3, 0, 0, 0, 4, 0, 0, 0])
/** A RIFF container that is NOT a WebP — a WAV file. */
const wav = () =>
  Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])

describe('detectMimeType', () => {
  it('recognises each of the four allowed types', () => {
    expect(detectMimeType(jpeg())).toBe('image/jpeg')
    expect(detectMimeType(png())).toBe('image/png')
    expect(detectMimeType(webp())).toBe('image/webp')
    expect(detectMimeType(pdf())).toBe('application/pdf')
  })

  it('refuses an executable', () => {
    expect(detectMimeType(exe())).toBeNull()
  })

  it('refuses a RIFF container that is not a WebP', () => {
    // A prefix check on `RIFF` alone would accept this.
    expect(detectMimeType(wav())).toBeNull()
  })

  it('refuses an empty or truncated head', () => {
    expect(detectMimeType(new Uint8Array())).toBeNull()
    expect(detectMimeType(Uint8Array.from([0xff, 0xd8]))).toBeNull()
  })

  it('allows exactly the four types §15.6 lists and no others', () => {
    expect([...ALLOWED_MIME_TYPES]).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ])
  })
})

describe('validateUpload', () => {
  it('accepts a real JPEG named .jpg', () => {
    const result = validateUpload({
      size: 1024,
      declaredMimeType: 'image/jpeg',
      fileName: 'site.jpg',
      head: jpeg(),
    })
    expect(result).toEqual({ ok: true, mimeType: 'image/jpeg' })
  })

  it('REFUSES an executable disguised as a JPEG (§19.4)', () => {
    const result = validateUpload({
      size: 4096,
      declaredMimeType: 'image/jpeg',
      fileName: 'holiday.jpg',
      head: exe(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.reason).toBe('UNSUPPORTED_TYPE')
  })

  it('refuses a real PNG whose name claims it is a PDF', () => {
    const result = validateUpload({
      size: 2048,
      declaredMimeType: null,
      fileName: 'quotation.pdf',
      head: png(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.reason).toBe('TYPE_MISMATCH')
  })

  it('refuses a real PDF whose declared type says image', () => {
    const result = validateUpload({
      size: 2048,
      declaredMimeType: 'image/png',
      fileName: 'quotation.pdf',
      head: pdf(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.reason).toBe('TYPE_MISMATCH')
  })

  it('refuses anything over 10 MB', () => {
    const result = validateUpload({
      size: MAX_FILE_BYTES + 1,
      declaredMimeType: 'application/pdf',
      fileName: 'huge.pdf',
      head: pdf(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.reason).toBe('TOO_LARGE')
  })

  it('accepts a file of exactly 10 MB', () => {
    const result = validateUpload({
      size: MAX_FILE_BYTES,
      declaredMimeType: 'application/pdf',
      fileName: 'exactly-ten.pdf',
      head: pdf(),
    })
    expect(result.ok).toBe(true)
  })

  it('refuses an empty file', () => {
    const result = validateUpload({ size: 0, fileName: 'x.pdf', head: pdf() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.reason).toBe('EMPTY')
  })

  it('accepts .jpeg as well as .jpg', () => {
    expect(validateUpload({ size: 10, fileName: 'a.jpeg', head: jpeg() }).ok).toBe(true)
    expect(validateUpload({ size: 10, fileName: 'a.JPG', head: jpeg() }).ok).toBe(true)
  })
})

describe('sanitizeFileName', () => {
  it('strips path separators so a filename cannot climb out of its folder', () => {
    // The path prefix is the authorization key (migration 024): a `/` here would
    // be an authorization bypass, not a cosmetic problem.
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('a/b/c.pdf')).toBe('c.pdf')
    expect(sanitizeFileName('C:\\Users\\x\\quote.pdf')).toBe('quote.pdf')
  })

  it('replaces everything outside the allow-list', () => {
    expect(sanitizeFileName('கோப்பு name.pdf')).toBe('name.pdf')
    expect(sanitizeFileName('a$b&c.png')).toBe('a-b-c.png')
  })

  it('never returns an empty name', () => {
    expect(sanitizeFileName('   ')).toBe('file')
    expect(sanitizeFileName('...')).toBe('file')
  })

  it('bounds the length', () => {
    expect(sanitizeFileName(`${'a'.repeat(400)}.pdf`).length).toBeLessThanOrEqual(120)
  })
})

describe('storage paths', () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

  it('builds the §15.6 path exactly', () => {
    expect(buildStoragePath('opportunity', id, 'quote.pdf', uuid)).toBe(
      `opportunity/${id}/${uuid}-quote.pdf`,
    )
  })

  it('round-trips through the parser', () => {
    const path = buildStoragePath('activity', id, 'site photo.jpg', uuid)
    expect(parseStoragePath(path)).toEqual({ entityType: 'activity', entityId: id })
  })

  it('refuses a malformed or unknown path', () => {
    expect(parseStoragePath('account/not-a-uuid/x.pdf')).toBeNull()
    expect(parseStoragePath(`invoice/${id}/${uuid}-x.pdf`)).toBeNull()
    expect(parseStoragePath(`account/${id}`)).toBeNull()
    expect(parseStoragePath('')).toBeNull()
  })

  it('shows the original filename without the uuid prefix', () => {
    expect(displayFileName(`opportunity/${id}/${uuid}-quote.pdf`)).toBe('quote.pdf')
  })
})
