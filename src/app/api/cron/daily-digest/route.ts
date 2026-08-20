import { requireCronAuth, runCronJob } from '@/lib/cron'
import { runDailyDigest } from '@/services/automation.service'

/**
 * §14.3 — the daily salesperson digest. 08:30 IST.
 *
 * One email per person, never a group email, and nothing at all for a
 * salesperson whose three lists are empty. The loop continues past a failed
 * recipient and reports the count.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized

  return runCronJob('daily-digest', () => runDailyDigest())
}

export const POST = GET
