import type { Metadata } from 'next'
import Link from 'next/link'

import { PhoneActions } from '@/components/shared/phone-actions'
import { Badge } from '@/components/ui/badge'
import { buttonClass } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CONTACT_CHANNEL_LABELS, INFLUENCE_LABELS, STAKEHOLDER_ROLE_LABELS,
} from '@/lib/labels'
import { formatPhone } from '@/lib/phone'
import { getAccount } from '@/services/account.service'
import { getContact } from '@/services/contact.service'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params
  try {
    const contact = await getContact(id)
    return { title: `${contact.full_name} · JSK CRM` }
  } catch {
    return { title: 'Contact · JSK CRM' }
  }
}

export default async function ContactDetailPage({ params }: { params: Params }) {
  const { id } = await params
  const contact = await getContact(id)

  // The parent may be invisible to this caller even when the contact is not;
  // a missing name is rendered as absent rather than guessed at (§25).
  const account = contact.account_id ? await getAccount(contact.account_id).catch(() => null) : null
  const linked = contact.linked_account_id
    ? await getAccount(contact.linked_account_id).catch(() => null)
    : null

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{contact.full_name}</h1>
          <p className="text-sm text-muted-foreground">
            {STAKEHOLDER_ROLE_LABELS[contact.role]} · {INFLUENCE_LABELS[contact.influence]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PhoneActions phone={contact.phone} label={contact.full_name} size="sm" />
          <Link href={`/contacts/${contact.id}/edit`} className={buttonClass('outline', 'sm')}>
            Edit
          </Link>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          {contact.is_referral_source ? <Badge tone="won">Sends us business</Badge> : null}
        </CardHeader>
        <CardBody>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Phone" value={formatPhone(contact.phone)} />
            <Detail label="Alternate phone" value={formatPhone(contact.alt_phone)} />
            <Detail label="Email" value={contact.email} />
            <Detail label="Prefers" value={CONTACT_CHANNEL_LABELS[contact.preferred_channel]} />
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="mt-0.5">
                {account ? (
                  <Link href={`/accounts/${account.id}`} className="underline underline-offset-4">
                    {account.name}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Works for</dt>
              <dd className="mt-0.5">
                {linked ? (
                  <Link href={`/accounts/${linked.id}`} className="underline underline-offset-4">
                    {linked.name}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <Detail label="Notes" value={contact.notes} />
          </dl>
        </CardBody>
      </Card>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap">{value || '—'}</dd>
    </div>
  )
}
