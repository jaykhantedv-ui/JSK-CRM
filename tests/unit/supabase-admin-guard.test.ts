import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The service-role client bypasses row-level security, so it must never execute in
 * a browser context (§15.7).
 *
 * These tests assert the guard fires on the exact condition the specification
 * names — `typeof window !== 'undefined'` — both when the module is evaluated and
 * when the factory is called.
 *
 * **Never weaken the guard to make these pass.** They exist to prove it works.
 */

const BROWSER_GUARD_PATTERN = /browser context/i

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  vi.resetModules()
  vi.unstubAllEnvs()
})

describe('supabase admin client browser guard', () => {
  it('throws when the module is evaluated in a browser context', async () => {
    vi.stubGlobal('window', {})
    vi.resetModules()

    await expect(import('@/lib/supabase/admin')).rejects.toThrow(BROWSER_GUARD_PATTERN)
  })

  it('throws when the factory is called in a browser context', async () => {
    vi.resetModules()
    const { createAdminClient, assertServerOnly } = await import('@/lib/supabase/admin')

    // Import succeeded on the server; now simulate the browser and call in.
    vi.stubGlobal('window', {})

    expect(() => assertServerOnly()).toThrow(BROWSER_GUARD_PATTERN)
    expect(() => createAdminClient()).toThrow(BROWSER_GUARD_PATTERN)
  })

  it('does not throw on the server', async () => {
    vi.resetModules()
    const { assertServerOnly } = await import('@/lib/supabase/admin')

    expect(typeof window).toBe('undefined')
    expect(() => assertServerOnly()).not.toThrow()
  })

  it('fails loudly rather than silently when the service-role key is missing', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')

    const { createAdminClient } = await import('@/lib/supabase/admin')

    expect(() => createAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
