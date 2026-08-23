import type { Metadata } from 'next'

import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { ROLE_LABELS } from '@/lib/permissions'
import { getReportingStructure, type ReportingNode } from '@/services/user.service'

export const metadata: Metadata = { title: 'Reporting Structure · JSK CRM' }

/**
 * Settings → Organization → Reporting Structure (ADR-040).
 *
 * **This is not decoration — it is the authorization model, drawn.** A sales
 * head reads exactly the branch of this tree below them, so a person in the
 * wrong place here is a person seeing the wrong pipeline, and the fastest way to
 * find that is to look at it.
 *
 * Built from `users.manager_id` and nothing else. There is no second
 * organisation model, no team table and no group table: the line between two
 * rows in `users` IS the organisation (CLAUDE.md §4).
 */
function Branch({ node, depth }: { node: ReportingNode; depth: number }) {
  return (
    <li>
      <div
        className="flex flex-wrap items-center gap-2 py-1.5"
        style={{ paddingLeft: `${depth * 1.25}rem` }}
      >
        <span className="font-medium">{node.person.full_name}</span>
        <Badge tone={node.person.is_active ? 'neutral' : 'muted'}>
          {ROLE_LABELS[node.person.role]}
        </Badge>
        {node.person.is_active ? null : <Badge tone="muted">Deactivated</Badge>}
        <span className="text-xs text-muted-foreground">{node.person.email}</span>
      </div>

      {node.reports.length > 0 ? (
        <ul className="border-l border-border">
          {node.reports.map((child) => (
            <Branch key={child.person.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export default async function StructurePage() {
  const roots = await getReportingStructure()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporting structure</CardTitle>
      </CardHeader>
      <CardBody className="pt-0">
        {roots.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody yet.</p>
        ) : (
          <ul>
            {roots.map((root) => (
              <Branch key={root.person.id} node={root} depth={0} />
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          A sales head sees the people below them and their work — and no other
          sales head&rsquo;s. Change who somebody reports to on the People tab.
        </p>
      </CardBody>
    </Card>
  )
}
