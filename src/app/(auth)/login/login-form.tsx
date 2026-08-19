'use client'

import { useActionState } from 'react'

import { loginAction, type LoginState } from './actions'

const INITIAL: LoginState = { error: null }

/**
 * The only Client Component in the authentication flow. It collects two fields
 * and hands them to a Server Action — it never talks to Supabase directly
 * (§17.2).
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL)

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="h-11 rounded-md border border-neutral-300 px-3 text-base outline-none focus:border-neutral-900"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11 rounded-md border border-neutral-300 px-3 text-base outline-none focus:border-neutral-900"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-md bg-neutral-900 text-base font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
