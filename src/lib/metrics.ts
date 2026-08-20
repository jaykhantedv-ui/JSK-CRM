/**
 * Management metric definitions (§13.1, Master Phase 3 §5–§15).
 *
 * **Every metric in the application is defined exactly once, here, as a pure
 * function.** A dashboard tile, a report row and a CSV column that all claim to
 * show "win rate" call the same function, so they cannot come to disagree — which
 * is the failure mode that makes management reporting untrustworthy and, once
 * distrusted, unused.
 *
 * Nothing in this file reads the database, the session or `system_settings`.
 * Thresholds arrive as arguments, because they are business decisions the owner
 * can change without a deploy (CLAUDE.md §3), and because a metric you cannot
 * call with arbitrary inputs is a metric you cannot test.
 *
 * §2.4 — the word "Revenue" appears nowhere. Won Value, Pipeline Value,
 * Weighted Pipeline.
 */

/**
 * A ratio that is genuinely unanswerable returns `null`, never `0`.
 *
 * §13.1 is explicit for Win Rate: "Null when the denominator is 0 — display '—',
 * never 0%". The reason is not pedantry. A branch that closed nothing this month
 * has *no* win rate; showing `0%` says it lost everything it touched, which is a
 * different and defamatory claim about a real person's month.
 */
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null
  if (denominator <= 0) return null
  return numerator / denominator
}

/** The same rule, expressed as a percentage rounded to one place. */
export function percentage(numerator: number, denominator: number): number | null {
  const value = ratio(numerator, denominator)
  return value === null ? null : Math.round(value * 1000) / 10
}

/**
 * Win Rate (§13.1): `won ÷ (won + lost)` over opportunities CLOSED IN THE PERIOD.
 *
 * Open opportunities are not in the denominator: a deal still in negotiation has
 * neither been won nor lost, and counting it as a loss would make every healthy
 * pipeline look like a failing one.
 */
export function winRate(wonCount: number, lostCount: number): number | null {
  return percentage(wonCount, wonCount + lostCount)
}

/**
 * Quote-to-order conversion (Master Phase 3 §11):
 * `won opportunities that were previously quoted ÷ opportunities that reached quoted or later`.
 *
 * Both figures come from `opportunity_events` — whether a deal ever *reached* the
 * quoted stage is a question about its history, and its current stage cannot
 * answer it. The denominator is scoped to deals resolved in the period, so a
 * quotation still under discussion is not counted as a failure to convert.
 */
export function quoteToOrderConversion(
  wonAfterQuoteCount: number,
  reachedQuotedCount: number,
): number | null {
  return percentage(wonAfterQuoteCount, reachedQuotedCount)
}

/** Average Opportunity Value (§13.1): `Won Value ÷ count(won)`, in paise. */
export function averageOpportunityValuePaise(
  wonValuePaise: number,
  wonCount: number,
): number | null {
  const value = ratio(wonValuePaise, wonCount)
  return value === null ? null : Math.round(value)
}

/** One reason's share of the lost set. Used by the lost-reason bars (§14). */
export function sharePercent(part: number, total: number): number | null {
  return percentage(part, total)
}

// --------------------------------------------------------- sales vs target --

export type TargetProgress = {
  /** Null when no target is set — "no target" is not "a target of zero". */
  targetPaise: number | null
  achievedPaise: number
  /** Percent of target achieved. Null when there is no target to compare against. */
  achievementPercent: number | null
  /** Paise still required. Null without a target; 0 once the target is met. */
  gapPaise: number | null
  isMet: boolean
}

/**
 * Sales versus target (Master Phase 3 §10).
 *
 * A target of zero is a real instruction — "nothing expected from this branch this
 * month" — and is how a target is withdrawn, because `sales_targets` has no DELETE
 * policy (ADR-021). It is NOT the same as no target at all, and the two must not
 * render alike: a zero target is met by definition, an absent one cannot be
 * measured and shows an em dash.
 */
export function targetProgress(
  achievedPaise: number,
  targetPaise: number | null | undefined,
): TargetProgress {
  if (targetPaise === null || targetPaise === undefined) {
    return {
      targetPaise: null,
      achievedPaise,
      achievementPercent: null,
      gapPaise: null,
      isMet: false,
    }
  }

  if (targetPaise === 0) {
    return {
      targetPaise: 0,
      achievedPaise,
      achievementPercent: null,
      gapPaise: 0,
      isMet: true,
    }
  }

  return {
    targetPaise,
    achievedPaise,
    achievementPercent: percentage(achievedPaise, targetPaise),
    gapPaise: Math.max(targetPaise - achievedPaise, 0),
    isMet: achievedPaise >= targetPaise,
  }
}

// ------------------------------------------------------ at-risk classification --

/**
 * Why a record is at risk. **At-risk must be explainable** (Master Phase 3 §9):
 * a manager who is told an opportunity is at risk and not told why has been given
 * a mood, not a work item.
 */
export type RiskReason =
  | 'HIGH_VALUE_AT_RISK'
  | 'OVERDUE_NEXT_ACTION'
  | 'MISSING_NEXT_ACTION'
  | 'STALLED_IN_STAGE'
  | 'NO_RECENT_ACTIVITY'

