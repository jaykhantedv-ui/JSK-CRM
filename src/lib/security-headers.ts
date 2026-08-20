/**
 * Response security headers (§23).
 *
 * These are set in two places, deliberately:
 *
 * - Everything static lives in `next.config.ts`, so it also covers the responses
 *   the middleware matcher skips (`_next/static`, images, `favicon.ico`).
 * - The Content-Security-Policy is per-request, because it carries a fresh nonce,
 *   so it is set in `middleware.ts`.
 *
 * The rule from §23 that shapes all of this: *do not break legitimate application
 * functionality to satisfy a superficial header check*. A CSP that forces the app
 * to fall back to `'unsafe-eval'`, or one that blocks the Supabase origin the app
 * must reach, is worse than no CSP — it either does nothing or it breaks the
 * product. Every directive below is the narrowest value this application actually
 * runs under.
 */

/** Headers that never vary by request. Applied from `next.config.ts`. */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  // Clickjacking. `frame-ancestors 'none'` in the CSP is the modern control and
  // supersedes this for browsers that read both; this stays for the ones that do
  // not. §23 names it explicitly.
  { key: 'X-Frame-Options', value: 'DENY' },

  // Stop content-type sniffing. This matters here beyond the generic case: §15.6
  // uploads are served back through signed Storage URLs, and a disguised
  // executable that the browser is willing to re-interpret is exactly the attack
  // the magic-byte check exists to stop.
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  // Two years, subdomains included, preload-eligible. Vercel terminates TLS for
  // every environment, so there is no plaintext origin this can lock out.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },

  // Send the full URL only to ourselves. CRM URLs carry record ids; a customer
  // id has no business appearing in a third party's referer log.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  // The application asks for none of these. Denying them by default means a
  // future dependency cannot quietly start asking.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()',
  },

  // Cross-origin isolation of our own documents.
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
]

/**
 * The Supabase origin the browser is genuinely allowed to reach.
 *
 * Auth, PostgREST and Storage all live on the project origin, so one entry covers
 * them. When the variable is unset — a local build, or a misconfigured
 * environment — the origin is simply omitted rather than widened to a wildcard:
 * a broken environment must not silently produce a weaker policy than a working
 * one.
 */
export function supabaseOrigin(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Build the CSP for one request.
 *
 * `'strict-dynamic'` is what makes a nonce workable under Next.js: the framework
 * puts the nonce on the bootstrap scripts it renders, and those scripts then load
 * the rest of the chunk graph themselves. Without `'strict-dynamic'` every
 * dynamically inserted chunk would need its own nonce, which Next.js does not do.
 *
 * `style-src` keeps `'unsafe-inline'`. React writes `style` attributes and Next.js
 * inlines critical CSS; nonces do not apply to style *attributes* at all, so the
 * alternative is not a stricter policy, it is a broken page. Scripts — where the
 * risk actually is — take no such exemption.
 */
export function buildCsp(options: { nonce: string; supabaseUrl?: string; isProduction: boolean }): string {
  const origin = supabaseOrigin(options.supabaseUrl)
  const connect = ["'self'", origin, origin ? `wss://${new URL(origin).host}` : null].filter(Boolean)
  const img = ["'self'", 'blob:', 'data:', origin].filter(Boolean)

  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", `'nonce-${options.nonce}'`, "'strict-dynamic'"]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', img as string[]],
    ['font-src', ["'self'", 'data:']],
    // Signed Storage uploads (ADR-005) and every PostgREST/Auth call.
    ['connect-src', connect as string[]],
    // Nothing in this application frames anything, or may be framed.
    ['frame-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
  ]

  const policy = directives.map(([name, values]) => `${name} ${values.join(' ')}`)

  // Only in production: on `next dev` over plain HTTP this would upgrade every
  // localhost request to https and make the dev server unreachable.
  if (options.isProduction) policy.push('upgrade-insecure-requests')

  return policy.join('; ')
}
