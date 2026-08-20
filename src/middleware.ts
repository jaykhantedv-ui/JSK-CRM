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

/**
 * Cron routes authenticate by shared secret, not by session (§14.7).
 *
 * Vercel Cron calls `/api/cron/*` with a bearer token and no cookie jar. Running
 * the session middleware over that request achieves nothing useful and one
 * actively harmful thing: with no session it would answer the scheduler a 401
 * written for a browser — or, if the API branch below were ever reordered, a
 * redirect to `/login`, which returns **200 and a page of HTML**. A scheduler
 * reading the status line would record that as a successful run forever.
 *
 * So cron is exempt from this middleware entirely, and **each route validates
 * `CRON_SECRET` itself** through `requireCronAuth` in `lib/cron.ts`. The
 * exemption removes a session check that was never the control here; it does not
 * remove the control. A cron route with no `requireCronAuth` call is unprotected,
 * which is why every one of them is tested for the missing-secret and
 * wrong-secret cases (§20).
 *
 * This is the narrowest possible carve-out: one prefix, matched exactly, before
 * any other branch. Normal application and API routes are untouched.
 */
const CRON_PREFIX = '/api/cron/'

export async function middleware(request: NextRequest) {
  // Before `updateSession`, deliberately: there is no session to refresh and no
  // cookie to rotate on a machine-to-machine request.
  if (
    request.nextUrl.pathname === '/api/cron' ||
    request.nextUrl.pathname.startsWith(CRON_PREFIX)
  ) {
    return NextResponse.next()
  }

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
