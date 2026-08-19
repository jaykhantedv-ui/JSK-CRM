import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { supabaseServiceRoleKey, supabaseUrl } from './env'

/**
 * Service-role Supabase client. **RLS is bypassed.**
 *
 * §15.7 and ADR-009 permit exactly three callers:
 *   1. cron routes under /api/cron/*
 *   2. the import executor
 *   3. the user-provisioning Server Action — and only *after* a server-side
 *      OWNER/ADMIN check. Reversing that order is a privilege-escalation hole.
 *
 * Nothing else may use this client. Reads and writes on behalf of a user go
 * through `server.ts`, where RLS applies.
 *
 * Three independent controls keep this module off the client:
 *   - an ESLint restriction on importing it outside the three permitted paths
 *     (eslint.config.mjs);
 *   - the runtime guard below, which throws on import *and* on use if a `window`
 *     exists;
 *   - the §19.4 security test that greps the production bundle for the key
 *     (Phase 19).
 */

const BROWSER_GUARD_MESSAGE =
  'The Supabase service-role client was loaded in a browser context. ' +
  'It bypasses row-level security and must never reach the client bundle (§15.7). ' +
  'Use lib/supabase/client.ts in the browser, or lib/supabase/server.ts on the server.'

/**
 * Throws if executed anywhere a `window` exists.
 *
 * **Never weaken this guard to make a test pass** — the test exists to prove the
 * guard works.
 */
export function assertServerOnly(): void {
  if (typeof window !== 'undefined') {
    throw new Error(BROWSER_GUARD_MESSAGE)
  }
}

// Fail at module-evaluation time, not merely when the factory is called, so that a
// browser bundle which somehow includes this module breaks loudly and immediately.
assertServerOnly()

/**
 * Create the service-role client.
 *
 * Deliberately a factory rather than a module-level singleton: a singleton would
 * read the key at import time, which makes the key harder to keep out of a bundle
 * and the guard easier to bypass by accident.
 */
export function createAdminClient(): SupabaseClient {
  assertServerOnly()

  return createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
