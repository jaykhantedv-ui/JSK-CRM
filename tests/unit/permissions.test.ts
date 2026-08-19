import { describe, expect, it } from 'vitest'

import {
  canArchive,
  canEditSettings,
  canExportCsv,
  canImportCsv,
  canManageUsers,
  canReadRecord,
  canReassign,
  canViewTeamDashboard,
  isManagerOrAbove,
  isOwner,
  isOwnerOrAdmin,
  landingRouteFor,
  managesOutlet,
  type CurrentUser,
} from '@/lib/permissions'

/**
 * The capability helpers (§3.1, ADR-016, ADR-017).
 *
 * **These are rendering rules, not the security boundary.** Every one of them has
 * a matching RLS policy proved in the integration suite; these tests exist so the
 * UI never offers an action the database will refuse, and so the two never drift.
 */

const OUTLET_A = 'outlet-a'
const OUTLET_B = 'outlet-b'
const OUTLET_C = 'outlet-c'

function user(partial: Partial<CurrentUser> & Pick<CurrentUser, 'role'>): CurrentUser {
  return { id: 'u1', isActive: true, outletIds: [], ...partial }
}

const SALESPERSON = user({ role: 'SALESPERSON', outletIds: [OUTLET_A] })
const MANAGER_A = user({ id: 'm1', role: 'MANAGER', outletIds: [OUTLET_A] })
const MANAGER_AC = user({ id: 'm2', role: 'MANAGER', outletIds: [OUTLET_A, OUTLET_C] })
const MANAGER_NONE = user({ id: 'm3', role: 'MANAGER', outletIds: [] })
const OWNER = user({ id: 'o1', role: 'OWNER' })
const ADMIN = user({ id: 'a1', role: 'ADMIN' })

describe('role tiers', () => {
  it('ADR-017: ADMIN is not in the business-data management tier', () => {
    expect(isManagerOrAbove(ADMIN)).toBe(false)
    expect(isManagerOrAbove(MANAGER_A)).toBe(true)
    expect(isManagerOrAbove(OWNER)).toBe(true)
    expect(isManagerOrAbove(SALESPERSON)).toBe(false)
    expect(isManagerOrAbove(null)).toBe(false)
  })

  it('ADMIN and OWNER share system administration', () => {
    expect(isOwnerOrAdmin(ADMIN)).toBe(true)
    expect(isOwnerOrAdmin(OWNER)).toBe(true)
    expect(isOwnerOrAdmin(MANAGER_A)).toBe(false)
    expect(isOwnerOrAdmin(SALESPERSON)).toBe(false)
  })

  it('only OWNER is the owner', () => {
    expect(isOwner(OWNER)).toBe(true)
    expect(isOwner(ADMIN)).toBe(false)
  })
})

describe('outlet scope', () => {
  it('a manager scopes to their assigned outlets', () => {
    expect(managesOutlet(MANAGER_A, OUTLET_A)).toBe(true)
    expect(managesOutlet(MANAGER_A, OUTLET_B)).toBe(false)
    expect(managesOutlet(MANAGER_A, OUTLET_C)).toBe(false)
  })

  it('a manager may hold several outlets', () => {
    expect(managesOutlet(MANAGER_AC, OUTLET_A)).toBe(true)
    expect(managesOutlet(MANAGER_AC, OUTLET_C)).toBe(true)
    expect(managesOutlet(MANAGER_AC, OUTLET_B)).toBe(false)
  })

  it('a manager with no outlets manages nothing', () => {
    expect(managesOutlet(MANAGER_NONE, OUTLET_A)).toBe(false)
  })

  it('the owner is company-wide by role, without any outlet assignment', () => {
    expect(OWNER.outletIds).toEqual([])
    expect(managesOutlet(OWNER, OUTLET_A)).toBe(true)
    expect(managesOutlet(OWNER, OUTLET_B)).toBe(true)
    // Including an outlet that did not exist when the owner was created.
    expect(managesOutlet(OWNER, 'outlet-j')).toBe(true)
  })

  it('an admin has no outlet scope', () => {
    expect(managesOutlet(ADMIN, OUTLET_A)).toBe(false)
  })

  it("a salesperson's posting does not widen their reads", () => {
    // Their outlet decides where new records are created, not what they can see.
    expect(managesOutlet(SALESPERSON, OUTLET_A)).toBe(false)
  })
})

