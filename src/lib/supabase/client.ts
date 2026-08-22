'use client'

import { createBrowserClient } from '@supabase/ssr'

import type { Database } from '@/types/database.types'

import { AUTH_COOKIE_NAME, supabaseAnonKey, supabaseUrl } from './env'

/**
 * Browser Supabase client, using the **anon key**. RLS applies to every request.
 *
 * Reads only, plus the one approved browser-side write: a Storage upload against a
 * server-issued signed upload URL (ADR-005). **No other client-side write is
 * permitted** — mutations go through Server Actions calling services (§17.2).
 *
 * The anon key is public and safe to expose; RLS is what protects the data (§15.7).
 */
export function createSupabaseBrowserClient() {
  // The PUBLIC URL — this one runs in the browser — with the same pinned cookie
  // name the server reads (see env.ts).
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookieOptions: { name: AUTH_COOKIE_NAME },
  })
}
