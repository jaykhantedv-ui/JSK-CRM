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
 *
 * `extraRequestHeaders` carries the CSP nonce inward (§23). Next.js reads the
 * nonce off the *request* `Content-Security-Policy` header and stamps it onto the
 * bootstrap scripts it renders, so the value has to be attached to the request the
 * downstream render sees — not merely to the response. It is rebuilt on every
 * `NextResponse.next()` below rather than captured once, because
 * `request.cookies.set()` writes back into the request's `cookie` header and a
 * `Headers` copy taken earlier would carry the pre-refresh session.
 */
export async function updateSession(
  request: NextRequest,
  extraRequestHeaders?: Record<string, string>,
): Promise<{
  response: NextResponse
  userId: string | null
}> {
  const nextInit = () => {
    if (!extraRequestHeaders) return { request }
    const headers = new Headers(request.headers)
    for (const [name, value] of Object.entries(extraRequestHeaders)) headers.set(name, value)
    return { request: { headers } }
  }

  let response = NextResponse.next(nextInit())

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next(nextInit())
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
