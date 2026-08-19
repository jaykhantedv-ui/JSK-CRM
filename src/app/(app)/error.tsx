'use client'

import { useEffect } from 'react'

import { ErrorState, ForbiddenState } from '@/components/shared/states'

/**
 * The error boundary for every authenticated screen (§12.6).
 *
 * A service throws `AppError`, Next.js serialises it, and this decides which of
 * two faces the user sees. **Never a Postgres message and never a stack trace**
 * (§16.2) — `digest` is what a developer correlates with the server log, and it
 * is the only technical detail on screen.
 *
 * `NOT_FOUND` and `FORBIDDEN` render **identically**. Row-level security answers
 * "you may not see this" and "this does not exist" the same way, and so must the
 * UI: distinguishing them would let somebody probe for the existence of records
 * they have no right to (§25, M-03).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Screen failed to render', error)
  }, [error])

  const message = error.message ?? ''
  const invisible =
    /no longer exists, or you cannot see it/i.test(message) ||
    /do not have permission|don't have permission|cannot change|Sign in to continue/i.test(message)

  return (
    <div className="py-8">
      {invisible ? <ForbiddenState /> : <ErrorState message={message || undefined} />}
      {!invisible ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-input px-4 py-2 text-sm"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  )
}
