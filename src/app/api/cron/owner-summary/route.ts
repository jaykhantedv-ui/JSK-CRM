import { requireCronAuth, runCronJob } from '@/lib/cron'
import { runOwnerSummary } from '@/services/automation.service'

/**
 * §14.5 — the owner summary (ADR-011).
 *
 * **Fires hourly and gates in the route.** Vercel Cron schedules are static in
 * `vercel.json`, so the send time comes from `system_settings.owner_summary_schedule`
 * and is compared against the Asia/Kolkata hour. Changing when the owner is
 * emailed is an edit at /settings, never a deployment — which is the rule §24
 * exists to protect.
 *
 * A skipped hour is a successful run that sent nothing: `processed: 0`. It is not
 * an error, and must never be reported as one.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized

  return runCronJob('owner-summary', async () => {
    const { processed, sent, failed } = await runOwnerSummary()
    return { processed, sent, failed }
  })
}

export const POST = GET
