import type { NotificationService } from './types'

/**
 * Email, via Resend (§16.4, §17.1, M-28).
 *
 * **No dependency.** Resend's send endpoint is one authenticated POST, and the
 * SDK would ship a wrapper around `fetch` to do it. This is the same call the
 * repository already made twice — `Intl` instead of `date-fns-tz` (M-13), a
 * hand-rolled magic-byte check instead of `file-type` (M-14) — and it keeps
 * §17.1's list frozen. Resend remains the V1 email implementation; only the
 * client is ours.
 *
 * §16.4 declares four integration interfaces and only two have implementations in
 * V1. This is one; `whatsapp.ts` is the other. `AccountingIntegration` and
 * `InventoryIntegration` stay type declarations with no implementation and no
 * stub — **do not write fake adapters** (CLAUDE.md §14).
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email is not configured: RESEND_API_KEY and RESEND_FROM_EMAIL are both required.')
    this.name = 'EmailNotConfiguredError'
  }
}

/**
 * Is email configured?
 *
 * M-28: **Resend needs a verified sender address before any email sends.** A
 * deployment missing either variable does not silently pretend to send — the
 * cron routes report the attempts as failures, which is what an operator needs to
 * see.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim())
}

/**
 * The V1 `NotificationService`.
 *
 * One recipient per call, deliberately: §14.3 requires each salesperson to get
 * their own email and **never a group email**, and an interface that cannot
 * express a group cannot accidentally send one.
 */
export const notificationService: NotificationService = {
  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY?.trim()
    const from = process.env.RESEND_FROM_EMAIL?.trim()

    if (!apiKey || !from) throw new EmailNotConfiguredError()

    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    })

    if (!response.ok) {
      // The status and Resend's own message, and nothing of the request: §15.8
      // forbids logging tokens or full bodies containing personal data, and the
      // body here is a customer follow-up list.
      const detail = await response.text().catch(() => '')
      throw new Error(`Resend refused the message (${response.status}): ${detail.slice(0, 200)}`)
    }
  },
}

/**
 * Minimal HTML escaping for values interpolated into an email body.
 *
 * A customer named `<script>` is not an attack on the CRM but it is an attack on
 * whatever renders the mail, and the same rule applies here as anywhere else the
 * application emits markup (§25).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The shared wrapper every operational email uses.
 *
 * Plain, narrow, and readable on a phone — these are read at 08:30 on the way to
 * a showroom, not at a desk. **The word "Revenue" never appears** (§2.4); the
 * vocabulary is Pipeline Value, Won Value and Weighted Pipeline.
 */
export function emailShell(title: string, sections: string): string {
  return [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f4;',
    'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;color:#1c1917">',
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">',
    `<h1 style="margin:0 0 16px;font-size:18px;font-weight:600">${escapeHtml(title)}</h1>`,
    sections,
    '<p style="margin:24px 0 0;font-size:12px;color:#78716c">JSK CRM</p>',
    '</div></body></html>',
  ].join('')
}

/** A titled list. Renders nothing at all when the list is empty. */
export function emailSection(heading: string, items: readonly string[]): string {
  if (items.length === 0) return ''
  return [
    `<h2 style="margin:20px 0 8px;font-size:14px;font-weight:600">${escapeHtml(heading)}</h2>`,
    '<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6">',
    ...items.map((item) => `<li>${item}</li>`),
    '</ul>',
  ].join('')
}
