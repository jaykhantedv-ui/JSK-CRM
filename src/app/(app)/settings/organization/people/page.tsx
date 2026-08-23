import type { Metadata } from 'next'

import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { PersonForm, type ManagerOption } from '@/features/organization/person-form'
import { ROLE_LABELS } from '@/lib/permissions'
import { listOutlets } from '@/services/outlet.service'
import { loadOrganization } from '@/services/user.service'

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
 * `loadOrganization()` is the one helper both organisation screens read from
 * (ADR-041). It resolves each person's manager from the set already fetched —
 * never with a second query — so a `manager_id` pointing outside what the caller
 * may read shows as no manager rather than fetching the row.
 */
export default async function PeoplePage() {
  const [people, branches] = await Promise.all([
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
                    <th className="py-2 font-medium">Status</th>
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
                      <td className="py-2">
                        <Badge tone={person.is_active ? 'active' : 'muted'}>
                          {person.is_active ? 'Active' : 'Deactivated'}
                        </Badge>
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
