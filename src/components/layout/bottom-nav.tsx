'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

import { PRIMARY_NAV, QUICK_ACTIONS } from '@/components/layout/nav-items'
import { toRoute } from '@/lib/routes'
import { cn } from '@/lib/utils'

/**
 * The mobile tab bar (§12.3): Today · Customers · [+] · Pipeline · Projects.
 *
 * The `+` is a raised centre button because it is the single most-used control in
 * the product — the whole design bet is that capturing a customer has to beat
 * writing in a notebook (§1.4), and that starts with the button being impossible
 * to miss while holding the phone one-handed.
 *
 * Hidden at `md` and above, where the sidebar takes over.
 */
export function BottomNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const left = PRIMARY_NAV.slice(0, 2)
  const right = PRIMARY_NAV.slice(2, 4)

  const item = (href: string, label: string, Icon: (typeof PRIMARY_NAV)[number]['icon']) => {
    const active = pathname === href || pathname.startsWith(`${href}/`)
    return (
      <Link
        key={href}
        href={toRoute(href)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <Icon className={cn('size-5', active && 'stroke-[2.5]')} aria-hidden />
        {label}
      </Link>
    )
  }

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-label="Quick actions"
          className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:hidden"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Quick actions</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-2">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {QUICK_ACTIONS.map((action) => (
              <li key={action.href + action.label}>
                <Link
                  href={action.href}
                  onClick={() => setOpen(false)}
                  className="flex flex-col rounded-md px-3 py-3 hover:bg-accent"
                >
                  <span className="text-sm font-medium">{action.label}</span>
                  <span className="text-xs text-muted-foreground">{action.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {left.map((entry) => item(entry.href, entry.label, entry.icon))}

        <div className="relative flex w-16 shrink-0 justify-center">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label="Quick actions"
            className="absolute -top-5 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className={cn('size-6 transition-transform', open && 'rotate-45')} aria-hidden />
          </button>
        </div>

        {right.map((entry) => item(entry.href, entry.label, entry.icon))}
      </nav>
    </>
  )
}
