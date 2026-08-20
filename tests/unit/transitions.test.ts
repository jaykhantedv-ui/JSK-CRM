import { describe, expect, it } from 'vitest'

import {
  PIPELINE_STAGES,
  STAGES,
  TERMINAL_STAGES,
  allowedTargets,
  checkTransition,
  isBackward,
  isValidTransition,
  requiresElevatedRole,
  type Role,
  type Stage,
} from '@/lib/opportunity/transitions'

/**
 * The COMPLETE stage transition matrix — every valid and invalid pair (§19.1).
 *
 * The expected table below is written out independently of the implementation, on
 * purpose. A test that derives its expectations from the map it is testing proves
 * only that the map equals itself.
 *
 * Source: §9.2, plus the single approved addition `won → qualified` (ADR-007).
 */

const EXPECTED: Record<Stage, Stage[]> = {
  new: ['qualified', 'nurture', 'lost'],
  qualified: ['selection', 'quoted', 'nurture', 'lost', 'new'],
  selection: ['quoted', 'negotiation', 'nurture', 'lost', 'qualified'],
  quoted: ['negotiation', 'verbal_confirmation', 'nurture', 'lost', 'selection'],
  negotiation: ['verbal_confirmation', 'won', 'quoted', 'nurture', 'lost'],
  verbal_confirmation: ['won', 'negotiation', 'nurture', 'lost'],
  nurture: ['qualified', 'selection', 'quoted', 'lost'],
  won: ['qualified'],
  lost: ['new', 'qualified'],
}

describe('the stage list', () => {
  it('has the nine specified stages and no others', () => {
    expect([...STAGES].sort()).toEqual(
      [
        'lost',
        'negotiation',
        'new',
        'nurture',
        'qualified',
        'quoted',
        'selection',
        'verbal_confirmation',
        'won',
      ].sort(),
    )
  })

  it('has no follow_up stage, and must never have one', () => {
    // Follow-up is an action, not a pipeline position (§9.1).
    expect(STAGES).not.toContain('follow_up' as Stage)
  })

  it('excludes nurture and the terminal stages from the pipeline', () => {
    expect(PIPELINE_STAGES).not.toContain('nurture')
    expect(PIPELINE_STAGES).not.toContain('won')
    expect(PIPELINE_STAGES).not.toContain('lost')
    expect(PIPELINE_STAGES).toHaveLength(6)
  })

  it('treats won and lost as terminal', () => {
    expect([...TERMINAL_STAGES].sort()).toEqual(['lost', 'won'])
  })
})

describe('every pair in the matrix', () => {
  // 9 × 9 = 81 pairs, each asserted explicitly.
  for (const from of STAGES) {
    for (const to of STAGES) {
      const shouldBeValid = EXPECTED[from].includes(to)
      it(`${from} → ${to} is ${shouldBeValid ? 'valid' : 'REJECTED'}`, () => {
        expect(isValidTransition(from, to)).toBe(shouldBeValid)
      })
    }
  }

  it('rejects every self-transition', () => {
    for (const stage of STAGES) {
      expect(isValidTransition(stage, stage)).toBe(false)
    }
  })

  it('leaves won reachable only by the approved reopen', () => {
    expect(EXPECTED.won).toEqual(['qualified'])
    expect(isValidTransition('won', 'lost')).toBe(false)
    expect(isValidTransition('won', 'negotiation')).toBe(false)
  })
})

