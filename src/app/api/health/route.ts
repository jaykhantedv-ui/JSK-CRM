import { supabaseAnonKey, supabaseInternalUrl } from '@/lib/supabase/env'

/**
 * `GET /api/health` — the liveness and readiness probe for the office server
 * (§11).
 *
 * Deliberately the whole of the monitoring stack. At two outlets and twenty
 * users, Prometheus, Grafana and Loki would be more moving parts than the thing
 * they watch. Docker restarts an unhealthy container, and this endpoint is what
 * tells it — and the owner — whether the application can actually serve a
 * request.
 *
 * **It probes with the anon key, never the service role.** `lib/supabase/admin`
 * has exactly three approved callers and a health check is not one of them
 * (CLAUDE.md §7); a monitoring endpoint is also the last place to hand out
 * elevated credentials, since it is the one route that must answer before anyone
 * has signed in. The anon key already ships in the browser bundle, so this adds
 * no exposure at all.
 *
 * Reaching PostgREST's root with that key exercises the whole chain the
 * application depends on — app → gateway → PostgREST → PostgreSQL — and reads no
 * business data doing it. A `select 1` on a connection would prove less and
 * require more privilege.
 *
 * It is unauthenticated on purpose and therefore says nothing sensitive: no
 * version, no hostname, no row counts, no Postgres error text. A failure is
 * `"error"` and a duration; the detail goes to the container log, where an
 * operator can read it and an internet scanner cannot.
 */
export const dynamic = 'force-dynamic'

/** Past this, a probe is a hang rather than a slow answer. */
const PROBE_TIMEOUT_MS = 5_000

type Check = { status: 'ok' | 'error'; ms: number }

export async function GET() {
  const started = Date.now()
  const database = await probeDatabase()
  const healthy = database.status === 'ok'

  return Response.json(
    { status: healthy ? 'ok' : 'error', checks: { database }, ms: Date.now() - started },
    {
      status: healthy ? 200 : 503,
      // A cached health check is a lie by the time it is read.
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  )
}

async function probeDatabase(): Promise<Check> {
  const started = Date.now()
  try {
    const anonKey = supabaseAnonKey()
    // The internal address: this probe runs inside the container, and the
    // public URL is not reachable from there (see lib/supabase/env.ts).
    const response = await fetch(`${supabaseInternalUrl()}/rest/v1/`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })

    if (!response.ok) throw new Error(`PostgREST answered ${response.status}`)
    return { status: 'ok', ms: Date.now() - started }
  } catch (cause) {
    // The operator gets the reason in the container log; the caller gets none.
    console.error('[health] database probe failed:', cause)
    return { status: 'error', ms: Date.now() - started }
  }
}
