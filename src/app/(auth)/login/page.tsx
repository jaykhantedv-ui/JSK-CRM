import type { Metadata } from 'next'

import { DemoBanner } from '@/components/layout/demo-banner'
import { isDemoMode } from '@/lib/demo'

import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in · JSK CRM' }

/**
 * Rendered per request so the CSP nonce is real (§23).
 *
 * Next.js stamps the middleware's nonce onto its bootstrap and RSC-payload
 * scripts only while rendering; a prerendered page has no nonce to stamp. Left
 * static, this page shipped twelve unnonced script tags under a `strict-dynamic`
 * policy — which ignores `'self'` — so the browser would have blocked every one
 * of them and the sign-in form would never have hydrated. The header check would
 * still have passed, which is precisely the failure §23 warns about.
 *
 * The cost is one render of a static form per sign-in attempt. The page already
 * could not be served from cache in practice: middleware runs `getUser()` on it
 * to bounce a signed-in visitor to the dashboard.
 */
export const dynamic = 'force-dynamic'

/**
 * The sign-in screen.
 *
 * **There is no "create an account" link and there never will be.** Users are
 * created by an owner or an administrator (§3.2); sign-up is disabled in
 * `config.toml` for every environment, so a hand-crafted request cannot register
 * one either.
 */
export default function LoginPage() {
  return (
    <>
      <DemoBanner />
      <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">JSK CRM</h1>
          <p className="text-sm text-neutral-600">Sign in to continue.</p>
        </div>

        <LoginForm />

        {/* Training sign-ins, shown only in demo mode. The addresses are listed
            because they are not secret and a trainee should not have to be told
            them; the password is NOT listed — it is set per deployment through
            DEMO_PASSWORD and printed by scripts/demo.sh (§7). */}
        {isDemoMode() ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
            <p className="font-semibold">Training sign-ins</p>
            <ul className="mt-1.5 space-y-0.5">
              <li>
                <code>owner@demo.jsk.local</code> — sees everything
              </li>
              <li>
                <code>manager.a@demo.jsk.local</code> — Showroom A only
              </li>
              <li>
                <code>sales01@demo.jsk.local</code> — one salesperson&apos;s own work
              </li>
            </ul>
            <p className="mt-1.5">
              Ask whoever set up the demo for the password, or see docs/TRAINING.md.
            </p>
          </div>
        ) : null}

        <p className="text-xs text-neutral-500">
          Accounts are created by your owner or administrator.
        </p>
      </main>
    </>
  )
}
