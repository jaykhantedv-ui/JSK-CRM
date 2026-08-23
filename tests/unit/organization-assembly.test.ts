import { describe, expect, it } from 'vitest'

import { assembleOrganization, buildReportingTree, type PersonRow } from '@/lib/organization'
import type { UserRow } from '@/types/domain'

/**
 * Assembling the organisation in memory (ADR-041).
 *
 * **This is the code that replaced a PostgREST self-referencing embed.** The
 * office server's PostgREST 12.2.12 would not expose `users` → `users` through
 * `manager_id` — PGRST200, with the foreign key present and the schema cache
 * reloaded — so both organisation screens were dead. The join is done here now,
 * over rows row-level security has already filtered.
 *
 * The rule these tests exist to pin: **a manager is resolved only from the set
 * the caller was already authorised to read.** A `manager_id` pointing outside
 * that set resolves to null and is never a reason to fetch the row. That is what
 * stops `manager_id` becoming a side channel.
 *
 * The same ladder is proved against real row-level security, as the exact pilot
 * organisation, in `tests/integration/pilot-organization.test.ts`.
 */

function person(
  name: string,
  role: UserRow['role'],
  managerId: string | null = null,
  overrides: Partial<UserRow> = {},
): UserRow {
  // The id IS the name. Nothing here talks to a database, and a failure that
  // reads `expected 'Pankaj' to be 'Jainendra'` is worth more than one that
  // reads `expected '…0003' to be '…0004'`.
  return {
    id: name,
    full_name: name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@pilot.test`,
    phone: null,
    role,
    is_active: true,
    manager_id: managerId,
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:00Z',
    ...overrides,
  } as UserRow
}

/** The pilot organisation, by name — ids are the names, so failures read plainly. */
const PILOT: UserRow[] = [
  person('Jay Khanted', 'OWNER'),
  person('Vinay Kumar Jain', 'ADMIN', 'Jay Khanted'),
  person('Pankaj', 'MANAGER', 'Vinay Kumar Jain'),
  person('Jainendra', 'MANAGER', 'Vinay Kumar Jain'),
  person('Dhanendran', 'MANAGER', 'Vinay Kumar Jain'),
  person('Revathi', 'SALESPERSON', 'Pankaj'),
  person('Thamarai', 'SALESPERSON', 'Jainendra'),
  person('Ashokji', 'SALESPERSON', 'Jainendra'),
  person('Deivanai', 'SALESPERSON', 'Jainendra'),
  person('Kathirvel', 'SALESPERSON', 'Jainendra'),
  person('Anandh', 'SALESPERSON', 'Dhanendran'),
  person('Ankur Tiwari', 'SALESPERSON', 'Dhanendran'),
  person('Sathya', 'SALESPERSON', 'Dhanendran'),
  person('Selvi', 'SALESPERSON', 'Dhanendran'),
]

const MOOLAKARAI = { id: 'branch-mool', name: 'Moolakarai Branch' }
const CHITHODE = { id: 'branch-chit', name: 'Chithode Branch' }

const link = (user: string, outlet: string, revoked: string | null = null) => ({
  user_id: user,
  outlet_id: outlet,
  revoked_at: revoked,
})

const lineOf = (people: PersonRow[]) =>
  Object.fromEntries(people.map((p) => [p.full_name, p.managerName]))

describe('the reporting line resolves in memory', () => {
  const assembled = assembleOrganization(PILOT, [], [])

  it('places every one of the thirteen people under the right person', () => {
    expect(lineOf(assembled)).toEqual({
      'Jay Khanted': null,
      'Vinay Kumar Jain': 'Jay Khanted',
      Pankaj: 'Vinay Kumar Jain',
      Jainendra: 'Vinay Kumar Jain',
      Dhanendran: 'Vinay Kumar Jain',
      Revathi: 'Pankaj',
      Thamarai: 'Jainendra',
      Ashokji: 'Jainendra',
      Deivanai: 'Jainendra',
      Kathirvel: 'Jainendra',
      Anandh: 'Dhanendran',
      'Ankur Tiwari': 'Dhanendran',
      Sathya: 'Dhanendran',
      Selvi: 'Dhanendran',
    })
  })

  it('carries the manager’s ROLE as well as their name', () => {
    const revathi = assembled.find((p) => p.full_name === 'Revathi')!
    expect(revathi.managerRole).toBe('MANAGER')

    const pankaj = assembled.find((p) => p.full_name === 'Pankaj')!
    expect(pankaj.managerRole).toBe('ADMIN')
  })

  it('leaves the owner with nobody above them', () => {
    const jay = assembled.find((p) => p.full_name === 'Jay Khanted')!
    expect(jay.managerName).toBeNull()
    expect(jay.managerRole).toBeNull()
  })
})

describe('an unreadable manager is not a way to learn about them', () => {
  it('resolves to null rather than fetching the row', () => {
    // A sales head's authorised set is themselves and their direct reports. If
    // the administrator they report to were not in it, `manager_id` still points
    // at them — and must reveal nothing.
    const teamOnly = PILOT.filter((p) =>
      ['Jainendra', 'Thamarai', 'Ashokji', 'Deivanai', 'Kathirvel'].includes(p.full_name),
    )
    const assembled = assembleOrganization(teamOnly, [], [])

    const jainendra = assembled.find((p) => p.full_name === 'Jainendra')!
    expect(jainendra.manager_id).toBe('Vinay Kumar Jain') // the column is still there
    expect(jainendra.managerName).toBeNull() // and it tells the caller nothing
    expect(jainendra.managerRole).toBeNull()
  })

  it('never returns a person who was not in the authorised set', () => {
    const own = PILOT.filter((p) => ['Revathi', 'Pankaj'].includes(p.full_name))
    const assembled = assembleOrganization(own, [], [])

    // Exactly the two rows that were passed in. Resolving a manager adds nobody.
    expect(assembled.map((p) => p.full_name).sort()).toEqual(['Pankaj', 'Revathi'])
    expect(assembled.find((p) => p.full_name === 'Revathi')!.managerName).toBe('Pankaj')
  })

  it('survives a manager_id pointing at a row that no longer exists', () => {
    const orphan = [person('Orphan', 'SALESPERSON', 'somebody-who-left')]
    const assembled = assembleOrganization(orphan, [], [])
    expect(assembled[0].managerName).toBeNull()
  })
})

describe('branches are resolved the same way', () => {
  it('lists the branches a person currently holds, by name', () => {
    const assembled = assembleOrganization(
      PILOT,
      [link('Revathi', MOOLAKARAI.id), link('Pankaj', MOOLAKARAI.id)],
      [MOOLAKARAI, CHITHODE],
    )

    const revathi = assembled.find((p) => p.full_name === 'Revathi')!
    expect(revathi.outletIds).toEqual([MOOLAKARAI.id])
    expect(revathi.outletNames).toEqual(['Moolakarai Branch'])
  })

  it('ignores a revoked assignment — nothing is deleted, so it is still a row', () => {
    const assembled = assembleOrganization(
      PILOT,
      [link('Revathi', CHITHODE.id, '2026-08-01T00:00:00Z'), link('Revathi', MOOLAKARAI.id)],
      [MOOLAKARAI, CHITHODE],
    )
    const revathi = assembled.find((p) => p.full_name === 'Revathi')!
    expect(revathi.outletNames).toEqual(['Moolakarai Branch'])
  })

  it('shows no branch rather than an id when the name is not readable', () => {
    const assembled = assembleOrganization(PILOT, [link('Revathi', 'branch-unknown')], [MOOLAKARAI])
    const revathi = assembled.find((p) => p.full_name === 'Revathi')!
    expect(revathi.outletIds).toEqual(['branch-unknown'])
    expect(revathi.outletNames).toEqual([])
  })

  it('gives somebody with no branch an empty list, not a missing field', () => {
    const assembled = assembleOrganization(PILOT, [], [MOOLAKARAI])
    expect(assembled.every((p) => Array.isArray(p.outletNames))).toBe(true)
  })
})

describe('the reporting tree', () => {
  const tree = buildReportingTree(assembleOrganization(PILOT, [], []))

  it('has one root, the owner', () => {
    expect(tree).toHaveLength(1)
    expect(tree[0].person.full_name).toBe('Jay Khanted')
  })

  it('puts the three sales heads under the administrator, and nobody under the owner directly', () => {
    const vinay = tree[0].reports
    expect(vinay).toHaveLength(1)
    expect(vinay[0].person.full_name).toBe('Vinay Kumar Jain')

    const heads = vinay[0].reports.map((node) => node.person.full_name).sort()
    expect(heads).toEqual(['Dhanendran', 'Jainendra', 'Pankaj'])
  })

  it('puts each salesperson under their own sales head', () => {
    const heads = tree[0].reports[0].reports
    const teamOf = (name: string) =>
      heads
        .find((node) => node.person.full_name === name)!
        .reports.map((node) => node.person.full_name)
        .sort()

    expect(teamOf('Pankaj')).toEqual(['Revathi'])
    expect(teamOf('Jainendra')).toEqual(['Ashokji', 'Deivanai', 'Kathirvel', 'Thamarai'])
    expect(teamOf('Dhanendran')).toEqual(['Anandh', 'Ankur Tiwari', 'Sathya', 'Selvi'])
  })

  it('loads for a brand-new deployment: one owner, nobody else', () => {
    // The state the office server is in right now, and the state both screens
    // have to render without failing.
    const tree = buildReportingTree(assembleOrganization([person('Jay Khanted', 'OWNER')], [], []))
    expect(tree).toHaveLength(1)
    expect(tree[0].person.full_name).toBe('Jay Khanted')
    expect(tree[0].reports).toEqual([])
  })

  it('loads for an empty organisation without throwing', () => {
    expect(buildReportingTree(assembleOrganization([], [], []))).toEqual([])
    expect(assembleOrganization([], [], [])).toEqual([])
  })

  it('grows the moment somebody is given a manager', () => {
    const before = buildReportingTree(
      assembleOrganization([person('Jay Khanted', 'OWNER'), person('Vinay Kumar Jain', 'ADMIN')], [], []),
    )
    // Two roots: nobody reports to anybody yet.
    expect(before.map((node) => node.person.full_name).sort()).toEqual([
      'Jay Khanted',
      'Vinay Kumar Jain',
    ])

    const after = buildReportingTree(
      assembleOrganization(
        [person('Jay Khanted', 'OWNER'), person('Vinay Kumar Jain', 'ADMIN', 'Jay Khanted')],
        [],
        [],
      ),
    )
    expect(after).toHaveLength(1)
    expect(after[0].reports[0].person.full_name).toBe('Vinay Kumar Jain')
  })

  it('roots a sales head’s own view at themselves', () => {
    // Their administrator may not be in their set; the tree must still be
    // well-formed rather than dangling off a node they cannot see.
    const teamOnly = PILOT.filter((p) =>
      ['Pankaj', 'Revathi'].includes(p.full_name),
    )
    const tree = buildReportingTree(assembleOrganization(teamOnly, [], []))
    expect(tree).toHaveLength(1)
    expect(tree[0].person.full_name).toBe('Pankaj')
    expect(tree[0].reports.map((node) => node.person.full_name)).toEqual(['Revathi'])
  })

  it('keeps a deactivated person in the tree, marked', () => {
    const withLeaver = [
      person('Jay Khanted', 'OWNER'),
      person('Vinay Kumar Jain', 'ADMIN', 'Jay Khanted', { is_active: false }),
    ]
    const tree = buildReportingTree(assembleOrganization(withLeaver, [], []))
    expect(tree[0].reports[0].person.is_active).toBe(false)
  })
})
