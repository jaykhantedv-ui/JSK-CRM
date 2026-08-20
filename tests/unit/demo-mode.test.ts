import { afterEach, describe, expect, it } from 'vitest'

/**
 * Demo mode must be OFF unless a deployment turns it on (§6, §7).
 *
 * The banner is the only thing standing between a training browser tab and
 * someone reading invented order values as though they were the real pipeline,
 * so "off by default" is a property worth asserting rather than assuming.
 *
 * `isDemoMode` is re-imported per case because the module reads `process.env` at
 * call time; the reset keeps the cases independent.
 */
const ORIGINAL = process.env.NEXT_PUBLIC_DEMO_MODE

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE
  else process.env.NEXT_PUBLIC_DEMO_MODE = ORIGINAL
})

async function isDemoMode() {
  const mod = await import('@/lib/demo')
  return mod.isDemoMode()
}

describe('demo mode', () => {
  it('is off when the variable is absent — the production case', async () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE
    expect(await isDemoMode()).toBe(false)
  })

  it('is on only for exactly "1"', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = '1'
    expect(await isDemoMode()).toBe(true)
  })

  it.each(['0', '', 'true', 'yes', 'TRUE', 'demo'])(
    'stays off for %o — no truthy-string accident enables it in production',
    async (value) => {
      process.env.NEXT_PUBLIC_DEMO_MODE = value
      expect(await isDemoMode()).toBe(false)
    },
  )
})
