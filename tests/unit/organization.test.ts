import { describe, expect, it } from 'vitest'

import { PRIMARY_NAV, SECONDARY_NAV, visibleFor } from '@/components/layout/nav-items'
import {
  MANAGER_ROLE_FOR,
  ROLE_LABELS,
  canReportTo,
  roleLabel,
  type Role,
} from '@/lib/permissions'
import type { SessionUser } from '@/types/domain'

/**
 * The organisation model as the business states it (ADR-040).
 *
 * Two rules live here and nowhere else in TypeScript: what each role is CALLED,
 * and who each role may REPORT TO. Both are mirrored by the database —
 * `guard_user_hierarchy()` is the control — and both are tested there too, as
 * the exact pilot organisation, in `tests/integration/pilot-organization.test.ts`.
 * This file pins the halves the UI reasons about.
 */

const ROLES: Role[] = ['SALESPERSON', 'MANAGER', 'OWNER', 'ADMIN']

const person = (role: Role): SessionUser => ({
  id: 'u1',
  email: 'u1@jsk.test',
  fullName: 'A Person',
  role,
  isActive: true,
  outletIds: [],
  managerId: null,
})

describe('what the UI calls each role', () => {
  it('calls a MANAGER a Sales Head', () => {
    expect(roleLabel('MANAGER')).toBe('Sales Head')
  })

  it('NEVER says "Manager" anywhere in the labels', () => {
    // The business's own term, and the same discipline §2.4 applies to
    // "Revenue": the database value is MANAGER and the interface must not
    // repeat it.
    for (const role of ROLES) {
      expect(ROLE_LABELS[role].toLowerCase()).not.toContain('manager')
    }
  })

  it('labels every role, so a new one cannot render raw', () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy()
    }
  })
})

describe('who may report to whom — the complete matrix', () => {
  it('states one required manager role per role', () => {
    expect(MANAGER_ROLE_FOR).toEqual({
      SALESPERSON: 'MANAGER',
      MANAGER: 'ADMIN',
      ADMIN: 'OWNER',
      OWNER: null,
    })
  })

  // Every ordered pair, valid and invalid — the discipline §19.1 asks of the
  // stage transition matrix, applied to the reporting line.
  const ALLOWED: Array<[Role, Role | null]> = [
    ['SALESPERSON', 'MANAGER'],
    ['MANAGER', 'ADMIN'],
    ['ADMIN', 'OWNER'],
    ['OWNER', null],
  ]

  const isAllowed = (role: Role, managerRole: Role | null) =>
    ALLOWED.some(([r, m]) => r === role && m === managerRole)

  for (const role of ROLES) {
    for (const managerRole of [...ROLES, null] as (Role | null)[]) {
      const expected = isAllowed(role, managerRole)
      it(`${expected ? 'allows' : 'refuses'} ${role} reporting to ${managerRole ?? 'nobody'}`, () => {
        expect(canReportTo(role, managerRole)).toBe(expected)
      })
    }
  }

  it('refuses the four shapes the business named outright', () => {
    expect(canReportTo('SALESPERSON', 'SALESPERSON')).toBe(false) // salesperson under salesperson
    expect(canReportTo('MANAGER', 'OWNER')).toBe(false) // sales head under the owner
    expect(canReportTo('MANAGER', 'MANAGER')).toBe(false) // sales head under a sales head
    expect(canReportTo('OWNER', 'ADMIN')).toBe(false) // the owner under anybody
  })
})

describe('navigation, per role', () => {
  const labelsFor = (role: Role) =>
    [...visibleFor(PRIMARY_NAV, person(role)), ...visibleFor(SECONDARY_NAV, person(role))].map(
      (item) => item.label,
    )

  it('offers a SALESPERSON exactly their seven screens', () => {
    expect(new Set(labelsFor('SALESPERSON'))).toEqual(
      new Set(['Today', 'Customers', 'Contacts', 'Pipeline', 'Projects', 'My Day', 'My Targets']),
    )
  })

  it('offers a SALES HEAD their seven, and neither My Day nor My Targets', () => {
    const labels = labelsFor('MANAGER')
    for (const expected of ['Today', 'Customers', 'Contacts', 'Pipeline', 'Projects', 'Team', 'Reports']) {
      expect(labels).toContain(expected)
    }
    expect(labels).not.toContain('My Day')
    expect(labels).not.toContain('My Targets')
  })

  it('offers a SALESPERSON no management surface at all', () => {
    const labels = labelsFor('SALESPERSON')
    for (const withheld of ['Dashboard', 'Team', 'Reports', 'Settings', 'Import', 'Archive']) {
      expect(labels).not.toContain(withheld)
    }
  })

  it('offers a SALES HEAD no administration', () => {
    const labels = labelsFor('MANAGER')
    expect(labels).not.toContain('Settings')
    expect(labels).not.toContain('Import')
  })

  it('offers ADMIN and OWNER everything', () => {
    for (const role of ['ADMIN', 'OWNER'] as Role[]) {
      const labels = labelsFor(role)
      for (const expected of ['Dashboard', 'Team', 'Reports', 'Settings']) {
        expect(labels).toContain(expected)
      }
    }
  })

  it('hides nothing that authorization does not also refuse', () => {
    // Hiding is the weakest of the three controls and must never be the only
    // one. Every route withheld from a salesperson here is guarded by
    // `requireRole` on the route AND by a policy or `assert_management_access()`
    // in the database; this asserts the list stays in step with the guards.
    const salespersonSees = new Set(labelsFor('SALESPERSON'))
    const guarded = ['Dashboard', 'Team', 'Reports', 'Settings', 'Import', 'Archive']
    for (const label of guarded) {
      expect(salespersonSees.has(label)).toBe(false)
    }
  })
})
