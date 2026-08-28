import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonClass } from '@/components/ui/button'
import { PersonEditForm } from '@/features/organization/person-edit-form'
import type { ManagerOption } from '@/features/organization/person-form'
import { ROLE_LABELS } from '@/lib/permissions'
import { listOutlets } from '@/services/outlet.service'
import { loadOrganization } from '@/services/user.service'

export const metadata: Metadata = { title: 'Edit person · JSK CRM' }

/**
 * Settings → Organization → People → Edit (ADR-040).
 *
 * A route of its own, as every other edit screen in the application has
 * (`/accounts/[id]/edit`, `/contacts/[id]/edit`, `/projects/[id]/edit`), rather
 * than a dialog: it is linkable, it survives a refresh, and it needs no modal
 * primitive that does not exist in this UI kit.
 *
 * **The person is looked up in the caller's own authorised set.** Not fetched by
 * id with a separate query — `loadOrganization()` returns what `users_select`
 * allows, and an id outside it is `notFound()`. So the guard that decides who
 * may be edited is the same one that decides who may be seen, and there is no
 * second place for it to be got wrong. `updateUser` re-checks OWNER/ADMIN
 * server-side regardless, and `users_admin_update` is the control.
 */
export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [people, branches] = await Promise.all([
    loadOrganization(),
    listOutlets({ includeInactive: true }),
  ])

  const person = people.find((candidate) => candidate.id === id)
  if (!person) notFound()

  // Anyone who could be somebody's manager. The form narrows this by the role
  // being saved; deciding the pairing here as well would put the rule in two
  // places.
  const managers: ManagerOption[] = people
    .filter((candidate) => candidate.is_active && candidate.role !== 'SALESPERSON')
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.full_name,
      role: candidate.role,
    }))

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{person.full_name}</CardTitle>
        </CardHeader>
        <CardBody className="pt-0">
          <PersonEditForm
            person={{
              id: person.id,
              fullName: person.full_name,
              phone: person.phone,
              email: person.email,
              role: person.role,
              isActive: person.is_active,
              managerId: person.manager_id,
              outletIds: person.outletIds,
            }}
            managers={managers}
            branches={branches
              .filter((branch) => branch.is_active || person.outletIds.includes(branch.id))
              .map((branch) => ({
                id: branch.id,
                name: branch.is_active ? branch.name : `${branch.name} (closed)`,
              }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Currently</CardTitle>
        </CardHeader>
        <CardBody className="pt-0">
          <dl className="flex flex-col gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Role</dt>
              <dd>{ROLE_LABELS[person.role]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Reports to</dt>
              <dd>{person.managerName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Branch</dt>
              <dd>{person.outletNames.length > 0 ? person.outletNames.join(', ') : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>{person.is_active ? 'Active' : 'Deactivated'}</dd>
            </div>
          </dl>

          <Link
            href="/settings/organization/people"
            className={buttonClass('secondary', 'sm', 'mt-4')}
          >
            Back to People
          </Link>
        </CardBody>
      </Card>
    </div>
  )
}
