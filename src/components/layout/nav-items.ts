import {
  Archive, Building2, CalendarCheck, ChartColumn, LayoutDashboard, Settings, Store, Target,
  Upload, Users, UsersRound,
} from 'lucide-react'

import type { SessionUser } from '@/types/domain'
import { canArchive, canViewTeamDashboard, canEditSettings, canImportCsv } from '@/lib/permissions'

/**
 * The navigation model (§12.3), shared by the mobile tab bar and the desktop
 * sidebar so the two can never drift.
 *
 * Role-gated items are **hidden, not disabled** (§12.3). Hiding is a rendering
 * choice, not a control: the route itself is protected by RLS, and a manager URL
 * typed by a salesperson returns nothing rather than a styled refusal.
 */
export type NavItem = {
  href: string
  label: string
  icon: typeof Target
  visible?: (user: SessionUser) => boolean
}

export const PRIMARY_NAV: NavItem[] = [
  { href: '/today', label: 'Today', icon: CalendarCheck },
  { href: '/accounts', label: 'Customers', icon: Users },
  { href: '/opportunities', label: 'Pipeline', icon: Target },
  { href: '/projects', label: 'Projects', icon: Building2 },
]

export const SECONDARY_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, visible: canViewTeamDashboard },
  { href: '/contacts', label: 'Contacts', icon: UsersRound },
  { href: '/team', label: 'Team', icon: Store, visible: canViewTeamDashboard },
  { href: '/reports', label: 'Reports', icon: ChartColumn, visible: canViewTeamDashboard },
  { href: '/archive', label: 'Archive', icon: Archive, visible: canArchive },
  { href: '/import', label: 'Import', icon: Upload, visible: canImportCsv },
  { href: '/settings', label: 'Settings', icon: Settings, visible: canEditSettings },
]

export function visibleFor(items: NavItem[], user: SessionUser): NavItem[] {
  return items.filter((item) => !item.visible || item.visible(user))
}

/**
 * The `+` sheet (§12.3): New Customer · New Opportunity · Log Activity ·
 * Site Visit · Update Next Action.
 *
 * The last three need a record to attach to, so from the global button they route
 * to the customer list to pick one first — the salesperson never types a foreign
 * key (§10.2).
 */
export const QUICK_ACTIONS = [
  { href: '/accounts/new', label: 'New customer', description: 'Customer and enquiry in one go' },
  { href: '/opportunities/new', label: 'New opportunity', description: 'On a customer you already have' },
  { href: '/accounts?log=activity', label: 'Log activity', description: 'Pick the customer, then log it' },
  { href: '/accounts?log=site_visit', label: 'Site visit', description: 'Measurements and notes from site' },
  { href: '/today', label: 'Update next action', description: 'Everything waiting on you' },
] as const