export type RiskSignals = {
  isOverdue: boolean
  isMissingNextAction: boolean
  daysInStage: number
  daysSinceActivity: number
  /** From `stage_stall_days`. Null when the stage has no configured threshold. */
  stageStallDays: number | null
  estimatedValuePaise: number
}

export type RiskThresholds = {
  /** `system_settings.opportunity_dormancy_days`. */
  dormancyDays: number
  /** `system_settings.high_value_threshold_paise`. */
  highValueThresholdPaise: number
}

/**
 * The reasons a record is at risk, most escalating first.
 *
 * Every threshold is an argument. `30000000` — the approved high-value figure —
 * must appear in exactly one place in this repository, and that place is
 * migration 014 (CLAUDE.md §3).
 *
 * **`HIGH_VALUE_AT_RISK` is never a reason on its own.** §13.3 defines it as
 * high value AND (overdue OR stalled): a large opportunity that is being worked
 * properly is a good thing, not a risk, and flagging it would train managers to
 * ignore the list. That subset relationship is also why `management_at_risk` in
 * migration 022 does not restate this rule — its predicate is the union of the
 * other four reasons, which is the same set.
 */
export function classifyRisk(signals: RiskSignals, thresholds: RiskThresholds): RiskReason[] {
  const reasons: RiskReason[] = []

  const isStalled =
    signals.stageStallDays !== null && signals.daysInStage > signals.stageStallDays
  const isHighValue = signals.estimatedValuePaise >= thresholds.highValueThresholdPaise

  if (isHighValue && (signals.isOverdue || isStalled)) reasons.push('HIGH_VALUE_AT_RISK')
  if (signals.isOverdue) reasons.push('OVERDUE_NEXT_ACTION')
  if (signals.isMissingNextAction) reasons.push('MISSING_NEXT_ACTION')
  if (isStalled) reasons.push('STALLED_IN_STAGE')
  if (signals.daysSinceActivity > thresholds.dormancyDays) reasons.push('NO_RECENT_ACTIVITY')

  return reasons
}

export function isAtRisk(signals: RiskSignals, thresholds: RiskThresholds): boolean {
  return classifyRisk(signals, thresholds).length > 0
}

/** Plain-language reasons, for the UI and the CSV alike. */
export const RISK_REASON_LABELS: Record<RiskReason, string> = {
  HIGH_VALUE_AT_RISK: 'High value, not moving',
  OVERDUE_NEXT_ACTION: 'Follow-up overdue',
  MISSING_NEXT_ACTION: 'No next action',
  STALLED_IN_STAGE: 'Stalled in stage',
  NO_RECENT_ACTIVITY: 'No recent activity',
}

// -------------------------------------------------------------- aggregation --

/**
 * Pipeline Value (§13.1): `sum(estimated_value)` where the stage is neither won,
 * lost **nor nurture**.
 *
 * Nurture is the exclusion people forget. It is a holding stage for work that is
 * real but not currently moving (§9.1); counting it would inflate the pipeline
 * with deals nobody is working this quarter.
 */
export function pipelineValuePaise(
  rows: readonly { valuePaise: number; countsInPipeline: boolean }[],
): number {
  return rows.reduce((sum, row) => (row.countsInPipeline ? sum + row.valuePaise : sum), 0)
}

/** Weighted Pipeline (§13.1), over the same set the Pipeline Value covers. */
export function weightedPipelinePaise(
  rows: readonly { weightedPaise: number; countsInPipeline: boolean }[],
): number {
  return rows.reduce((sum, row) => (row.countsInPipeline ? sum + row.weightedPaise : sum), 0)
}

export type LostReasonShare<T extends string = string> = {
  reason: T
  count: number
  valuePaise: number
  countSharePercent: number | null
  valueSharePercent: number | null
}

/**
 * Lost-reason analysis (Master Phase 3 §14) — count, value and share, largest
 * first.
 *
 * Share is computed against the totals of the rows supplied, so a filtered view
 * ("this branch, this month") reports shares of that filtered set rather than of
 * the company. Percentages of a differently-scoped whole are the classic way a
 * report comes to say something nobody meant.
 */
export function lostReasonShares<T extends string>(
  rows: readonly { reason: T; count: number; valuePaise: number }[],
): { rows: LostReasonShare<T>[]; totalCount: number; totalValuePaise: number } {
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0)
  const totalValuePaise = rows.reduce((sum, row) => sum + row.valuePaise, 0)

  return {
    totalCount,
    totalValuePaise,
    rows: [...rows]
      .sort((a, b) => b.count - a.count || b.valuePaise - a.valuePaise || a.reason.localeCompare(b.reason))
      .map((row) => ({
        reason: row.reason,
        count: row.count,
        valuePaise: row.valuePaise,
        countSharePercent: sharePercent(row.count, totalCount),
        valueSharePercent: sharePercent(row.valuePaise, totalValuePaise),
      })),
  }
}

// ---------------------------------------------------------------- rendering --

/**
 * A percentage for display. **Null renders as an em dash, never as `0%`**
 * (§13.1). This is the single renderer, so no screen can decide otherwise.
 */
export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(fractionDigits)}%`
}

/** A count for display; null and undefined are unknown, not zero. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-IN').format(value)
}

/** A day count for display: `2.5 days`, `1 day`, `—` when unmeasured. */
export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 10) / 10
  return rounded === 1 ? '1 day' : `${rounded} days`
}
