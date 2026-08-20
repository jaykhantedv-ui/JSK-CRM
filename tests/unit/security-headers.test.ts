import { describe, expect, it } from 'vitest'

import { STATIC_SECURITY_HEADERS, buildCsp, supabaseOrigin } from '@/lib/security-headers'

const NONCE = 'dGVzdC1ub25jZS0xMjM0NQ=='
const PROJECT = 'https://abcdefghijklm.supabase.co'

function csp(overrides: Partial<Parameters<typeof buildCsp>[0]> = {}) {
  return buildCsp({ nonce: NONCE, supabaseUrl: PROJECT, isProduction: true, ...overrides })
}

function directive(policy: string, name: string): string | undefined {
  return policy
    .split('; ')
    .find((part) => part === name || part.startsWith(`${name} `))
    ?.slice(name.length)
    .trim()
}

describe('static security headers (§23)', () => {
  const byKey = new Map(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]))

  it('denies framing', () => {
    expect(byKey.get('X-Frame-Options')).toBe('DENY')
  })

  it('forbids content-type sniffing', () => {
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('sets HSTS for two years, including subdomains, preload-eligible', () => {
    const hsts = byKey.get('Strict-Transport-Security') ?? ''
    expect(hsts).toContain('max-age=63072000')
    expect(hsts).toContain('includeSubDomains')
    expect(hsts).toContain('preload')
  })

  it('does not leak full URLs cross-origin — CRM URLs carry record ids', () => {
    expect(byKey.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })

  it('denies camera, microphone and geolocation the app never asks for', () => {
    const policy = byKey.get('Permissions-Policy') ?? ''
    for (const feature of ['camera=()', 'microphone=()', 'geolocation=()']) {
      expect(policy).toContain(feature)
    }
  })
})

describe('buildCsp (§23)', () => {
  it('carries the request nonce on script-src', () => {
    expect(directive(csp(), 'script-src')).toContain(`'nonce-${NONCE}'`)
  })

  it("uses 'strict-dynamic' so Next.js chunk loading is not broken", () => {
    expect(directive(csp(), 'script-src')).toContain("'strict-dynamic'")
  })

  it("never allows 'unsafe-eval' or 'unsafe-inline' for scripts", () => {
    const scripts = directive(csp(), 'script-src') ?? ''
    expect(scripts).not.toContain("'unsafe-eval'")
    expect(scripts).not.toContain("'unsafe-inline'")
  })

  it('blocks framing and object embedding outright', () => {
    expect(directive(csp(), 'frame-ancestors')).toBe("'none'")
    expect(directive(csp(), 'object-src')).toBe("'none'")
    expect(directive(csp(), 'frame-src')).toBe("'none'")
  })

  it('pins base-uri and form-action to self', () => {
    expect(directive(csp(), 'base-uri')).toBe("'self'")
    expect(directive(csp(), 'form-action')).toBe("'self'")
  })

  it('allows the Supabase origin for API, Auth and signed Storage uploads', () => {
    expect(directive(csp(), 'connect-src')).toContain(PROJECT)
    expect(directive(csp(), 'img-src')).toContain(PROJECT)
  })

  it('allows blob: and data: images for photo previews before upload', () => {
    const img = directive(csp(), 'img-src') ?? ''
    expect(img).toContain('blob:')
    expect(img).toContain('data:')
  })

  it('omits the Supabase origin rather than widening to a wildcard when unset', () => {
    const policy = csp({ supabaseUrl: undefined })
    expect(policy).not.toContain('*')
    expect(directive(policy, 'connect-src')).toBe("'self'")
  })

  it('ignores a malformed Supabase URL instead of emitting a broken directive', () => {
    expect(supabaseOrigin('not a url')).toBeNull()
    expect(directive(csp({ supabaseUrl: 'not a url' }), 'connect-src')).toBe("'self'")
  })

  it('upgrades insecure requests in production only', () => {
    expect(csp({ isProduction: true })).toContain('upgrade-insecure-requests')
    expect(csp({ isProduction: false })).not.toContain('upgrade-insecure-requests')
  })

  it('defaults to self', () => {
    expect(directive(csp(), 'default-src')).toBe("'self'")
  })
})
