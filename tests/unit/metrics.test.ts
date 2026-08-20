import { describe, expect, it } from 'vitest'

import {
  averageOpportunityValuePaise,
  classifyRisk,
  formatCount,
  formatDays,
  formatPercent,
  isAtRisk,
  lostReasonShares,
  percentage,
  pipelineValuePaise,
  quoteToOrderConversion,
  ratio,
  sharePercent,
  targetProgress,
  weightedPipelinePaise,
  type RiskSignals,
  type RiskThresholds,
} from '@/lib/metrics'

/**
 * Every management metric (§13.1, Master Phase 3 §20).
 *
 * The zero-denominator cases are not edge cases here; they are the point. §13.1
 * requires Win Rate to be null rather than 0% when nothing closed, and a test
 * suite that only checked the happy path would let `0%` ship and quietly
 * misreport a quiet month as a catastrophic one.
 */

// Thresholds are ALWAYS supplied by the caller. These are test inputs, not the
// business's values — the approved figures live in migration 014 and are read
// through the settings service (CLAUDE.md §3).
const THRESHOLDS: RiskThresholds = { dormancyDays: 30, highValueThresholdPaise: 30_000_000 }

function signals(overrides: Partial<RiskSignals> = {}): RiskSignals {
  return {
    isOverdue: false,
    isMissingNextAction: false,
    daysInStage: 0,
    daysSinceActivity: 0,
    stageStallDays: 14,
    estimatedValuePaise: 1_000_000,
    ...overrides,
  }
}

describe('ratio and percentage', () => {
  it('divides when the denominator is positive', () => {
    expect(ratio(1, 4)).toBe(0.25)
    expect(percentage(1, 4)).toBe(25)
  })

  it('returns null for a zero denominator rather than zero', () => {
    expect(ratio(0, 0)).toBeNull()
    expect(ratio(5, 0)).toBeNull()
    expect(percentage(0, 0)).toBeNull()
  })

  it('returns null for a negative denominator', () => {
    expect(ratio(5, -1)).toBeNull()
  })

  it('returns null rather than NaN or Infinity for non-finite input', () => {
    expect(ratio(Number.NaN, 10)).toBeNull()
    expect(ratio(10, Number.NaN)).toBeNull()
    expect(ratio(Number.POSITIVE_INFINITY, 10)).toBeNull()
  })

  it('rounds a percentage to one decimal place', () => {
    expect(percentage(1, 3)).toBe(33.3)
    expect(percentage(2, 3)).toBe(66.7)
  })
})

describe('win rate (§13.1)', () => {
  // The rule the specification states outright: null when the denominator is 0,
  // display "—", never 0%.
  it('is null when nothing closed in the period', async () => {
    const { winRate } = await import('@/lib/metrics')
    expect(winRate(0, 0)).toBeNull()
    expect(formatPercent(winRate(0, 0))).toBe('—')
  })

  it('is 100 when everything closed was won', async () => {
    const { winRate } = await import('@/lib/metrics')
    expect(winRate(7, 0)).toBe(100)
  })

  it('is 0 when everything closed was lost — a real zero, not an unknown', async () => {
    const { winRate } = await import('@/lib/metrics')
    expect(winRate(0, 4)).toBe(0)
    expect(formatPercent(winRate(0, 4))).toBe('0%')
  })

  it('counts only closed opportunities, so open work cannot depress it', async () => {
    const { winRate } = await import('@/lib/metrics')
    // Three won, one lost, and any number still open: 75%.
    expect(winRate(3, 1)).toBe(75)
  })
})

describe('quote-to-order conversion (Master Phase 3 §11)', () => {
  it('divides wins after a quotation by everything that reached quotation', () => {
    expect(quoteToOrderConversion(3, 12)).toBe(25)
  })

  it('is null when nothing reached quotation', () => {
    expect(quoteToOrderConversion(0, 0)).toBeNull()
    expect(formatPercent(quoteToOrderConversion(0, 0))).toBe('—')
  })

  it('is 0 when quotations went out and none converted', () => {
    expect(quoteToOrderConversion(0, 9)).toBe(0)
  })

  it('reaches 100 when every quoted deal converted', () => {
    expect(quoteToOrderConversion(5, 5)).toBe(100)
  })
})

