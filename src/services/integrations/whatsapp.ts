import { whatsappDeepLink } from '@/lib/phone'

import type { WhatsAppIntegration } from './types'

/**
 * WhatsApp (§16.4). **A deep link, and nothing else.**
 *
 * §2.3 puts the WhatsApp Business API, webhooks and message ingestion out of
 * scope for V1, and §14.8 rules out any automated message to a customer. This
 * builds a `wa.me` URL that opens the salesperson's own WhatsApp with the
 * conversation ready — the person still presses send. Nothing here talks to
 * WhatsApp, stores a message, or knows whether one was sent.
 */
export const whatsappIntegration: WhatsAppIntegration = {
  isEnabled: () => true,
  buildDeepLink: (phone: string, text?: string) => whatsappDeepLink(phone, text),
}
