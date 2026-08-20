import { formatPaiseCompact } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * The two visual forms the management screens use — a proportion bar and a trend
 * line — drawn as **server-rendered inline SVG and CSS**, with no charting
 * library and no client JavaScript at all.
 *
 * §17.1 lists Recharts in the frozen stack, so using it would need no approval.
 * It is not used here because it would earn nothing: these are a bar whose width
 * is a percentage and a twelve-point polyline. Recharts would make both of them
 * Client Components, ship a charting runtime to a phone in a showroom, and
 * replace nine lines of SVG with a dependency. §17.1's own instruction is to
 * prefer the platform, and this is what that looks like. A genuinely interactive
 * chart — one with tooltips, zoom or a brush — would be a different decision, and
 * Recharts would be the right answer to it.
 *
 * Every visual here is labelled in text as well. A bar is never the only way a
 * number is stated (§12.1), which also means these screens degrade to something
 * perfectly readable if the SVG does not render.
 */

/**
 * A horizontal proportion bar — lost reasons, branch comparison, workload.
 *
 * `percent` is null when the share is unanswerable (a zero denominator), and the
 * bar renders empty rather than full or zero-width-but-present: an unmeasurable
 * share must not look like a measured one (§13.1).
 */
export function ProportionBar({
  percent,
  tone = 'active',
  className,
  label,
}: {
  percent: number | null
  tone?: 'active' | 'overdue' | 'won' | 'at-risk'
  className?: string
  /** Screen-reader text. The visible number is always rendered beside the bar. */
  label: string
}) {
  const width = percent === null ? 0 : Math.max(0, Math.min(100, percent))

  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      role="img"
      aria-label={label}
    >
      <div
        className={cn('h-full rounded-full', {
          'bg-state-active': tone === 'active',
          'bg-state-overdue': tone === 'overdue',
          'bg-state-won': tone === 'won',
          'bg-state-at-risk': tone === 'at-risk',
        })}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}

export type TrendPoint = { label: string; valuePaise: number }

/**
 * §13.4's trend block — Won Value by month, one line.
 *
 * The y-axis starts at zero, deliberately. A line chart scaled to its own minimum
 * turns a 3% variation into a cliff, which is how a chart comes to say something
 * the numbers do not.
 */
export function TrendLine({
  points,
  className,
}: {
  points: readonly TrendPoint[]
  className?: string
}) {
  if (points.length < 2) {
    return (
      <p className={cn('py-6 text-center text-sm text-muted-foreground', className)}>
        Not enough history yet to show a trend.
      </p>
    )
  }

  const width = 640
  const height = 160
  const padding = { top: 12, right: 8, bottom: 4, left: 8 }
  const peak = Math.max(...points.map((point) => point.valuePaise), 1)

  const x = (index: number) =>
    padding.left +
    (index * (width - padding.left - padding.right)) / Math.max(points.length - 1, 1)
  const y = (value: number) =>
    padding.top + (1 - value / peak) * (height - padding.top - padding.bottom)

  const line = points.map((point, index) => `${x(index)},${y(point.valuePaise)}`).join(' ')
  const area = `${padding.left},${y(0)} ${line} ${x(points.length - 1)},${y(0)}`

  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Won Value by month. Highest month ${formatPaiseCompact(peak)}.`}
      >
        <polygon points={area} className="fill-state-won/15" />
        <polyline
          points={line}
          fill="none"
          className="stroke-state-won"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((point, index) => (
          <circle
            key={point.label}
            cx={x(index)}
            cy={y(point.valuePaise)}
            r={3}
            className="fill-state-won"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {/* The figures in text, because a line alone is not a number (§12.1). */}
      <figcaption className="flex justify-between gap-1 overflow-x-auto text-[10px] text-muted-foreground">
        {points.map((point) => (
          <span key={point.label} className="flex min-w-0 flex-col items-center whitespace-nowrap">
            <span>{point.label}</span>
            <span className="font-medium text-foreground">
              {formatPaiseCompact(point.valuePaise)}
            </span>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
