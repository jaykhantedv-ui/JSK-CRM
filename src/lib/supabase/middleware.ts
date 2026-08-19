import { NextResponse, type NextRequest } from 'next/server'

import { createServerClient } from '@supabase/ssr'

import { supabaseAnonKey, supabaseUrl } from './env'

/**
 * Session refresh at the edge (§15.8, §17.2).
 *
 * Server Components cannot write cookies, so a rotating refresh token has to be
 * persisted somewhere that can — that is this middleware. Without it a signed-in
 * user is silently logged out when their access token expires.
 *
 * `getUser()` is deliberate: it verifies the token with the auth server. Reading
 * the session from the cookie alone would trust a value the browser can edit.
 */
export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse
  userId: string | null
}> {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { response, userId: user?.id ?? null }
}
