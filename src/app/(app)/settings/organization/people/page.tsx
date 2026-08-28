import type { Metadata } from 'next'

import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { buttonClass } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { PersonActiveToggle } from '@/features/organization/person-actions'
import { PersonForm, type ManagerOption } from '@/features/organization/person-form'
import { ROLE_LABELS, canAdministerOwner } from '@/lib/permissions'
import { listOutlets } from '@/services/outlet.service'
import { requireUser } from '@/services/auth.service'
import { loadOrganization } from '@/services/user.service'
import { toRoute } from '@/lib/routes'

export const metadata: Metadata = { title: 'People · JSK CRM' }

/**
 * Settings → Organization → People (ADR-040).
 *
 * The table the business asked for: name, email, role, reports to, branch,
 * status.
 *
 * **"Sales Head", never "Manager".** The database role is MANAGER and stays
 * MANAGER — renaming the enum would have meant rewriting every policy and every
 * migration for a word — so the label lives in `ROLE_LABELS` and every screen
 * reads it from there.
 *
 * The list is whatever `users_select` returns, which for an owner or
 * administrator is the whole organisation. Nothing here filters, so nothing here
 * can leak by forgetting to.
 *
 * **Remove deactivates, it does not delete** — see `PersonActiveToggle`. Nothing
 * in this system is hard-deleted, and a person's records outlive their account.
 *
 * `loadOrganization()` is the one helper both organisation screens read from
 * (ADR-041). It resolves each person's manager from the set already fetched —
 * never with a second query — so a `manager_id` pointing outside what the caller
 * may read shows as no manager rather than fetching the row.
 */
export default async function PeoplePage() {
  const [actor, people, branches] = await Promise.all([
    requireUser(),
    loadOrganization(),
    listOutlets({ includeInactive: true }),
  ])

  // Anyone who could be somebody's manager. The form narrows this by the role
  // being added; deciding the pairing here as well would put the rule in two
  // places.
  const managers: ManagerOption[] = people
    .filter((person) => person.is_active && person.role !== 'SALESPERSON')
    .map((person) => ({ id: person.id, name: person.full_name, role: person.role }))

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
        </CardHeader>
        <CardBody className="pt-0">
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Email</th>
                    <th className="py-2 pr-3 font-medium">Role</th>
                    <th className="py-2 pr-3 font-medium">Reports to</th>
                    <th className="py-2 pr-3 font-medium">Branch</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {people.map((person) => (
                    <tr key={person.id}>
                      <td className="py-2 pr-3 font-medium">{person.full_name}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{person.email}</td>
                      <td className="py-2 pr-3">{ROLE_LABELS[person.role]}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{person.managerName ?? '—'}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {person.outletNames.length > 0 ? person.outletNames.join(', ') : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={person.is_active ? 'active' : 'muted'}>
                          {person.is_active ? 'Active' : 'Deactivated'}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {/* The owner's row is the owner's alone (ADR-042).
                              `guard_owner_role()` refuses an administrator's
                              write; not offering the controls is what stops them
                              filling in a form that cannot save. */}
                          {person.role === 'OWNER' && !canAdministerOwner(actor) ? (
                            <span className="text-xs text-muted-foreground">
                              Owner — not editable
                            </span>
                          ) : (
                            <Link
                              href={toRoute(`/settings/organization/people/${person.id}/edit`)}
                              className={buttonClass('secondary', 'sm')}
                              aria-label={`Edit ${person.full_name}`}
                            >
                              Edit
                            </Link>
                          )}
                          {/* Removing yourself would lock the last owner out of
                              their own deployment. `updateUser` refuses it
                              server-side; the button is not offered either. */}
                          {person.role === 'OWNER' && !canAdministerOwner(actor) ? null : (
                            <PersonActiveToggle
                              id={person.id}
                              fullName={person.full_name}
                              isActive={person.is_active}
                              disabled={person.id === actor.id}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a person</CardTitle>
        </CardHeader>
        <CardBody className="pt-0">
          <PersonForm
            managers={managers}
            branches={branches
              .filter((branch) => branch.is_active)
              .map((branch) => ({ id: branch.id, name: branch.name }))}
          />
        </CardBody>
      </Card>
    </div>
  )
}
