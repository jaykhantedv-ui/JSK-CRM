import { MessageCircle, Phone } from 'lucide-react'

import { buttonClass } from '@/components/ui/button'
import { formatPhone, normalizePhone, whatsappDeepLink } from '@/lib/phone'

/**
 * Tap-to-call and WhatsApp (§12.5, §16.4).
 *
 * The WhatsApp integration in V1 is exactly this deep link — there is no Business
 * API, no webhook and no message ingestion (§2.3). `buildDeepLink` is one of only
 * two integration functions with an implementation at all.
 *
 * A record with no phone renders nothing rather than a dead button.
 */
export function PhoneActions({
  phone,
  whatsappPhone,
  size = 'md',
  label,
}: {
  phone: string | null | undefined
  whatsappPhone?: string | null
  size?: 'sm' | 'md'
  label?: string
}) {
  const normalized = normalizePhone(phone)
  if (!normalized) return null

  const whatsapp = normalizePhone(whatsappPhone) ?? normalized

  return (
    <div className="flex items-center gap-2">
      <a
        href={`tel:+91${normalized}`}
        className={buttonClass('outline', size)}
        aria-label={`Call ${label ?? formatPhone(normalized)}`}
      >
        <Phone className="size-4" aria-hidden />
        <span className={size === 'sm' ? 'sr-only sm:not-sr-only' : ''}>Call</span>
      </a>
      <a
        href={whatsappDeepLink(whatsapp)}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass('outline', size)}
        aria-label={`WhatsApp ${label ?? formatPhone(normalized)}`}
      >
        <MessageCircle className="size-4" aria-hidden />
        <span className={size === 'sm' ? 'sr-only sm:not-sr-only' : ''}>WhatsApp</span>
      </a>
    </div>
  )
}
