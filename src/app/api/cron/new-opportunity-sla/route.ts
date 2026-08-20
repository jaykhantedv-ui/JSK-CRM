import { requireCronAuth, runCronJob } from '@/lib/cron'
import { runNewOpportunitySla } from '@/services/automation.service'

/**
 * §14.2 — the new-enquiry SLA reminder. Hourly.
 *
 * A route handler does four things and no more (CLAUDE.md §8): authenticate,
 * validate, call a service, map the result. Every rule about who is notified and
 * how often lives in `automation.service.ts`.
 *
 * `force-dynamic` because a cached cron route is a cron route that runs once.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized

  return runCronJob('new-opportunity-sla', () => runNewOpportunitySla())
}

/** Vercel Cron issues GET; POST is accepted so the job can be triggered by hand. */
export const POST = GET
