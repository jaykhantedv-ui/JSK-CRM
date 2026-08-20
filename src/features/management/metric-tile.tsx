import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { MoneyText } from '@/components/shared/money-text'
import { Card, CardBody } from '@/components/ui/card'
import { formatCount, formatPercent } from '@/lib/metrics'
import { toRoute } from '@/lib/routes'
import { cn } from '@/lib/utils'

/**
 * The management tile (§21 — exception → explanation → action).
 *
 * **A tile with an `href` is a way into the work; a tile without one is a fact.**
 * §21 is explicit that a dashboard tile must not be a dead end, so anything
 * countable links to the filtered list it counts. A tile that cannot lead
 * anywhere useful — Pipeline Value, say — simply has no link rather than a link
 * that goes somewhere unhelpful.
 *
 * Nothing here computes anything. Values arrive already computed by
 * `lib/metrics.ts` or a service; a component that did arithmetic would be a
 * second definition of a metric (CLAUDE.md §8).
 */

export type TileTone = 'default' | 'alert' | 'warn' | 'good'

const TONE_TEXT: Record<TileTone, string> = {
  default: '',
  alert: 'text-state-overdue',
  warn: 'text-state-at-risk',
  good: 'text-state-won',
}

export function MetricTile({
  label,
  value,
  paise,
  percent,
  count,
  hint,
  href,
  tone = 'default',
  emphasis = false,
}: {
  label: string
  /** A pre-rendered value. Use `paise`, `percent` or `count` in preference. */
  value?: string
  paise?: number | null
  percent?: number | null
  count?: number | null
  hint?: string
  href?: string
  tone?: TileTone
  /** Larger type for the two or three figures a screen is actually about. */
  emphasis?: boolean
}) {
  const size = emphasis ? 'text-2xl' : 'text-xl'

  const rendered =
    paise !== undefined ? (
      <MoneyText paise={paise} compact className={cn(size, 'font-semibold', TONE_TEXT[tone])} />
    ) : (
      <p className={cn(size, 'font-semibold', TONE_TEXT[tone])}>
        {value ?? (percent !== undefined ? formatPercent(percent) : formatCount(count))}
      </p>
    )

  const inner = (
    <CardBody className="flex h-full flex-col gap-0.5 pt-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {rendered}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {href ? (
        <span className="mt-auto inline-flex items-center gap-1 pt-1.5 text-xs font-medium text-primary">
          Open <ArrowRight className="size-3" aria-hidden />
        </span>
      ) : null}
    </CardBody>
  )

  if (!href) return <Card className="h-full">{inner}</Card>

  return (
    <Card className="h-full transition-colors hover:bg-accent">
      <Link href={toRoute(href)} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {inner}
      </Link>
    </Card>
  )
}

/**
 * A row of exception counts — §13.3 Panel A, the daily review.
 *
 * A zero is rendered in the ordinary colour and a non-zero in the alert colour,
 * with the label always present: colour is never the only carrier of meaning
 * (§12.1).
 */
export function ExceptionRow({
  items,
}: {
  items: { label: string; count: number; href: string; tone?: TileTone }[]
}) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <li key={item.label}>
          <Link
            href={toRoute(item.href)}
            className="flex h-full flex-col rounded-md border border-border p-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className={cn(
                'text-xl font-semibold',
                item.count > 0 ? TONE_TEXT[item.tone ?? 'alert'] : '',
              )}
            >
              {formatCount(item.count)}
            </span>
            <span className="text-xs text-muted-foreground">{item.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
