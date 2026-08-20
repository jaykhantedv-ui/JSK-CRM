/**
 * Integration interfaces (§16.4).
 *
 * **DECLARE, DO NOT IMPLEMENT.** Only `WhatsAppIntegration.buildDeepLink` and
 * `NotificationService.sendEmail` have implementations in V1.
 * `AccountingIntegration` and `InventoryIntegration` are type declarations with
 * no implementation and no stub — **do not write fake adapters**, mock clients or
 * "coming soon" handlers. An integration that does not exist must look like it
 * does not exist (CLAUDE.md §14).
 */

export interface AccountingIntegration {
  isEnabled(): boolean
}

export interface InventoryIntegration {
  isEnabled(): boolean
}

export interface WhatsAppIntegration {
  isEnabled(): boolean
  buildDeepLink(phone: string, text?: string): string
}

export interface NotificationService {
  sendEmail(to: string, subject: string, html: string): Promise<void>
}
