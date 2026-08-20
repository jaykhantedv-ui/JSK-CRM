import { requireCronAuth, runCronJob } from '@/lib/cron'
import { runManagerDigest } from '@/services/automation.service'

/**
 * §14.4 — the manager exception digest. 09:00 IST.
 *
 * Scoped to each manager's own outlets (ADR-016). This job runs with the
 * service-role client, so the scope is enforced by the query rather than by RLS —
 * which is why the integration suite asserts each manager's contents rather than
 * trusting it.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized

  return runCronJob('manager-digest', () => runManagerDigest())
}

export const POST = GET
