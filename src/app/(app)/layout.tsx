import Link from 'next/link'
import { redirect } from 'next/navigation'

import { logoutAction } from '@/app/(auth)/login/actions'
import { BottomNav } from '@/components/layout/bottom-nav'
import { DemoBanner } from '@/components/layout/demo-banner'
import { SECONDARY_NAV, visibleFor } from '@/components/layout/nav-items'
import { Sidebar } from '@/components/layout/sidebar'
import { GlobalSearch } from '@/components/layout/top-bar'
import { getCurrentUser } from '@/services/auth.service'

/**
 * The authenticated shell (§12.3).
 *
 * Mobile: a bottom tab bar with a raised `+`. Desktop: a left sidebar and a top
 * bar carrying search and the user menu. One layout serves both — the breakpoint
 * decides which navigation is mounted, not which application is running.
 *
 * The `getCurrentUser()` check is a redirect, **not a control**: it decides what
 * to render, while row-level security decides what can be read. A request that
 * reached a page without a session still cannot see a row (§15). The role-gated
 * navigation is filtered here for the same reason — a hidden link is a courtesy,
 * and the database is the boundary.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Only the hrefs cross into the Client Component. A NavItem's `icon` is a
  // lucide component, and React cannot serialize a component from a Server
  // Component into a Client one — passing the whole item threw
  // "Functions cannot be passed directly to Client Components" once per visible
  // entry and turned every authenticated page into a 500. The role filter stays
  // here, on the server; the sidebar resolves the icons for the hrefs it is given.
  const secondary = visibleFor(SECONDARY_NAV, user).map((item) => item.href)

  return (
    <>
      <DemoBanner />
      <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
        <aside className="hidden border-r border-border md:sticky md:top-0 md:block md:h-dvh md:overflow-y-auto">
          <div className="px-4 py-4">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              JSK CRM
            </Link>
          </div>
          <Sidebar secondary={secondary} />
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background px-4 py-2.5">
            <Link href="/" className="text-sm font-semibold tracking-tight md:hidden">
              JSK CRM
            </Link>
            <div className="min-w-0 flex-1">
              <GlobalSearch />
            </div>
            <details className="relative shrink-0">
              <summary className="cursor-pointer list-none rounded-full bg-secondary px-3 py-1.5 text-xs font-medium">
                {user.fullName.split(' ')[0]}
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-56 rounded-md border border-border bg-popover p-3 shadow-lg">
                <p className="text-sm font-medium">{user.fullName}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">{user.role}</p>
                <form action={logoutAction} className="mt-3">
                  <button type="submit" className="text-sm underline underline-offset-4">
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </header>

          {/* The bottom padding clears the mobile tab bar; without it the last row
              of every list sits underneath it and cannot be tapped. */}
          <main className="min-w-0 flex-1 p-4 pb-24 md:pb-8">{children}</main>
        </div>

        <BottomNav />
      </div>
    </>
  )
}
