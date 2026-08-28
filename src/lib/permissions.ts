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
  /** Who they report to (ADR-040). Null for the OWNER and for anyone not yet placed. */
  managerId?: string | null
}

/**
 * What the UI calls each role (ADR-040).
 *
 * **The database role is MANAGER; the business calls that person a Sales Head,
 * and so does every screen.** The word "Manager" must not appear in the
 * interface for this role — the same discipline §2.4 applies to "Revenue".
 * Renaming the enum would have meant rewriting every policy, every helper and
 * every migration for a word, so the value stayed and the label moved.
 */
export const ROLE_LABELS: Record<Role, string> = {
  SALESPERSON: 'Salesperson',
  MANAGER: 'Sales Head',
  OWNER: 'Owner',
  ADMIN: 'Administrator',
}

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role]
}

/**
 * Who a person of this role may report to (ADR-040), as one list.
 *
 * The database enforces this in `guard_user_hierarchy()`; this is the same rule
 * for the form, so the UI cannot offer a choice the database will refuse. If the
 * two ever disagree the database wins and the form is wrong.
 */
export const MANAGER_ROLE_FOR: Record<Role, Role | null> = {
  SALESPERSON: 'MANAGER',
  MANAGER: 'ADMIN',
  ADMIN: 'OWNER',
  OWNER: null,
}

export function canReportTo(role: Role, managerRole: Role | null): boolean {
  const required = MANAGER_ROLE_FOR[role]
  if (required === null) return managerRole === null
  return managerRole === required
}

/**
 * The business-data management tier: MANAGER and OWNER.
 *
 * ADMIN is deliberately absent, and stayed absent through ADR-040. It now READS
 * every operational record, but archiving, reassigning and exporting are acts of
 * sales management rather than administration. Read "or above" as *above
 * SALESPERSON in the sales hierarchy* — which ADMIN is not on.
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
 * an outlet is added. ADMIN joined OWNER here in ADR-040: it administers the
 * branches, so it must be able to file against and compare all of them.
 *
 * **This is which branches you may WORK IN — it is not a read grant.** Since
 * ADR-040 what a sales head may READ is their team; see `canReadRecord`.
 */
export function managesOutlet(user: CurrentUser | null, outletId: string | null): boolean {
  if (!user) return false
  if (user.role === 'OWNER' || user.role === 'ADMIN') return true
  if (user.role !== 'MANAGER' || !outletId) return false
  return user.outletIds.includes(outletId)
}

/** OWNER and ADMIN read every operational record (ADR-040, superseding ADR-017). */
export function readsAllRecords(user: Pick<CurrentUser, 'role'> | null): boolean {
  return user?.role === 'OWNER' || user?.role === 'ADMIN'
}

/**
 * Ownership, plus the reporting line. The read rule for accounts, projects and
 * opportunities, mirroring the policies in migration 031.
 *
 * A sales head reads their own records and their direct reports'. Not their
 * branch: three sales heads share one branch in the pilot, and outlet scope gave
 * each of them the other two's pipeline.
 */
export function canReadRecord(
  user: CurrentUser | null,
  record: { owner_id: string | null; outlet_id: string | null },
  directReportIds: readonly string[] = [],
): boolean {
  if (!user?.isActive) return false
  if (record.owner_id && record.owner_id === user.id) return true
  if (readsAllRecords(user)) return true
  if (user.role !== 'MANAGER' || !record.owner_id) return false
  return directReportIds.includes(record.owner_id)
}

export function canReassign(user: CurrentUser | null): boolean {
  return isManagerOrAbove(user)
}

export function canArchive(user: CurrentUser | null): boolean {
  return isManagerOrAbove(user)
}

/**
 * Export is a report with a download button (ADR-042).
 *
 * Whoever may open a management screen may take away what it shows: the CSV is
 * built from the same RLS-bounded queries, so it can carry nothing the screen
 * does not. Tying it to `canViewTeamDashboard` rather than restating the roles is
 * what keeps the two from drifting.
 */
export function canExportCsv(user: CurrentUser | null): boolean {
  return canViewTeamDashboard(user)
}

export function canImportCsv(user: CurrentUser | null): boolean {
  return isOwnerOrAdmin(user)
}

export function canManageUsers(user: CurrentUser | null): boolean {
  return isOwnerOrAdmin(user)
}

/**
 * The global business rules — the §24 thresholds, the taluk list, the stage
 * probabilities, the SLA. **OWNER only (ADR-042).**
 *
 * Changing one changes how the CRM behaves for everybody, without a deploy. That
 * is configuring the system rather than running the business, and the audit
 * found an administrator could do it with a single PostgREST call. The control is
 * `system_settings_update`, which is now `is_owner()`; this only decides what the
 * screen offers.
 *
 * Administering PEOPLE and BRANCHES is a different question — see
 * `canManageOrganization`, which is still OWNER and ADMIN.
 */
export function canEditSettings(user: CurrentUser | null): boolean {
  return isOwner(user)
}

/**
 * Team dashboard, reports and workload (§3.1, ADR-040).
 *
 * MANAGER and OWNER by the sales hierarchy, and ADMIN because it now reads every
 * operational record — refusing it a report it could assemble row by row
 * protected nothing. Mirrors `assert_management_access()` in the database, which
 * is the control; this only decides what the navigation offers.
 */
export function canViewTeamDashboard(user: CurrentUser | null): boolean {
  return isManagerOrAbove(user) || readsAllRecords(user)
}

/**
 * The organisation screens: branches, people and the reporting structure.
 *
 * OWNER and ADMIN. Running the business needs somebody to add a salesperson and
 * put them under a sales head; it does not need them to move the high-value
 * threshold (ADR-042).
 */
export function canManageOrganization(user: CurrentUser | null): boolean {
  return isOwnerOrAdmin(user)
}

/**
 * May this person reach `/settings` at all?
 *
 * The index carries both the organisation links (OWNER and ADMIN) and the
 * business rules (OWNER only), so the page is reachable by both and shows each
 * of them what is theirs.
 */
export function canOpenSettings(user: CurrentUser | null): boolean {
  return canManageOrganization(user) || canEditSettings(user)
}

/**
 * May this person create, alter or deactivate an OWNER?
 *
 * Only an owner. Mirrors `guard_owner_role()` in migration 032, which is the
 * control — an administrator with a JWT and a PostgREST call could mint a second
 * owner and deactivate the real one until ADR-042.
 */
export function canAdministerOwner(user: CurrentUser | null): boolean {
  return isOwner(user)
}

/** Where a role lands after signing in (§12.2, decision M-01, ADR-040). */
export function landingRouteFor(role: Role): '/today' | '/dashboard' {
  switch (role) {
    case 'SALESPERSON':
      return '/today'
    case 'MANAGER':
    case 'OWNER':
    // ADR-040 gave ADMIN the operational picture, so it lands on it rather than
    // on a configuration form.
    case 'ADMIN':
      return '/dashboard'
  }
}