describe('canReadRecord', () => {
  const recordInA = { owner_id: 'someone-else', outlet_id: OUTLET_A }
  const recordInB = { owner_id: 'someone-else', outlet_id: OUTLET_B }

  it('lets the owner of a record read it', () => {
    expect(canReadRecord(SALESPERSON, { owner_id: SALESPERSON.id, outlet_id: OUTLET_A })).toBe(true)
  })

  it("refuses another salesperson's record", () => {
    expect(canReadRecord(SALESPERSON, recordInA)).toBe(false)
  })

  it('lets a manager read their outlet and not another', () => {
    expect(canReadRecord(MANAGER_A, recordInA)).toBe(true)
    expect(canReadRecord(MANAGER_A, recordInB)).toBe(false)
  })

  it('lets the owner read everything and the admin nothing', () => {
    expect(canReadRecord(OWNER, recordInB)).toBe(true)
    expect(canReadRecord(ADMIN, recordInA)).toBe(false)
  })

  it('refuses a deactivated user, whatever their role', () => {
    const deactivated = user({ id: 'o1', role: 'OWNER', isActive: false })
    expect(canReadRecord(deactivated, recordInA)).toBe(false)
  })

  it('refuses a signed-out caller', () => {
    expect(canReadRecord(null, recordInA)).toBe(false)
  })
})

describe('the capability matrix (§3.1)', () => {
  it.each([
    ['reassign', canReassign, { SALESPERSON: false, MANAGER: true, OWNER: true, ADMIN: false }],
    ['archive', canArchive, { SALESPERSON: false, MANAGER: true, OWNER: true, ADMIN: false }],
    ['export CSV', canExportCsv, { SALESPERSON: false, MANAGER: true, OWNER: true, ADMIN: false }],
    ['import CSV', canImportCsv, { SALESPERSON: false, MANAGER: false, OWNER: true, ADMIN: true }],
    ['manage users', canManageUsers, { SALESPERSON: false, MANAGER: false, OWNER: true, ADMIN: true }],
    ['edit settings', canEditSettings, { SALESPERSON: false, MANAGER: false, OWNER: true, ADMIN: true }],
    [
      'team dashboard',
      canViewTeamDashboard,
      { SALESPERSON: false, MANAGER: true, OWNER: true, ADMIN: false },
    ],
  ] as Array<
    [string, (u: CurrentUser | null) => boolean, Record<'SALESPERSON' | 'MANAGER' | 'OWNER' | 'ADMIN', boolean>]
  >)('%s', (_name, capability, expected) => {
    expect(capability(SALESPERSON)).toBe(expected.SALESPERSON)
    expect(capability(MANAGER_A)).toBe(expected.MANAGER)
    expect(capability(OWNER)).toBe(expected.OWNER)
    expect(capability(ADMIN)).toBe(expected.ADMIN)
  })

  it('nobody can hard delete — there is no capability for it', () => {
    // Deliberately absent from this module. Removal means archiving (§8.8).
    expect(Object.keys({ canArchive })).not.toContain('canDelete')
  })
})

describe('landing routes (§12.2)', () => {
  it.each([
    ['SALESPERSON', '/today'],
    ['MANAGER', '/dashboard'],
    ['OWNER', '/dashboard'],
    ['ADMIN', '/settings'],
  ] as const)('a %s lands on %s', (role, route) => {
    expect(landingRouteFor(role)).toBe(route)
  })
})
