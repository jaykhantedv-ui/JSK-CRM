import { TriangleAlert } from 'lucide-react'

import { isDemoMode } from '@/lib/demo'

/**
 * The DEMO / TRAINING DATA banner (§6).
 *
 * Demo data invents customers, phone numbers and order values. Someone who
 * wanders into a training browser tab must not be able to mistake any of it for
 * the real pipeline, so the warning is permanent, sits above everything and is
 * not dismissible — a banner you can close is a banner that is closed.
 *
 * It is driven by `NEXT_PUBLIC_DEMO_MODE` through `lib/demo`. A production
 * deployment simply never sets it, and this renders nothing.
 */
export function DemoBanner() {
  if (!isDemoMode()) return null

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-400 px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-amber-950 sm:text-xs"
    >
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
      <span>
        Demo / Training data
        <span className="hidden font-medium normal-case tracking-normal sm:inline">
          {' '}— every customer, number and value here is invented.
        </span>
      </span>
    </div>
  )
}
