import type { Database } from '@/types/database.types'

/**
 * Capability helpers (§3.1).
 *
 * **These are for rendering, not for authorization.** Row-level security is the
 * authorization boundary (§15); a hidden button is not a control. Every rule here
 * has a policy behind it that holds against a direct PostgREST call, and these
 * functions exist so the UI does not offer an action the database will refuse.
 *
 * They mirror the SQL helpers in migration 015. If one changes, the other must.
 */

export type Role = Database['public']['Enums']['user_role']

/** The signed-in user, as every server component and service receives them. */
export type CurrentUser = {
  id: string
  role: Role
  isActive: boolean
  /** Outlet ids in the user's scope. Empty for OWNER (company-wide by role) and ADMIN. */
  outletIds: string[]
}

/**
 * The business-data management tier: MANAGER and OWNER.
 *
 * ADMIN is deliberately absent (ADR-017). It administers users, outlets, settings
 * and imports; it carries no automatic right to read the pipeline. Read "or
 * above" as *above SALESPERSON in the sales hierarchy* — which ADMIN is not on.
 */
export function isManagerOrAbove(user: Pick<CurrentUser, 'role'> | null): boolean {
  return user?.role === 'MANAGER' || user?.role === 'OWNER'
}

/** System administration: users, outlets, settings, import. */
export function isOwnerOrAdmin(user: Pick<CurrentUser, 'role'> | null): boolean {
  return user?.role === 'OWNER' || user?.role === 'ADMIN'
}

export function isOwner(user: Pick<CurrentUser, 'role'> | null): boolean {
  return user?.role === 'OWNER'
}

/**
 * Outlet scope (ADR-016). OWNER is company-wide by role and is never enumerated
 * as a member of every outlet — that would silently narrow their access the day
 * an outlet is added. A MANAGER with an empty scope manages nothing.
 */
export function managesOutlet(user: CurrentUser | null, outletId: string | null): boolean {
  if (!user) return false
  if (user.role === 'OWNER') return true
  if (user.role !== 'MANAGER' || !outletId) return false
  return user.outletIds.includes(outletId)
}

/** Ownership, plus outlet scope. The read rule for accounts, projects and opportunities. */
export function canReadRecord(
  user: CurrentUser | null,
  record: { owner_id: string | null; outlet_id: string | null },
): boolean {
  if (!user?.isActive) return false
  if (record.owner_id && record.owner_id === user.id) return true
  return managesOutlet(user, record.outlet_id)
}

export function canReassign(user: CurrentUser | null): boolean {
  return isManagerOrAbove(user)
}

export function canArchive(user: CurrentUser | null): boolean {
  return isManagerOrAbove(user)
}

export function canExportCsv(user: CurrentUser | null): boolean {
  return isManagerOrAbove(user)
}

export function canImportCsv(user: CurrentUser | null): boolean {
  return isOwnerOrAdmin(user)
}

export function canManageUsers(user: CurrentUser | null): boolean {
  return isOwnerOrAdmin(user)
}

export function canEditSettings(user: CurrentUser | null): boolean {
  return isOwnerOrAdmin(user)
}

/** Team dashboard, reports and workload are a sales-management surface (§3.1). */
export function canViewTeamDashboard(user: CurrentUser | null): boolean {
  return isManagerOrAbove(user)
}

/**
 * Where a role lands after signing in (§12.2, decision M-01).
 * ADMIN goes to settings: it has no sales surface.
 */
export function landingRouteFor(role: Role): '/today' | '/dashboard' | '/settings' {
  switch (role) {
    case 'SALESPERSON':
      return '/today'
    case 'MANAGER':
    case 'OWNER':
      return '/dashboard'
    case 'ADMIN':
      return '/settings'
  }
}