describe('average opportunity value (§13.1)', () => {
  it('is Won Value divided by the won count, in whole paise', () => {
    expect(averageOpportunityValuePaise(30_000_000, 4)).toBe(7_500_000)
  })

  it('rounds to whole paise rather than leaving a fraction of a paisa', () => {
    expect(averageOpportunityValuePaise(10_000_000, 3)).toBe(3_333_333)
  })

  it('is null when nothing was won', () => {
    expect(averageOpportunityValuePaise(0, 0)).toBeNull()
  })
})

describe('sales versus target (Master Phase 3 §10)', () => {
  it('reports achievement and the remaining gap', () => {
    const progress = targetProgress(75_000_000, 100_000_000)
    expect(progress.achievementPercent).toBe(75)
    expect(progress.gapPaise).toBe(25_000_000)
    expect(progress.isMet).toBe(false)
  })

  it('clamps the gap at zero once the target is beaten', () => {
    const progress = targetProgress(120_000_000, 100_000_000)
    expect(progress.achievementPercent).toBe(120)
    expect(progress.gapPaise).toBe(0)
    expect(progress.isMet).toBe(true)
  })

  it('treats an absent target as unmeasurable, not as zero', () => {
    const progress = targetProgress(50_000_000, null)
    expect(progress.targetPaise).toBeNull()
    expect(progress.achievementPercent).toBeNull()
    expect(progress.gapPaise).toBeNull()
    expect(progress.isMet).toBe(false)
    expect(formatPercent(progress.achievementPercent)).toBe('—')
  })

  it('distinguishes a target of zero from no target at all', () => {
    // Zero is how a target is withdrawn (ADR-021 — the table has no DELETE
    // policy). It is met by definition and must not read as a 0% failure.
    const zero = targetProgress(0, 0)
    expect(zero.targetPaise).toBe(0)
    expect(zero.isMet).toBe(true)
    expect(zero.gapPaise).toBe(0)
    expect(zero.achievementPercent).toBeNull()
  })

  it('treats undefined the same as null', () => {
    expect(targetProgress(10, undefined).targetPaise).toBeNull()
  })
})

