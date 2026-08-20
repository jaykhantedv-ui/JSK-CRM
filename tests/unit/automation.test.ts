import { afterEach, describe, expect, it, vi } from 'vitest'

import { MAINTENANCE_ALERT_THRESHOLD, shouldSendOwnerSummary } from '@/services/automation.service'
import { ROLLBACK_WINDOW_DAYS, rollbackEligibility } from '@/services/import.service'
import { escapeHtml, emailSection, isEmailConfigured } from '@/services/integrations/notification'

/**
 * The scheduling and eligibility rules behind the cron jobs (§14, §20.6).
 *
 * Everything here is a pure function on purpose. The owner-summary hour gate
 * (ADR-011) and the rollback window (§20.6) are the two rules where being wrong
 * is silent — a summary that never sends, or an undo button offered after the
 * database will refuse it — so both are testable without a database.
 */

/** An instant expressed as an Asia/Kolkata wall-clock time. */
function ist(dateTime: string): Date {
  return new Date(`${dateTime}+05:30`)
}

describe('shouldSendOwnerSummary — the ADR-011 hour gate', () => {
  const daily = { cadence: 'daily' as const, hour: 19 }

  it('sends in the configured IST hour', () => {
    expect(shouldSendOwnerSummary(daily, ist('2026-08-20T19:00:00'))).toBe(true)
    expect(shouldSendOwnerSummary(daily, ist('2026-08-20T19:59:00'))).toBe(true)
  })

  it('skips the other twenty-three hours', () => {
    const sending = Array.from({ length: 24 }, (_, hour) =>
      shouldSendOwnerSummary(daily, ist(`2026-08-20T${String(hour).padStart(2, '0')}:30:00`)),
    )
    expect(sending.filter(Boolean)).toHaveLength(1)
    expect(sending[19]).toBe(true)
  })

  it('gates on the IST hour, not the UTC hour (B-10)', () => {
    // 19:00 IST is 13:30 UTC. A gate comparing UTC hours would fire at 19:00 UTC,
    // which is 00:30 the next morning in Erode.
    expect(shouldSendOwnerSummary(daily, new Date('2026-08-20T13:30:00Z'))).toBe(true)
    expect(shouldSendOwnerSummary(daily, new Date('2026-08-20T19:00:00Z'))).toBe(false)
  })

  it('honours a changed hour without any code change', () => {
    // The whole point of ADR-011: the send time is a setting, not a deployment.
    expect(shouldSendOwnerSummary({ cadence: 'daily', hour: 7 }, ist('2026-08-20T07:15:00'))).toBe(true)
    expect(shouldSendOwnerSummary({ cadence: 'daily', hour: 7 }, ist('2026-08-20T19:15:00'))).toBe(false)
  })

  describe('weekly', () => {
    const weekly = { cadence: 'weekly' as const, hour: 19 }

    it('sends on Monday in the configured hour', () => {
      // 2026-08-24 is a Monday.
      expect(shouldSendOwnerSummary(weekly, ist('2026-08-24T19:10:00'))).toBe(true)
    })

    it('does not send on other days', () => {
      expect(shouldSendOwnerSummary(weekly, ist('2026-08-25T19:10:00'))).toBe(false)
      expect(shouldSendOwnerSummary(weekly, ist('2026-08-23T19:10:00'))).toBe(false)
    })

    it('uses the IST weekday, not the UTC one', () => {
      // 2026-08-24T00:30 IST is still Sunday 19:00 UTC. The business day is IST.
      expect(shouldSendOwnerSummary({ cadence: 'weekly', hour: 0 }, ist('2026-08-24T00:30:00'))).toBe(
        true,
      )
    })
  })
})

describe('rollbackEligibility (§20.6)', () => {
  const completedAt = '2026-08-20T06:00:00.000Z'
  const base = { status: 'COMPLETED', completedAt, editedSinceImport: false }

  it('allows a rollback inside the window with nothing edited', () => {
    const result = rollbackEligibility({ ...base, now: new Date('2026-08-22T06:00:00Z') })
    expect(result.eligible).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('refuses once a record has been edited', () => {
    const result = rollbackEligibility({
      ...base,
      editedSinceImport: true,
      now: new Date('2026-08-21T06:00:00Z'),
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/edited/i)
  })

  it('refuses after the window expires', () => {
    const justAfter = new Date(
      new Date(completedAt).getTime() + (ROLLBACK_WINDOW_DAYS * 24 + 1) * 60 * 60 * 1000,
    )
    const result = rollbackEligibility({ ...base, now: justAfter })
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/7 days/)
  })

  it('allows it at the very edge of the window', () => {
    const justBefore = new Date(
      new Date(completedAt).getTime() + ROLLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000 - 1000,
    )
    expect(rollbackEligibility({ ...base, now: justBefore }).eligible).toBe(true)
  })

  it('refuses a batch that was never completed', () => {
    expect(
      rollbackEligibility({ status: 'REVIEW', completedAt: null, editedSinceImport: false, now: new Date() })
        .eligible,
    ).toBe(false)
  })

  it('refuses a batch already rolled back', () => {
    const result = rollbackEligibility({ ...base, status: 'ROLLED_BACK', now: new Date(completedAt) })
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/already/i)
  })
})

describe('maintenance failure state (ADR-014)', () => {
  it('alerts at exactly two consecutive failures', () => {
    // Not one — a single failure is usually a blip. Not three — by then nobody
    // has been told. And once, not nightly thereafter.
    expect(MAINTENANCE_ALERT_THRESHOLD).toBe(2)
  })
})

describe('email configuration (M-28)', () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env.RESEND_API_KEY = original.RESEND_API_KEY
    process.env.RESEND_FROM_EMAIL = original.RESEND_FROM_EMAIL
    vi.restoreAllMocks()
  })

  it('needs both the key and a verified sender', () => {
    process.env.RESEND_API_KEY = 'test-key'
    process.env.RESEND_FROM_EMAIL = ''
    expect(isEmailConfigured()).toBe(false)

    process.env.RESEND_FROM_EMAIL = 'crm@example.com'
    expect(isEmailConfigured()).toBe(true)

    process.env.RESEND_API_KEY = ''
    expect(isEmailConfigured()).toBe(false)
  })
})

describe('email rendering', () => {
  it('escapes a customer name that looks like markup', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
    expect(escapeHtml(`Ravi "R" & Co's`)).toBe('Ravi &quot;R&quot; &amp; Co&#39;s')
  })

  it('renders nothing at all for an empty section', () => {
    // §14.3: a digest with nothing in it is not sent, and a section with nothing
    // in it is not rendered — an email of empty headings reads as a broken job.
    expect(emailSection('Overdue', [])).toBe('')
    expect(emailSection('Overdue', ['one'])).toContain('Overdue')
  })
})
