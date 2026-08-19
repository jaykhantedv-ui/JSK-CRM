import { describe, expect, it } from 'vitest'

import { cn } from '@/lib/utils'

/**
 * Phase 1 infrastructure test. It proves Vitest executes, TypeScript compiles
 * under the test runner, and the `@/*` path alias resolves.
 *
 * The real unit suite (§19.1) — phone normalisation, money conversion, the full
 * stage transition matrix, dashboard metrics, IST date boundaries — arrives with
 * the code it tests, from Phase 6 onward.
 */
describe('Phase 1 foundation', () => {
  it('runs Vitest', () => {
    expect(true).toBe(true)
  })

  it('resolves the @/* path alias and merges class names', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
})