describe('at-risk classification (Master Phase 3 §9)', () => {
  it('finds nothing wrong with a healthy opportunity', () => {
    expect(classifyRisk(signals(), THRESHOLDS)).toEqual([])
    expect(isAtRisk(signals(), THRESHOLDS)).toBe(false)
  })

  it('flags an overdue next action', () => {
    expect(classifyRisk(signals({ isOverdue: true }), THRESHOLDS)).toEqual(['OVERDUE_NEXT_ACTION'])
  })

  it('flags a missing next action', () => {
    expect(classifyRisk(signals({ isMissingNextAction: true }), THRESHOLDS)).toEqual([
      'MISSING_NEXT_ACTION',
    ])
  })

  it('flags a stage held past its configured stall threshold', () => {
    expect(classifyRisk(signals({ daysInStage: 15, stageStallDays: 14 }), THRESHOLDS)).toEqual([
      'STALLED_IN_STAGE',
    ])
  })

  it('does not flag a stage sitting exactly on its threshold', () => {
    // "days_in_stage > stage_stall_days" (§13.1) — strictly greater. A stage on
    // day 14 of a 14-day threshold has not yet breached it.
    expect(classifyRisk(signals({ daysInStage: 14, stageStallDays: 14 }), THRESHOLDS)).toEqual([])
  })

  it('never flags a stall when the stage has no configured threshold', () => {
    // `stage_stall_days` has no entry for won, lost or nurture. An unconfigured
    // stage must not become permanently stalled by default.
    expect(classifyRisk(signals({ daysInStage: 9_999, stageStallDays: null }), THRESHOLDS)).toEqual([])
  })

  it('flags an opportunity with no recent activity', () => {
    expect(classifyRisk(signals({ daysSinceActivity: 31 }), THRESHOLDS)).toEqual([
      'NO_RECENT_ACTIVITY',
    ])
    expect(classifyRisk(signals({ daysSinceActivity: 30 }), THRESHOLDS)).toEqual([])
  })

  it('flags high value only when it is ALSO overdue or stalled', () => {
    const bigAndHealthy = signals({ estimatedValuePaise: 50_000_000 })
    expect(classifyRisk(bigAndHealthy, THRESHOLDS)).toEqual([])

    const bigAndOverdue = signals({ estimatedValuePaise: 50_000_000, isOverdue: true })
    expect(classifyRisk(bigAndOverdue, THRESHOLDS)).toEqual([
      'HIGH_VALUE_AT_RISK',
      'OVERDUE_NEXT_ACTION',
    ])

    const bigAndStalled = signals({
      estimatedValuePaise: 50_000_000,
      daysInStage: 30,
      stageStallDays: 14,
    })
    expect(classifyRisk(bigAndStalled, THRESHOLDS)).toEqual([
      'HIGH_VALUE_AT_RISK',
      'STALLED_IN_STAGE',
    ])
  })

  it('treats a value exactly on the high-value threshold as high value', () => {
    const onThreshold = signals({ estimatedValuePaise: 30_000_000, isOverdue: true })
    expect(classifyRisk(onThreshold, THRESHOLDS)).toContain('HIGH_VALUE_AT_RISK')

    const justBelow = signals({ estimatedValuePaise: 29_999_999, isOverdue: true })
    expect(classifyRisk(justBelow, THRESHOLDS)).not.toContain('HIGH_VALUE_AT_RISK')
  })

  it('never returns HIGH_VALUE_AT_RISK as the only reason', () => {
    // This is what lets migration 022 filter on the union of the other four
    // reasons without restating the rule: high-value-at-risk is a strict subset.
    const cases: RiskSignals[] = [
      signals({ estimatedValuePaise: 90_000_000 }),
      signals({ estimatedValuePaise: 90_000_000, isOverdue: true }),
      signals({ estimatedValuePaise: 90_000_000, daysInStage: 40, stageStallDays: 10 }),
      signals({ estimatedValuePaise: 90_000_000, daysSinceActivity: 90 }),
      signals({ estimatedValuePaise: 90_000_000, isMissingNextAction: true }),
    ]

    for (const input of cases) {
      const reasons = classifyRisk(input, THRESHOLDS)
      if (reasons.includes('HIGH_VALUE_AT_RISK')) {
        expect(reasons.length).toBeGreaterThan(1)
      }
    }
  })

  it('lists every applicable reason, escalation first', () => {
    const everything = signals({
      estimatedValuePaise: 90_000_000,
      isOverdue: true,
      isMissingNextAction: true,
      daysInStage: 40,
      stageStallDays: 10,
      daysSinceActivity: 60,
    })

    expect(classifyRisk(everything, THRESHOLDS)).toEqual([
      'HIGH_VALUE_AT_RISK',
      'OVERDUE_NEXT_ACTION',
      'MISSING_NEXT_ACTION',
      'STALLED_IN_STAGE',
      'NO_RECENT_ACTIVITY',
    ])
  })

  it('reads thresholds from its arguments, never from a constant', () => {
    const relaxed: RiskThresholds = { dormancyDays: 90, highValueThresholdPaise: 100_000_000 }
    const row = signals({ daysSinceActivity: 60, estimatedValuePaise: 50_000_000, isOverdue: true })

    expect(classifyRisk(row, THRESHOLDS)).toContain('NO_RECENT_ACTIVITY')
    expect(classifyRisk(row, relaxed)).not.toContain('NO_RECENT_ACTIVITY')
    expect(classifyRisk(row, relaxed)).not.toContain('HIGH_VALUE_AT_RISK')
  })
})

