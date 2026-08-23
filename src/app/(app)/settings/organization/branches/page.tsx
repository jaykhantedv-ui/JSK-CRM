import type { Metadata } from 'next'

import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { BranchForm, BranchToggle } from '@/features/organization/branch-forms'
import { listOutlets } from '@/services/outlet.service'

export const metadata: Metadata = { title: 'Branches · JSK CRM' }

/**
 * Settings → Organization → Branches (ADR-016, ADR-040).
 *
 * **Branch names are data.** Nothing in this repository hard-codes one, and
 * nothing seeds one: the pilot's two branches are created here, by the owner.
 *
 * `listOutlets({ includeInactive: true })` on purpose — this is the one screen
 * that must show a CLOSED branch, because closing and reopening is what it is
 * for. Every other selector reads `listAuthorizedOutlets()`, which offers only
 * active ones, so a closed branch exists here and nowhere else.
 */
export default async function BranchesPage() {
  const outlets = await listOutlets({ includeInactive: true })

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
        </CardHeader>
        <CardBody className="pt-0">
          {outlets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No branches yet. Add the first one on the right — every customer,
              project and opportunity is filed against one.
            </p>
          ) : (
            <ul className="divide-y">
              {outlets.map((outlet) => (
                <li key={outlet.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">
                      {outlet.name}{' '}
                      <span className="text-xs text-muted-foreground">({outlet.code})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{outlet.city ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={outlet.is_active ? 'active' : 'muted'}>
                      {outlet.is_active ? 'Active' : 'Closed'}
                    </Badge>
                    <BranchToggle id={outlet.id} isActive={outlet.is_active} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a branch</CardTitle>
        </CardHeader>
        <CardBody className="pt-0">
          <BranchForm />
        </CardBody>
      </Card>
    </div>
  )
}
