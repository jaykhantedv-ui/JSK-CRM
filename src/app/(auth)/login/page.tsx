import type { Metadata } from 'next'

import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in · JSK CRM' }

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
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">JSK CRM</h1>
        <p className="text-sm text-neutral-600">Sign in to continue.</p>
      </div>

      <LoginForm />

      <p className="text-xs text-neutral-500">
        Accounts are created by your owner or administrator.
      </p>
    </main>
  )
}
