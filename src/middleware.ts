import { NextResponse, type NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/middleware'

/**
 * Session refresh and the unauthenticated redirect.
 *
 * **This is not the authorization boundary.** Row-level security is (§15). A
 * request that slips past this middleware still cannot read a row it is not
 * entitled to, because every policy is enforced by the database. What this does
 * is keep the session alive and send a signed-out visitor to the login screen
 * instead of an empty page.
 *
 * Role checks are NOT done here: the middleware runs on the edge without a
 * database round-trip, and a role read from a token rather than from
 * `public.users` would be a role the user could not have had revoked.
 */
const PUBLIC_PATHS = ['/login', '/auth']

export async function middleware(request: NextRequest) {
  const { response, userId } = await updateSession(request)
  const { pathname } = request.nextUrl

  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))

  // An API route answers with a STATUS, never with the login page.
  //
  // Redirecting `/api/export/opportunities` to `/login` hands the caller a 200
  // and a body of HTML — which a script downloading a CSV will happily write to
  // a `.csv` file, and which makes "was I refused?" impossible to answer from
  // the status line. 401 says the one thing that is true.
  if (!userId && !isPublic && pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  }

  if (!userId && !isPublic) {
    const redirect = request.nextUrl.clone()
    redirect.pathname = '/login'
    // Carry the destination so a session that expired mid-task resumes where it
    // stopped rather than dumping the user on a landing page.
    redirect.searchParams.set('next', pathname)
    return NextResponse.redirect(redirect)
  }

  if (userId && pathname === '/login') {
    const redirect = request.nextUrl.clone()
    redirect.pathname = '/'
    redirect.search = ''
    return NextResponse.redirect(redirect)
  }

  return response
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
