/**
 * Phone normalisation (§5.3).
 *
 * **This must stay identical to `public.normalize_phone()` in migration 001.**
 * The database computes `phone_normalized` as a generated column; if this
 * function and that one ever disagree, duplicate detection (§8.9) silently stops
 * finding duplicates. The unit suite tests both against the same cases.
 *
 * Strips every non-digit, then keeps the trailing ten digits — which removes
 * spaces, dashes, brackets and a leading `+91`, `91` or `0` as a consequence.
 * Fewer than ten digits normalises to null: a partial number must never
 * masquerade as a match.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.slice(-10)
}

/** `98430 12345` — how an Indian mobile number reads on screen. */
export function formatPhone(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(raw)
  if (!normalized) return null
  return `${normalized.slice(0, 5)} ${normalized.slice(5)}`
}

/**
 * A `wa.me` deep link (§16.4). This is the whole of the WhatsApp integration in
 * V1 — there is no Business API, no webhook and no message ingestion (§2.3).
 */
export function whatsappDeepLink(phone: string, text?: string): string {
  const normalized = normalizePhone(phone)
  if (!normalized) throw new TypeError(`Not a usable phone number: "${phone}"`)
  const base = `https://wa.me/91${normalized}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}
