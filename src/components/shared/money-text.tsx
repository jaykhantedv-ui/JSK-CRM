import { formatPaise, formatPaiseCompact } from '@/lib/money'

/**
 * The single money renderer (CLAUDE.md §9).
 *
 * **All money display goes through this component.** Indian grouping, `₹4,20,000`,
 * tabular numerals so figures line up in a column. A raw `toLocaleString` call in
 * a component is a defect: it is how two screens come to disagree about the same
 * number.
 *
 * The input is PAISE, always — the same unit the database stores. Nothing here
 * accepts rupees.
 */
export function MoneyText({
  paise,
  compact = false,
  showPaise = false,
  className,
}: {
  paise: number | null | undefined
  compact?: boolean
  showPaise?: boolean
  className?: string
}) {
  // An absent amount renders as an em dash, never as ₹0 — "not recorded" and
  // "zero" are different facts (§12.6).
  if (paise === null || paise === undefined) {
    return <span className={className}>—</span>
  }

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {compact ? formatPaiseCompact(paise) : formatPaise(paise, { showPaise })}
    </span>
  )
}
