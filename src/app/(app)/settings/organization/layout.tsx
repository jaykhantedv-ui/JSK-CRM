import Link from 'next/link'

import { ForbiddenState } from '@/components/shared/states'
import { canManageOrganization } from '@/lib/permissions'
import { toRoute } from '@/lib/routes'
import { requireUser } from '@/services/auth.service'

const TABS = [
  { href: '/settings/organization/branches', label: 'Branches' },
  { href: '/settings/organization/people', label: 'People' },
  { href: '/settings/organization/structure', label: 'Reporting Structure' },
]

/**
 * Settings → Organization (ADR-040) — OWNER and ADMIN.
 *
 * One guard for all three screens, so a screen added later cannot arrive
 * without one. **It is the routing control, not the control**: `users_admin_*`,
 * `outlets_insert` and `user_outlets_*` decide what may actually be written, and
 * they hold against a direct PostgREST call by a sales head (§15).
 */
export default async function OrganizationLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  if (!canManageOrganization(user)) return <ForbiddenState
      backHref="/today" title="This screen is not part of your role"
      description="Ask the owner or an administrator if you need it."
    />

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Organization</h1>
        <p className="text-sm text-muted-foreground">
          Branches, the people who work in them, and who reports to whom.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-border pb-2">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={toRoute(tab.href)}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  )
}
