import Link from 'next/link'
import { AlertCircle, Inbox, Lock, SearchX } from 'lucide-react'

import { buttonClass } from '@/components/ui/button'
import { toRoute } from '@/lib/routes'
import { cn } from '@/lib/utils'

/**
 * The required states of §12.6 — one implementation, used by every list and form.
 *
 * The two that matter most:
 *
 *   **Forbidden** says "You don't have access to this record" and never confirms
 *   whether the record exists (§25, M-03). Row-level security answers "invisible"
 *   and "forbidden" identically, and so does this.
 *
 *   **Error** is plain language with a retry. Never a Postgres message, never a
 *   stack trace (§12.6, §16.2).
 */

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string
  description?: string
  action?: { href: string; label: string }
  icon?: typeof Inbox
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <Icon className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? (
        <Link href={toRoute(action.href)} className={buttonClass('primary', 'sm', 'mt-1')}>
          {action.label}
        </Link>
      ) : null}
    </div>
  )
}

/** Empty because the filters excluded everything — different copy, and a way out. */
export function FilteredEmptyState({ clearHref }: { clearHref: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <SearchX className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">Nothing matches these filters</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Try a different search, or clear the filters to see everything again.
      </p>
      <Link href={toRoute(clearHref)} className={buttonClass('outline', 'sm', 'mt-1')}>
        Clear filters
      </Link>
    </div>
  )
}

export function ErrorState({ message, retryHref }: { message?: string; retryHref?: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center"
    >
      <AlertCircle className="size-6 text-destructive" aria-hidden />
      <p className="text-sm font-medium">Something went wrong</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {message ?? 'That did not load. Try again in a moment.'}
      </p>
      {retryHref ? (
        <Link href={toRoute(retryHref)} className={buttonClass('outline', 'sm', 'mt-1')}>
          Try again
        </Link>
      ) : null}
    </div>
  )
}

/**
 * §12.6 — "You don't have access to this record." **Never confirm existence.**
 * The same words whether the record is somebody else's or was never there.
 */
/**
 * A refusal, in words (§12.6).
 *
 * Two shapes, one component: a RECORD the caller cannot reach — the default —
 * and a SCREEN that is not part of their role, which the route guards pass their
 * own wording for (ADR-040). A refusal is never a redirect: sending somebody to
 * `/today` is indistinguishable from a mis-click and leaves them wondering
 * whether the link was broken.
 *
 * "Sales head", not "manager". The database role is MANAGER and the interface
 * never says so (ADR-040).
 */
export function ForbiddenState({
  backHref = '/today',
  title = "You don't have access to this record",
  description = 'It may belong to another team, or it may not exist. Ask your sales head if you need it.',
}: {
  backHref?: string
  title?: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border px-6 py-12 text-center">
      <Lock className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      <Link href={toRoute(backHref)} className={buttonClass('outline', 'sm', 'mt-1')}>
        Go back
      </Link>
    </div>
  )
}

/** Skeletons match the final layout — never a full-page spinner (§12.6). */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-lg border border-border bg-muted/40" />
      ))}
    </div>
  )
}

export function SkeletonTiles({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: tiles }).map((_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-lg border border-border bg-muted/40" />
      ))}
    </div>
  )
}
