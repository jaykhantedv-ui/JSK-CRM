/**
 * Whether this deployment is running the DEMO / TRAINING dataset (§6).
 *
 * This is deployment configuration, not business configuration: it describes
 * which dataset is loaded rather than how the business operates, so it lives in
 * the environment and not in `system_settings` (CLAUDE.md §3).
 *
 * The comparison is against exactly `'1'` on purpose. `Boolean(process.env.X)` is
 * true for `'0'`, `'false'` and `'no'`, and a demo banner that appears in
 * production because someone wrote `NEXT_PUBLIC_DEMO_MODE=false` is the mirror of
 * the failure this flag exists to prevent.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === '1'
}
