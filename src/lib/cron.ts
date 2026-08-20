import { timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'

/**
 * Cron authentication and the cron response contract (§14.7).
 *
 * Every `/api/cron/*` route is exempt from the session middleware (`middleware.ts`)
 * because it authenticates by shared secret, not by cookie. **That exemption is
 * only safe because every route calls `requireCronAuth` first.** A route that
 * forgets is wide open; the security suite tests each one for the missing-secret
 * and wrong-secret cases so a forgotten call fails a test rather than shipping.
 *
 * The 401 body is machine-readable and says nothing else. `{"error":"unauthorized"}`
 * tells a scheduler what it needs and tells an attacker nothing: not whether
 * `CRON_SECRET` is configured, not whether the token was the wrong length, not
 * which route exists. **Never widen it to help debugging** — a caller holding the
 * right secret gets a 200 and that is the only feedback anyone needs.
 */

const UNAUTHORIZED = { error: 'unauthorized' } as const

/** The §14.7 response shape. Every cron route returns exactly this. */
export type CronSummary = {
  processed: number
  sent: number
  failed: number
  durationMs: number
}

/**
 * Constant-time comparison of two secrets.
 *
 * `timingSafeEqual` throws when the buffers differ in length, which would itself
 * leak the secret's length through the response time of the throw. Comparing the
 * lengths first and returning early is not a leak of anything useful — an
 * attacker who can already guess lengths learns nothing — but the comparison of
 * equal-length candidates, which is the one that matters, stays constant-time.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Extract the presented secret.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. The bare
 * `x-cron-secret` header is accepted as well so the job can be triggered by a
 * plain `curl` during an incident without constructing a bearer header.
 */
function presentedSecret(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim() || null
  }
  return request.headers.get('x-cron-secret')?.trim() || null
}

/**
 * Validate a cron request. Returns a 401 `NextResponse` to return immediately, or
 * `null` when the caller is authentic.
 *
 * **This never redirects.** A redirect answers a scheduler with 200 and a page of
 * HTML, which reads as a successful run and hides a broken job indefinitely.
 *
 * An unset `CRON_SECRET` refuses every request. Treating "no secret configured"
 * as "no authentication required" would leave the routes open on any deployment
 * that forgot the variable — the exact deployment least likely to notice.
 */
export function requireCronAuth(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET?.trim()
  if (!expected) {
    console.error('[cron] CRON_SECRET is not configured; refusing the request.')
    return NextResponse.json(UNAUTHORIZED, { status: 401 })
  }

  const provided = presentedSecret(request)
  if (!provided || !secretsMatch(provided, expected)) {
    return NextResponse.json(UNAUTHORIZED, { status: 401 })
  }

  return null
}

/**
 * Run a cron job body and answer with the §14.7 summary.
 *
 * The body's own failures are its business — §14 requires every job to continue
 * past a single user's failure and report the count. What this catches is the
 * job throwing outright, which must still answer JSON with a duration rather than
 * an unhandled 500 with a stack trace in it.
 *
 * `onError` exists for the maintenance route, whose consecutive-failure state
 * (ADR-014) has to be written even when the run throws.
 */
export async function runCronJob(
  name: string,
  body: () => Promise<Omit<CronSummary, 'durationMs'>>,
  onError?: (error: unknown) => Promise<void>,
): Promise<NextResponse> {
  const startedAt = Date.now()

  try {
    const result = await body()
    return NextResponse.json({ ...result, durationMs: Date.now() - startedAt })
  } catch (error) {
    // Logged server-side with the job name so an operator can find it; never
    // returned to the caller, which would leak schema and configuration detail.
    console.error(`[cron:${name}] run failed`, error)

    if (onError) {
      try {
        await onError(error)
      } catch (stateError) {
        console.error(`[cron:${name}] failure-state update failed`, stateError)
      }
    }

    return NextResponse.json(
      { processed: 0, sent: 0, failed: 1, durationMs: Date.now() - startedAt },
      { status: 500 },
    )
  }
}
