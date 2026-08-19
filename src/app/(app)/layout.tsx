import { redirect } from 'next/navigation'

import { logoutAction } from '@/app/(auth)/login/actions'
import { getCurrentUser } from '@/services/auth.service'

/**
 * The authenticated shell.
 *
 * The `getCurrentUser()` check here is a redirect, not a control: it decides what
 * to render, while row-level security decides what the user can read. A request
 * that reached a page without a session still cannot see a row (§15).
 *
 * The navigation of §12.3 belongs to Phase 7 with the design system. This is the
 * minimum that proves a session resolves to a real user with a real role.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-200 px-4 py-3">
        <span className="text-sm font-semibold tracking-tight">JSK CRM</span>
        <div className="flex items-center gap-3 text-sm text-neutral-600">
          <span>
            {user.fullName} · {user.role}
          </span>
          <form action={logoutAction}>
            <button type="submit" className="underline underline-offset-4">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="p-4">{children}</main>
    </div>
  )
}
