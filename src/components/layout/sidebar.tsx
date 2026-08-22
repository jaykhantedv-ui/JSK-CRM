'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from '@/components/layout/nav-items'
import { toRoute } from '@/lib/routes'
import { cn } from '@/lib/utils'

/**
 * The desktop sidebar (§12.3). Manager-friendly navigation: denser, everything
 * one click away, no hidden sheet.
 *
 * The role-gated entries arrive already filtered from the server — this component
 * renders what it is given and makes no permission decision of its own.
 */
export function Sidebar({ secondary }: { secondary: string[] }) {
  const pathname = usePathname()

  // The server decided WHICH entries this role may see and sent their hrefs.
  // The icons are looked up here because they cannot cross that boundary.
  const secondaryItems = SECONDARY_NAV.filter((item) => secondary.includes(item.href))

  const link = (item: Pick<NavItem, 'href' | 'label'> & { icon?: NavItem['icon'] }) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
    const Icon = item.icon
    return (
      <Link
        key={item.href}
        href={toRoute(item.href)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
          active ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        {Icon ? <Icon className="size-4" aria-hidden /> : null}
        {item.label}
      </Link>
    )
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      {PRIMARY_NAV.map(link)}
      {secondaryItems.length > 0 ? (
        <>
          <hr className="my-2 border-border" />
          {secondaryItems.map((item) => link(item))}
        </>
      ) : null}
    </nav>
  )
}
