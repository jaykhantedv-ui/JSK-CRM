import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AUTH_COOKIE_NAME, supabaseInternalUrl, supabaseUrl } from '@/lib/supabase/env'

/**
 * The self-hosted URL split (ADR-033) and the cookie name that makes it safe.
 *
 * The browser reaches Supabase at a public address and the application container
 * reaches it at an internal one. Those two facts are only compatible because both
 * Supabase clients are pinned to the SAME session cookie name — supabase-js would
 * otherwise derive it from each URL's hostname and the server would silently stop
 * finding the session the browser wrote.
 *
 * This is a deployment invariant rather than a preference: if it regresses, every
 * user appears signed out to every Server Component while looking signed in to the
 * browser. It is cheap to assert and expensive to discover on the server.
 */
describe('self-hosted Supabase URL split', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
    delete process.env.SUPABASE_INTERNAL_URL
  })

  afterEach(() => {
    process.env = { ...saved }
  })

  it('falls back to the public URL when no internal URL is set', () => {
    // Local development and hosted Supabase must behave exactly as before.
    expect(supabaseInternalUrl()).toBe('http://localhost')
    expect(supabaseInternalUrl()).toBe(supabaseUrl())
  })

  it('uses the internal URL for server-side access when one is set', () => {
    process.env.SUPABASE_INTERNAL_URL = 'http://gateway:8000'

    expect(supabaseInternalUrl()).toBe('http://gateway:8000')
    // The public URL is unchanged: the browser still calls the address it can reach.
    expect(supabaseUrl()).toBe('http://localhost')
  })

  it('ignores a blank internal URL rather than producing an empty base URL', () => {
    process.env.SUPABASE_INTERNAL_URL = '   '

    expect(supabaseInternalUrl()).toBe('http://localhost')
  })

  it('pins one session cookie name, independent of either URL', () => {
    process.env.SUPABASE_INTERNAL_URL = 'http://gateway:8000'

    // A literal, not a value derived from a hostname. supabase-js would otherwise
    // produce `sb-localhost-auth-token` in the browser and `sb-gateway-auth-token`
    // on the server.
    expect(AUTH_COOKIE_NAME).toBe('sb-jsk-auth-token')
    expect(AUTH_COOKIE_NAME).not.toContain('localhost')
    expect(AUTH_COOKIE_NAME).not.toContain('gateway')
  })
})