describe('pipeline aggregation (§13.1)', () => {
  const byStage = [
    { stage: 'new', valuePaise: 10_000_000, weightedPaise: 1_000_000, countsInPipeline: true },
    { stage: 'quoted', valuePaise: 40_000_000, weightedPaise: 24_000_000, countsInPipeline: true },
    // Nurture is the exclusion people forget.
    { stage: 'nurture', valuePaise: 90_000_000, weightedPaise: 4_500_000, countsInPipeline: false },
  ]

  it('excludes nurture from Pipeline Value', () => {
    expect(pipelineValuePaise(byStage)).toBe(50_000_000)
  })

  it('excludes nurture from Weighted Pipeline too', () => {
    expect(weightedPipelinePaise(byStage)).toBe(25_000_000)
  })

  it('is zero over an empty set, which is a real zero', () => {
    expect(pipelineValuePaise([])).toBe(0)
    expect(weightedPipelinePaise([])).toBe(0)
  })
})

describe('lost-reason analysis (Master Phase 3 §14)', () => {
  const rows = [
    { reason: 'PRICE', count: 6, valuePaise: 60_000_000 },
    { reason: 'STOCK_UNAVAILABLE', count: 3, valuePaise: 15_000_000 },
    { reason: 'DELIVERY_TIME', count: 1, valuePaise: 25_000_000 },
  ] as const

  it('orders by count, largest first', () => {
    const { rows: shares } = lostReasonShares(rows)
    expect(shares.map((row) => row.reason)).toEqual(['PRICE', 'STOCK_UNAVAILABLE', 'DELIVERY_TIME'])
  })

  it('computes count share and value share independently', () => {
    const { rows: shares, totalCount, totalValuePaise } = lostReasonShares(rows)
    expect(totalCount).toBe(10)
    expect(totalValuePaise).toBe(100_000_000)

    // Delivery time is one loss in ten but a quarter of the value lost — the two
    // shares telling different stories is precisely why both are reported.
    const delivery = shares.find((row) => row.reason === 'DELIVERY_TIME')
    expect(delivery?.countSharePercent).toBe(10)
    expect(delivery?.valueSharePercent).toBe(25)
  })

  it('returns null shares rather than dividing by zero on an empty set', () => {
    const { rows: shares, totalCount } = lostReasonShares([])
    expect(shares).toEqual([])
    expect(totalCount).toBe(0)
  })

  it('handles reasons whose losses carry no recorded value', () => {
    const { rows: shares } = lostReasonShares([{ reason: 'NO_RESPONSE', count: 2, valuePaise: 0 }])
    expect(shares[0].countSharePercent).toBe(100)
    // No value was lost at all, so a value share is unanswerable, not 0%.
    expect(shares[0].valueSharePercent).toBeNull()
  })

  it('breaks a count tie by value, then by name, so ordering is stable', () => {
    const tied = lostReasonShares([
      { reason: 'BUDGET_CUT', count: 2, valuePaise: 1_000 },
      { reason: 'PRICE', count: 2, valuePaise: 9_000 },
    ])
    expect(tied.rows.map((row) => row.reason)).toEqual(['PRICE', 'BUDGET_CUT'])
  })
})

describe('share percentages', () => {
  it('is null against a zero whole', () => {
    expect(sharePercent(0, 0)).toBeNull()
  })

  it('reaches 100 when the part is the whole', () => {
    expect(sharePercent(7, 7)).toBe(100)
  })
})

describe('display formatting', () => {
  it('renders an unmeasurable percentage as an em dash, never 0%', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(undefined)).toBe('—')
    expect(formatPercent(Number.NaN)).toBe('—')
    expect(formatPercent(0)).toBe('0%')
  })

  it('renders percentages to the requested precision', () => {
    expect(formatPercent(33.33, 1)).toBe('33.3%')
    expect(formatPercent(33.33)).toBe('33%')
  })

  it('groups counts the Indian way', () => {
    expect(formatCount(1_00_000)).toBe('1,00,000')
    expect(formatCount(0)).toBe('0')
    expect(formatCount(null)).toBe('—')
  })

  it('renders day counts in plain language', () => {
    expect(formatDays(1)).toBe('1 day')
    expect(formatDays(2.55)).toBe('2.6 days')
    expect(formatDays(0)).toBe('0 days')
    expect(formatDays(null)).toBe('—')
  })
})
