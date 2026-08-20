import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { requireCronAuth, runCronJob } from '@/lib/cron'

/**
 * Cron authentication (§14.7, §20 of the phase brief).
 *
 * `/api/cron/*` is exempt from the session middleware because it authenticates by
 * shared secret. **That exemption is only safe because every route calls
 * `requireCronAuth`**, so these tests are the proof that the function it calls
 * actually refuses.
 *
 * The refusal must be a machine-readable 401 and never a redirect: a redirect
 * answers a scheduler with 200 and a page of HTML, which reads as a successful
 * run and hides a broken job for as long as nobody looks.
 */

const SECRET = 'a-long-enough-cron-secret'

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://crm.example.com/api/cron/daily-digest', { headers })
}

describe('requireCronAuth', () => {
  const original = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
  })

  afterEach(() => {
    process.env.CRON_SECRET = original
  })

  it('refuses a request with no secret', async () => {
    const response = requireCronAuth(request())
    expect(response?.status).toBe(401)
    await expect(response?.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('refuses a wrong secret', async () => {
    const response = requireCronAuth(request({ authorization: `Bearer ${SECRET}-wrong` }))
    expect(response?.status).toBe(401)
    await expect(response?.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('refuses a secret of the right length but the wrong value', () => {
    const wrong = 'b'.repeat(SECRET.length)
    expect(requireCronAuth(request({ authorization: `Bearer ${wrong}` }))?.status).toBe(401)
  })

  it('accepts the correct bearer token', () => {
    expect(requireCronAuth(request({ authorization: `Bearer ${SECRET}` }))).toBeNull()
  })

  it('accepts the x-cron-secret header for a manual run', () => {
    expect(requireCronAuth(request({ 'x-cron-secret': SECRET }))).toBeNull()
  })

  it('never answers with a redirect', () => {
    const response = requireCronAuth(request())
    expect(response?.status).toBe(401)
    expect(response?.headers.get('location')).toBeNull()
  })

  it('leaks nothing about why it refused', async () => {
    const body = await requireCronAuth(request({ authorization: 'Bearer nope' }))?.json()
    expect(Object.keys(body)).toEqual(['error'])
    expect(JSON.stringify(body)).not.toContain(SECRET)
  })

  it('refuses EVERY request when CRON_SECRET is not configured', async () => {
    // "No secret configured" must never mean "no authentication required" — that
    // would leave the routes open on the deployment least likely to notice.
    delete process.env.CRON_SECRET
    const response = requireCronAuth(request({ authorization: 'Bearer anything' }))
    expect(response?.status).toBe(401)
    await expect(response?.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('ignores a non-bearer Authorization header', () => {
    expect(requireCronAuth(request({ authorization: `Basic ${SECRET}` }))?.status).toBe(401)
  })
})

describe('runCronJob — the §14.7 response contract', () => {
  it('returns { processed, sent, failed, durationMs }', async () => {
    const response = await runCronJob('test', async () => ({ processed: 3, sent: 2, failed: 1 }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(Object.keys(body).sort()).toEqual(['durationMs', 'failed', 'processed', 'sent'])
    expect(body).toMatchObject({ processed: 3, sent: 2, failed: 1 })
    expect(typeof body.durationMs).toBe('number')
  })

  it('answers the same shape when the job throws, and leaks no detail', async () => {
    const response = await runCronJob('test', async () => {
      throw new Error('connection to db-prod-1.internal refused')
    })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ processed: 0, sent: 0, failed: 1 })
    expect(JSON.stringify(body)).not.toContain('db-prod-1')
  })

  it('runs the failure hook when the job throws (ADR-014)', async () => {
    let recorded = false
    await runCronJob(
      'maintenance',
      async () => {
        throw new Error('boom')
      },
      async () => {
        recorded = true
      },
    )
    expect(recorded).toBe(true)
  })

  it('does not run the failure hook on success', async () => {
    let recorded = false
    await runCronJob(
      'maintenance',
      async () => ({ processed: 1, sent: 0, failed: 0 }),
      async () => {
        recorded = true
      },
    )
    expect(recorded).toBe(false)
  })

  it('still answers when the failure hook itself throws', async () => {
    const response = await runCronJob(
      'maintenance',
      async () => {
        throw new Error('boom')
      },
      async () => {
        throw new Error('and the counter write failed too')
      },
    )
    expect(response.status).toBe(500)
  })
})
