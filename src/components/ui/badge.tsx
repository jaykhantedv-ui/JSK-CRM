import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * A state badge (§12.1).
 *
 * **Never colour alone.** Every tone below is rendered with its label, so the
 * meaning survives greyscale, sunlight on a phone screen, and colour blindness.
 */
const TONES = {
  neutral: 'bg-secondary text-secondary-foreground',
  active: 'bg-state-active text-state-active-foreground',
  won: 'bg-state-won text-state-won-foreground',
  overdue: 'bg-state-overdue text-state-overdue-foreground',
  'at-risk': 'bg-state-at-risk text-state-at-risk-foreground',
  muted: 'bg-muted text-muted-foreground',
} as const

export type BadgeTone = keyof typeof TONES

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...props}
    />
  )
}
