import { cookies } from 'next/headers'

import { createServerClient } from '@supabase/ssr'

import type { Database } from '@/types/database.types'

import { AUTH_COOKIE_NAME, supabaseAnonKey, supabaseInternalUrl } from './env'

/**
 * Server Supabase client, using the **anon key plus the caller's session**.
 * **RLS applies to every query**, which is what makes it the default client for
 * all application data access (§15, §17.2).
 *
 * Used by Server Components, Server Actions and services. The session travels in
 * httpOnly cookies via `@supabase/ssr` (§15.8).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  // The internal URL, because this runs inside the container; the pinned cookie
  // name, so it reads the same session the browser wrote (see env.ts).
  return createServerClient<Database>(supabaseInternalUrl(), supabaseAnonKey(), {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // `cookies()` is read-only inside a Server Component. Session refresh is
          // handled by middleware, which can write; ignoring here is the documented
          // @supabase/ssr pattern rather than a swallowed error.
        }
      },
    },
  })
}