describe('backward moves', () => {
  it.each([
    ['qualified', 'new'],
    ['selection', 'qualified'],
    ['quoted', 'selection'],
    ['negotiation', 'quoted'],
    ['verbal_confirmation', 'negotiation'],
    ['won', 'qualified'],
    ['lost', 'new'],
  ] as Array<[Stage, Stage]>)('%s → %s is backward', (from, to) => {
    expect(isBackward(from, to)).toBe(true)
  })

  it.each([
    ['new', 'qualified'],
    ['qualified', 'quoted'],
    ['selection', 'negotiation'],
    ['negotiation', 'won'],
  ] as Array<[Stage, Stage]>)('%s → %s is forward', (from, to) => {
    expect(isBackward(from, to)).toBe(false)
  })

  it('does not treat a move to nurture as backward', () => {
    // Nurture is a holding stage beside the pipeline, not behind it.
    expect(isBackward('negotiation', 'nurture')).toBe(false)
    expect(isBackward('new', 'nurture')).toBe(false)
  })

  it('allows skipping forward, because real sales skip stages', () => {
    expect(isValidTransition('qualified', 'quoted')).toBe(true)
    expect(isValidTransition('selection', 'negotiation')).toBe(true)
  })
})

describe('who may perform a transition', () => {
  it.each([
    ['won', 'qualified'],
    ['lost', 'new'],
    ['lost', 'qualified'],
  ] as Array<[Stage, Stage]>)('%s → %s is MANAGER/OWNER only', (from, to) => {
    expect(requiresElevatedRole(from, to)).toBe(true)
  })

  it('leaves ordinary transitions open to a salesperson', () => {
    expect(requiresElevatedRole('new', 'qualified')).toBe(false)
    expect(requiresElevatedRole('quoted', 'selection')).toBe(false)
  })

  it.each([
    ['SALESPERSON', false],
    ['ADMIN', false],
    ['MANAGER', true],
    ['OWNER', true],
  ] as Array<[Role, boolean]>)('a %s may reopen: %s', (role, allowed) => {
    const result = checkTransition({ from: 'won', to: 'qualified', role, reason: 'mis-entered' })
    expect(result.allowed).toBe(allowed)
    if (!result.allowed) expect(result.reason).toBe('ROLE_REQUIRED')
  })
})

describe('checkTransition', () => {
  it('names the reason a transition is refused', () => {
    expect(checkTransition({ from: 'new', to: 'won', role: 'OWNER' })).toEqual({
      allowed: false,
      reason: 'INVALID_TRANSITION',
    })
  })

  it('requires a reason for a backward move', () => {
    expect(checkTransition({ from: 'quoted', to: 'selection', role: 'SALESPERSON' })).toEqual({
      allowed: false,
      reason: 'REASON_REQUIRED',
    })
    expect(
      checkTransition({ from: 'quoted', to: 'selection', role: 'SALESPERSON', reason: '   ' }),
    ).toEqual({ allowed: false, reason: 'REASON_REQUIRED' })
  })

  it('accepts a backward move with a reason', () => {
    expect(
      checkTransition({
        from: 'quoted',
        to: 'selection',
        role: 'SALESPERSON',
        reason: 'customer changed the design',
      }),
    ).toEqual({ allowed: true, requiresReason: true, requiresElevatedRole: false })
  })

  it('needs no reason to move forward', () => {
    expect(checkTransition({ from: 'new', to: 'qualified', role: 'SALESPERSON' })).toEqual({
      allowed: true,
      requiresReason: false,
      requiresElevatedRole: false,
    })
  })

  it('checks the role before the reason, so the message is the useful one', () => {
    expect(checkTransition({ from: 'won', to: 'qualified', role: 'SALESPERSON' })).toEqual({
      allowed: false,
      reason: 'ROLE_REQUIRED',
    })
  })
})

describe('allowedTargets', () => {
  it('hides the reopen from a salesperson', () => {
    expect(allowedTargets('won', 'SALESPERSON')).toEqual([])
    expect(allowedTargets('lost', 'SALESPERSON')).toEqual([])
  })

  it('offers the reopen to a manager', () => {
    expect(allowedTargets('won', 'MANAGER')).toEqual(['qualified'])
    expect(allowedTargets('lost', 'OWNER')).toEqual(['new', 'qualified'])
  })

  it('offers the ordinary targets to everyone', () => {
    expect(allowedTargets('new', 'SALESPERSON')).toEqual(['qualified', 'nurture', 'lost'])
  })
})
