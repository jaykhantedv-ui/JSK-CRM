import { requireCronAuth, runCronJob } from '@/lib/cron'
import { recordMaintenanceFailure, runMaintenance } from '@/services/automation.service'

/**
 * §14.6 — nightly maintenance. 02:00 IST.
 *
 * ADR-014: the failure state lives in `system_settings`. A successful run resets
 * `maintenance_consecutive_failures` to 0; a failed one increments it and stamps
 * `maintenance_last_failure_at`, and the OWNER is emailed at exactly two
 * consecutive failures — once, not on every subsequent one.
 *
 * **The failure update belongs in the error path, not after the work.** A run
 * that throws before reaching its counter update would leave the state stale,
 * which is the risk Phase 18 names; `runCronJob`'s `onError` hook is where it
 * goes so it fires whatever the body did.
 */
export const dynamic = 'force-dynamic'
/** The heaviest of the five jobs: it rewrites dormancy across every account. */
export const maxDuration = 300

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized

  return runCronJob(
    'maintenance',
    async () => {
      const { processed, sent, failed } = await runMaintenance()
      return { processed, sent, failed }
    },
    async () => {
      const state = await recordMaintenanceFailure()
      console.error(
        `[cron:maintenance] consecutive failures: ${state.consecutiveFailures}` +
          (state.alerted ? ' — owner alerted' : ''),
      )
    },
  )
}

export const POST = GET
