import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assembleOrganization, buildReportingTree } from '@/lib/organization'
import type { UserRow } from '@/types/domain'

import { canSee, connect, expectRejected, updateRowCount, visibleIds, type Db } from './harness'

/**
 * The pilot organisation, exactly as the business runs it (ADR-040).
 *
 * **This is the file that proves the reporting line is the authorization
 * boundary.** Everything else about the organisation — the navigation, the
 * people table, the branch selector — is a rendering choice. This is the part
 * that holds against a direct PostgREST call.
 *
 * The shape under test:
 *
 *   Jay Khanted (OWNER)
 *     Vinay Kumar Jain (ADMIN)
 *       Pankaj (Sales Head 1)     — Revathi
 *       Jainendra (Sales Head 2)  — Thamarai, Ashokji, Deivanai, Kathirvel
 *       Dhanendran (Sales Head 3) — Anandh, Ankur Tiwari, Sathya, Selvi
 *
 * All three sales heads work out of ONE branch, Moolakarai, and that is the
 * whole reason this model exists: under outlet scope each of them read the other
 * two's pipeline, because a shared branch was a shared read grant.
 *
 * **These rows are created inside a rolled-back transaction and are not seeded
 * anywhere.** The real thirteen people are created by the owner through
 * Settings → Organization → People, which provisions real Auth accounts; nothing
 * here ships a credential (CLAUDE.md §15).
 *
 * Every assertion is made AS THE RESTRICTED ROLE (§23).
 */

let db: Db

beforeAll(async () => {
  db = await connect()
})
afterAll(async () => {
  await db.end()
})

/** `axxx` ids — nothing else in the fixtures uses that prefix. */
const ID = (n: number) => `00000000-0000-4000-8000-0000000a${String(n).padStart(4, '0')}`

const ORG = {
  jay: ID(1),
  vinay: ID(2),
  pankaj: ID(3),
  jainendra: ID(4),
  dhanendran: ID(5),
  revathi: ID(11),
  thamarai: ID(12),
  ashokji: ID(13),
  deivanai: ID(14),
  kathirvel: ID(15),
  anandh: ID(21),
  ankur: ID(22),
  sathya: ID(23),
  selvi: ID(24),
  moolakarai: ID(101),
  chithode: ID(102),
  // One customer and one opportunity per salesperson we assert against.
  revathiAccount: ID(201),
  thamaraiAccount: ID(202),
  anandhAccount: ID(203),
  revathiOpportunity: ID(301),
  thamaraiOpportunity: ID(302),
  anandhOpportunity: ID(303),
} as const

const SALES_HEADS = [
  ['Pankaj', ORG.pankaj],
  ['Jainendra', ORG.jainendra],
  ['Dhanendran', ORG.dhanendran],
] as const

/**
 * Build the organisation the way the application does: an Auth account first,
 * which the `on_auth_user_created` trigger mirrors into `public.users` as an
 * active SALESPERSON, then the role, then the reporting line — top down, because
 * `guard_user_hierarchy()` reads the manager's role and the manager has to
 * already have it.
 */
async function arrangePilot(tx: Db): Promise<void> {
  const people: [string, string, string][] = [
    [ORG.jay, 'jay@pilot.test', 'Jay Khanted'],
    [ORG.vinay, 'vinay@pilot.test', 'Vinay Kumar Jain'],
    [ORG.pankaj, 'pankaj@pilot.test', 'Pankaj'],
    [ORG.jainendra, 'jainendra@pilot.test', 'Jainendra'],
    [ORG.dhanendran, 'dhanendran@pilot.test', 'Dhanendran'],
    [ORG.revathi, 'revathi@pilot.test', 'Revathi'],
    [ORG.thamarai, 'thamarai@pilot.test', 'Thamarai'],
    [ORG.ashokji, 'ashokji@pilot.test', 'Ashokji'],
    [ORG.deivanai, 'deivanai@pilot.test', 'Deivanai'],
    [ORG.kathirvel, 'kathirvel@pilot.test', 'Kathirvel'],
    [ORG.anandh, 'anandh@pilot.test', 'Anandh'],
    [ORG.ankur, 'ankur@pilot.test', 'Ankur Tiwari'],
    [ORG.sathya, 'sathya@pilot.test', 'Sathya'],
    [ORG.selvi, 'selvi@pilot.test', 'Selvi'],
  ]
  for (const [id, email, name] of people) {
    await tx.query(
      `insert into auth.users (id, email, aud, role, encrypted_password, email_confirmed_at, raw_user_meta_data)
       values ($1, $2, 'authenticated', 'authenticated', 'x', now(), jsonb_build_object('full_name', $3::text))`,
      [id, email, name],
    )
  }

  await tx.query(`update public.users set role = 'OWNER'   where id = $1`, [ORG.jay])
  await tx.query(`update public.users set role = 'ADMIN'   where id = $1`, [ORG.vinay])
  await tx.query(`update public.users set role = 'MANAGER' where id = any($1::uuid[])`, [
    [ORG.pankaj, ORG.jainendra, ORG.dhanendran],
  ])

  await tx.query(`update public.users set manager_id = $1 where id = $2`, [ORG.jay, ORG.vinay])
  await tx.query(`update public.users set manager_id = $1 where id = any($2::uuid[])`, [
    ORG.vinay,
    [ORG.pankaj, ORG.jainendra, ORG.dhanendran],
  ])
  await tx.query(`update public.users set manager_id = $1 where id = any($2::uuid[])`, [
    ORG.pankaj,
    [ORG.revathi],
  ])
  await tx.query(`update public.users set manager_id = $1 where id = any($2::uuid[])`, [
    ORG.jainendra,
    [ORG.thamarai, ORG.ashokji, ORG.deivanai, ORG.kathirvel],
  ])
  await tx.query(`update public.users set manager_id = $1 where id = any($2::uuid[])`, [
    ORG.dhanendran,
    [ORG.anandh, ORG.ankur, ORG.sathya, ORG.selvi],
  ])

  // Moolakarai runs the pilot. Chithode exists and is deliberately closed: the
  // branch is real, the business is not working it yet, and nobody is posted to
  // it — so it must not appear in a salesperson's branch selector.
  await tx.query(
    `insert into public.outlets (id, code, name, city, is_active) values
       ($1, 'MOOL', 'Moolakarai Branch', 'Erode', true),
       ($2, 'CHIT', 'Chithode Branch',   'Erode', false)`,
    [ORG.moolakarai, ORG.chithode],
  )

  // Everybody who works the pilot is posted to Moolakarai. Nobody to Chithode.
  await tx.query(
    `insert into public.user_outlets (user_id, outlet_id)
     select unnest($1::uuid[]), $2`,
    [
      [
        ORG.pankaj, ORG.jainendra, ORG.dhanendran,
        ORG.revathi, ORG.thamarai, ORG.ashokji, ORG.deivanai, ORG.kathirvel,
        ORG.anandh, ORG.ankur, ORG.sathya, ORG.selvi,
      ],
      ORG.moolakarai,
    ],
  )

  const work: [string, string, string, string][] = [
    [ORG.revathiAccount, ORG.revathiOpportunity, ORG.revathi, 'Revathi Customer'],
    [ORG.thamaraiAccount, ORG.thamaraiOpportunity, ORG.thamarai, 'Thamarai Customer'],
    [ORG.anandhAccount, ORG.anandhOpportunity, ORG.anandh, 'Anandh Customer'],
  ]
  for (const [accountId, opportunityId, ownerId, name] of work) {
    await tx.query(
      `insert into public.accounts (id, name, account_type, phone, owner_id, outlet_id, city)
       values ($1, $2, 'HOMEOWNER', $3, $4, $5, 'Erode')`,
      [accountId, name, `+91 98${accountId.slice(-8)}`, ownerId, ORG.moolakarai],
    )
    await tx.query(
      `insert into public.opportunities
         (id, account_id, title, category, stage, estimated_value, owner_id, outlet_id)
       values ($1, $2, $3, 'TILES', 'new', 1000000, $4, $5)`,
      [opportunityId, accountId, `${name} enquiry`, ownerId, ORG.moolakarai],
    )
  }
}

/** Arrange, then act as one user, all inside one rolled-back transaction. */
async function withPilot<T>(userId: string | null, act: (tx: Db) => Promise<T>): Promise<T> {
  await db.query('begin')
  try {
    await arrangePilot(db)
    if (userId) {
      await db.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: userId, role: 'authenticated' }),
      ])
      await db.query('set local role authenticated')
    } else {
      await db.query('set local role anon')
    }
    return await act(db)
  } finally {
    await db.query('rollback')
  }
}

// ================================================== the reporting line ====

describe('the pilot reporting line is exactly as the business states it', () => {
  it('places every one of the thirteen people under the right person', async () => {
    const line = await withPilot(null, async (tx) => {
      await tx.query('reset role')
      const { rows } = await tx.query(
        `select p.full_name as person, m.full_name as reports_to, p.role
           from public.users p
           left join public.users m on m.id = p.manager_id
          where p.id = any($1::uuid[])
          order by p.full_name`,
        [Object.values(ORG).filter((id) => id <= ID(24))],
      )
      return Object.fromEntries(
        rows.map((r: { person: string; reports_to: string | null }) => [r.person, r.reports_to]),
      )
    })

    expect(line).toEqual({
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

  it('never makes a sales head a direct report of the owner', async () => {
    const heads = await withPilot(null, async (tx) => {
      await tx.query('reset role')
      const { rows } = await tx.query(
        `select count(*)::int as n from public.users
          where id = any($1::uuid[]) and manager_id = $2`,
        [SALES_HEADS.map(([, id]) => id), ORG.jay],
      )
      return rows[0].n
    })
    expect(heads).toBe(0)
  })
})

// =============================================== the illegal shapes ======

describe('the database refuses an organisation that cannot exist', () => {
  it('refuses a salesperson reporting to another salesperson', async () => {
    await withPilot(null, async (tx) => {
      await tx.query('reset role')
      const error = await expectRejected(
        tx,
        `update public.users set manager_id = $1 where id = $2`,
        [ORG.thamarai, ORG.revathi],
      )
      expect(error.message).toMatch(/reports to a sales head/i)
    })
  })

  it('refuses a sales head reporting to the owner', async () => {
    await withPilot(null, async (tx) => {
      await tx.query('reset role')
      const error = await expectRejected(
        tx,
        `update public.users set manager_id = $1 where id = $2`,
        [ORG.jay, ORG.pankaj],
      )
      expect(error.message).toMatch(/reports to an administrator/i)
    })
  })

  it('refuses a sales head reporting to another sales head', async () => {
    await withPilot(null, async (tx) => {
      await tx.query('reset role')
      const error = await expectRejected(
        tx,
        `update public.users set manager_id = $1 where id = $2`,
        [ORG.jainendra, ORG.pankaj],
      )
      expect(error.message).toMatch(/reports to an administrator/i)
    })
  })

  it('refuses a self-manager, at every level', async () => {
    await withPilot(null, async (tx) => {
      await tx.query('reset role')
      for (const person of [ORG.revathi, ORG.pankaj, ORG.vinay]) {
        const error = await expectRejected(
          tx,
          `update public.users set manager_id = $1 where id = $1`,
          [person],
        )
        // Two controls refuse this — the pairing rules and the `manager_not_self`
        // CHECK — and the trigger answers first because a BEFORE trigger runs
        // ahead of constraint evaluation. What matters is that it cannot happen.
        expect(error.code).toMatch(/23514/)
      }
    })
  })

  it('keeps the manager_not_self constraint, which the pairing rules currently mask', async () => {
    // The trigger gets there first today, so without this the constraint could be
    // dropped and the suite would stay green — until a rule change let a
    // self-manager through the trigger.
    const constraints = await withPilot(null, async (tx) => {
      await tx.query('reset role')
      const { rows } = await tx.query(
        `select conname from pg_constraint
          where conrelid = 'public.users'::regclass and conname = 'manager_not_self'`,
      )
      return rows.map((r: { conname: string }) => r.conname)
    })
    expect(constraints).toEqual(['manager_not_self'])
  })

  it('cannot be made to loop, because the ladder is strictly ranked', async () => {
    await withPilot(null, async (tx) => {
      await tx.query('reset role')
      // Every attempt to close the line on itself has to step DOWN the ladder,
      // and each rung refuses. This is why the cycle walk in the trigger is a
      // backstop for a future rule change rather than the thing doing the work.
      const jayUnderVinay = await expectRejected(
        tx,
        `update public.users set manager_id = $1 where id = $2`,
        [ORG.vinay, ORG.jay],
      )
      expect(jayUnderVinay.message).toMatch(/owner reports to nobody/i)

      const vinayUnderPankaj = await expectRejected(
        tx,
        `update public.users set manager_id = $1 where id = $2`,
        [ORG.pankaj, ORG.vinay],
      )
      expect(vinayUnderPankaj.message).toMatch(/administrator reports to the owner/i)

      const pankajUnderRevathi = await expectRejected(
        tx,
        `update public.users set manager_id = $1 where id = $2`,
        [ORG.revathi, ORG.pankaj],
      )
      expect(pankajUnderRevathi.message).toMatch(/sales head reports to an administrator/i)
    })
  })

  it('refuses giving the owner somebody to report to', async () => {
    await withPilot(null, async (tx) => {
      await tx.query('reset role')
      const error = await expectRejected(
        tx,
        `update public.users set manager_id = $1 where id = $2`,
        [ORG.vinay, ORG.jay],
      )
      expect(error.message).toMatch(/owner reports to nobody/i)
    })
  })

  it('refuses demoting a sales head who still has a team', async () => {
    await withPilot(null, async (tx) => {
      await tx.query('reset role')
      const error = await expectRejected(
        tx,
        `update public.users set role = 'SALESPERSON' where id = $1`,
        [ORG.jainendra],
      )
      expect(error.message).toMatch(/still has direct reports/i)
    })
  })
})

// ================================================ sales head isolation ===

describe('a sales head sees their own team and nobody else’s', () => {
  it('Pankaj sees Revathi’s work and neither of the other teams’', async () => {
    await withPilot(ORG.pankaj, async (tx) => {
      expect(await canSee(tx, 'accounts', ORG.revathiAccount)).toBe(true)
      expect(await canSee(tx, 'opportunities', ORG.revathiOpportunity)).toBe(true)

      expect(await canSee(tx, 'accounts', ORG.thamaraiAccount)).toBe(false)
      expect(await canSee(tx, 'opportunities', ORG.thamaraiOpportunity)).toBe(false)
      expect(await canSee(tx, 'accounts', ORG.anandhAccount)).toBe(false)
      expect(await canSee(tx, 'opportunities', ORG.anandhOpportunity)).toBe(false)
    })
  })

  it('Jainendra sees Thamarai’s work and neither of the other teams’', async () => {
    await withPilot(ORG.jainendra, async (tx) => {
      expect(await canSee(tx, 'opportunities', ORG.thamaraiOpportunity)).toBe(true)
      expect(await canSee(tx, 'opportunities', ORG.revathiOpportunity)).toBe(false)
      expect(await canSee(tx, 'opportunities', ORG.anandhOpportunity)).toBe(false)
    })
  })

  it('Dhanendran sees Anandh’s work and neither of the other teams’', async () => {
    await withPilot(ORG.dhanendran, async (tx) => {
      expect(await canSee(tx, 'opportunities', ORG.anandhOpportunity)).toBe(true)
      expect(await canSee(tx, 'opportunities', ORG.revathiOpportunity)).toBe(false)
      expect(await canSee(tx, 'opportunities', ORG.thamaraiOpportunity)).toBe(false)
    })
  })

  it('ALL THREE SHARE ONE BRANCH — which is why the branch cannot be the rule', async () => {
    // Every person in the pilot is posted to Moolakarai. Under outlet scope this
    // single fact gave each sales head all three teams; the assertions above are
    // only meaningful because of it, so it is asserted rather than assumed.
    const postings = await withPilot(null, async (tx) => {
      await tx.query('reset role')
      const { rows } = await tx.query(
        `select count(distinct outlet_id)::int as branches, count(*)::int as people
           from public.user_outlets where revoked_at is null and user_id = any($1::uuid[])`,
        [[ORG.pankaj, ORG.jainendra, ORG.dhanendran, ORG.revathi, ORG.thamarai, ORG.anandh]],
      )
      return rows[0]
    })
    expect(postings).toEqual({ branches: 1, people: 6 })
  })

  it('a sales head sees the people on their team and not the other teams', async () => {
    await withPilot(ORG.jainendra, async (tx) => {
      const ids = await visibleIds(tx, 'users')
      expect(ids).toContain(ORG.thamarai)
      expect(ids).toContain(ORG.ashokji)
      expect(ids).toContain(ORG.deivanai)
      expect(ids).toContain(ORG.kathirvel)

      expect(ids).not.toContain(ORG.revathi)
      expect(ids).not.toContain(ORG.anandh)
      expect(ids).not.toContain(ORG.selvi)
    })
  })

  it('a sales head cannot reach another team by naming the row directly', async () => {
    // The list being filtered is not the control; the row must be unreachable.
    await withPilot(ORG.pankaj, async (tx) => {
      const { rows } = await tx.query(
        `select id from public.opportunities where id = $1`,
        [ORG.anandhOpportunity],
      )
      expect(rows).toHaveLength(0)

      expect(
        await updateRowCount(tx, `update public.opportunities set title = 'taken' where id = $1`, [
          ORG.anandhOpportunity,
        ]),
      ).toBe(0)
    })
  })
})

// =================================================== salesperson scope ===

describe('a salesperson has their own workspace and nothing else', () => {
  it('sees their own records and no colleague’s', async () => {
    await withPilot(ORG.revathi, async (tx) => {
      expect(await canSee(tx, 'accounts', ORG.revathiAccount)).toBe(true)
      expect(await canSee(tx, 'accounts', ORG.thamaraiAccount)).toBe(false)
      expect(await canSee(tx, 'accounts', ORG.anandhAccount)).toBe(false)
      expect(await canSee(tx, 'opportunities', ORG.thamaraiOpportunity)).toBe(false)
    })
  })

  it('is refused every company report at the database boundary', async () => {
    await withPilot(ORG.revathi, async (tx) => {
      const error = await expectRejected(
        tx,
        `select * from public.management_period_summary(now() - interval '30 days', now())`,
      )
      expect(error.code).toBe('42501')
      expect(error.message).toMatch(/sales heads/i)
    })
  })

  it('cannot read the team list, even one row of it', async () => {
    await withPilot(ORG.revathi, async (tx) => {
      const ids = await visibleIds(tx, 'users')
      // Themselves and the sales head whose name appears on their own records.
      expect(ids).toContain(ORG.revathi)
      expect(ids).toContain(ORG.pankaj)
      expect(ids).not.toContain(ORG.thamarai)
      expect(ids).not.toContain(ORG.anandh)
      expect(ids).not.toContain(ORG.jainendra)
    })
  })

  it('cannot promote themselves into a sales head’s scope', async () => {
    await withPilot(ORG.revathi, async (tx) => {
      const error = await expectRejected(tx, `update public.users set role = 'MANAGER' where id = $1`, [
        ORG.revathi,
      ])
      expect(['42501', '23514']).toContain(error.code)
    })
  })

  it('cannot move themselves onto another sales head', async () => {
    await withPilot(ORG.revathi, async (tx) => {
      const error = await expectRejected(
        tx,
        `update public.users set manager_id = $1 where id = $2`,
        [ORG.jainendra, ORG.revathi],
      )
      expect(error.code).toBe('42501')
    })
  })
})

// ======================================================== the branches ===

describe('Moolakarai runs the pilot and Chithode is not offered', () => {
  it('creates both branches, with Chithode closed', async () => {
    const branches = await withPilot(ORG.revathi, async (tx) => {
      const { rows } = await tx.query(
        `select name, is_active from public.outlets where id = any($1::uuid[]) order by name`,
        [[ORG.moolakarai, ORG.chithode]],
      )
      return rows
    })
    expect(branches).toEqual([
      { name: 'Chithode Branch', is_active: false },
      { name: 'Moolakarai Branch', is_active: true },
    ])
  })

  it('gives a pilot sales head Moolakarai to work in, and not Chithode', async () => {
    await withPilot(ORG.pankaj, async (tx) => {
      const { rows } = await tx.query('select public.scoped_outlet_ids() as id')
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toEqual([ORG.moolakarai])
      expect(ids).not.toContain(ORG.chithode)
    })
  })

  it('gives the owner and the administrator Moolakarai, and never the closed branch', async () => {
    // Both are company-wide by role, so their scope is every ACTIVE branch —
    // resolved at read time, so a branch opened tomorrow is in scope tomorrow
    // with no membership row to remember (ADR-016).
    for (const who of [ORG.jay, ORG.vinay]) {
      await withPilot(who, async (tx) => {
        const { rows } = await tx.query('select public.scoped_outlet_ids() as id')
        const ids = rows.map((r: { id: string }) => r.id)
        expect(ids).toContain(ORG.moolakarai)
        expect(ids).not.toContain(ORG.chithode)
      })
    }
  })

  it('assigns nobody to Chithode during the pilot', async () => {
    const assigned = await withPilot(null, async (tx) => {
      await tx.query('reset role')
      const { rows } = await tx.query(
        `select count(*)::int as n from public.user_outlets
          where outlet_id = $1 and revoked_at is null`,
        [ORG.chithode],
      )
      return rows[0].n
    })
    expect(assigned).toBe(0)
  })

  it('refuses a salesperson filing a record against a branch they do not hold', async () => {
    await withPilot(ORG.revathi, async (tx) => {
      // Not a branch check but an ownership one, and that is the point: the
      // record must be theirs. A salesperson cannot file work for anyone else at
      // any branch, Chithode included.
      const error = await expectRejected(
        tx,
        `insert into public.accounts (name, account_type, phone, owner_id, outlet_id)
         values ('Chithode Customer', 'HOMEOWNER', '+91 90000 12345', $1, $2)`,
        [ORG.thamarai, ORG.chithode],
      )
      expect(error.code).toBe('42501')
    })
  })
})

// ================================================= administrator scope ===

describe('the administrator sees the pilot and changes none of it', () => {
  it('Vinay sees all three teams’ work', async () => {
    await withPilot(ORG.vinay, async (tx) => {
      expect(await canSee(tx, 'opportunities', ORG.revathiOpportunity)).toBe(true)
      expect(await canSee(tx, 'opportunities', ORG.thamaraiOpportunity)).toBe(true)
      expect(await canSee(tx, 'opportunities', ORG.anandhOpportunity)).toBe(true)
    })
  })

  it('Vinay sees every person in the organisation', async () => {
    await withPilot(ORG.vinay, async (tx) => {
      const ids = await visibleIds(tx, 'users')
      for (const person of [ORG.pankaj, ORG.jainendra, ORG.dhanendran, ORG.revathi, ORG.selvi]) {
        expect(ids).toContain(person)
      }
    })
  })

  it('Vinay writes no business data', async () => {
    await withPilot(ORG.vinay, async (tx) => {
      expect(
        await updateRowCount(tx, `update public.opportunities set title = 'admin edit' where id = $1`, [
          ORG.revathiOpportunity,
        ]),
      ).toBe(0)
    })
  })

  it('Jay sees everything, as the owner', async () => {
    await withPilot(ORG.jay, async (tx) => {
      expect(await canSee(tx, 'opportunities', ORG.revathiOpportunity)).toBe(true)
      expect(await canSee(tx, 'opportunities', ORG.thamaraiOpportunity)).toBe(true)
      expect(await canSee(tx, 'opportunities', ORG.anandhOpportunity)).toBe(true)
    })
  })
})

// ====================================== the organisation screens ==========

/**
 * The People and Reporting Structure screens, end to end minus the transport
 * (ADR-041).
 *
 * **The rows come from real row-level security; the assembly is the real
 * function the pages call.** `loadOrganization()` is three plain queries and a
 * call to `assembleOrganization` — no PostgREST embedding, after the office
 * server's PostgREST 12.2.12 refused to expose `users` → `users` and answered
 * PGRST200 on both screens. The queries below are exactly what that helper
 * issues, run as the role under test, so what these assert is what those screens
 * render.
 *
 * The point of doing it this way: if the RLS scope ever widened, the manager
 * names resolved here would widen with it and these tests would fail. A test
 * that assembled hand-written rows could not notice.
 */
async function organizationAs(userId: string) {
  return withPilot(userId, async (tx) => {
    const users = await tx.query('select * from public.users order by full_name')
    const links = await tx.query(
      'select user_id, outlet_id, revoked_at from public.user_outlets where revoked_at is null',
    )
    const branches = await tx.query('select id, name from public.outlets')

    const people = assembleOrganization(users.rows as UserRow[], links.rows, branches.rows)
    return { people, tree: buildReportingTree(people) }
  })
}

const lineOf = (people: { full_name: string; managerName: string | null }[]) =>
  Object.fromEntries(people.map((p) => [p.full_name, p.managerName]))

describe('the People screen, from real row-level security', () => {
  it('loads for the OWNER, with every reporting pair resolved', async () => {
    const { people } = await organizationAs(ORG.jay)
    const line = lineOf(people)

    expect(line['Vinay Kumar Jain']).toBe('Jay Khanted')
    expect(line.Pankaj).toBe('Vinay Kumar Jain')
    expect(line.Jainendra).toBe('Vinay Kumar Jain')
    expect(line.Dhanendran).toBe('Vinay Kumar Jain')
    expect(line.Revathi).toBe('Pankaj')
    for (const name of ['Thamarai', 'Ashokji', 'Deivanai', 'Kathirvel']) {
      expect(line[name]).toBe('Jainendra')
    }
    for (const name of ['Anandh', 'Ankur Tiwari', 'Sathya', 'Selvi']) {
      expect(line[name]).toBe('Dhanendran')
    }
    expect(line['Jay Khanted']).toBeNull()
  })

  it('loads for the ADMINISTRATOR, who administers the organisation', async () => {
    const { people } = await organizationAs(ORG.vinay)
    const names = people.map((p) => p.full_name)
    for (const name of ['Pankaj', 'Jainendra', 'Dhanendran', 'Revathi', 'Selvi']) {
      expect(names).toContain(name)
    }
    expect(lineOf(people).Revathi).toBe('Pankaj')
  })

  it('shows a sales head their own team, and resolves nobody else’s manager', async () => {
    const { people } = await organizationAs(ORG.jainendra)
    const names = people.map((p) => p.full_name)

    expect(names).toContain('Jainendra')
    for (const name of ['Thamarai', 'Ashokji', 'Deivanai', 'Kathirvel']) {
      expect(names).toContain(name)
    }
    // The other two teams are not in the set, so nothing about them can be
    // assembled — not a name, not a manager, not an id.
    for (const name of ['Revathi', 'Anandh', 'Selvi', 'Pankaj', 'Dhanendran']) {
      expect(names).not.toContain(name)
    }

    const line = lineOf(people)
    expect(line.Thamarai).toBe('Jainendra')
  })

  it('resolves a sales head’s OWN manager, because they may read that row', async () => {
    // `users_select` grants `id = my_manager_id()`. So the administrator is in
    // the set and resolves — from the set, never by a second query.
    const { people } = await organizationAs(ORG.pankaj)
    expect(lineOf(people).Pankaj).toBe('Vinay Kumar Jain')
  })

  it('gives a salesperson themselves and their sales head, and nothing more', async () => {
    const { people } = await organizationAs(ORG.revathi)
    const names = people.map((p) => p.full_name).sort()

    expect(names).toEqual(['Pankaj', 'Revathi'])
    expect(lineOf(people).Revathi).toBe('Pankaj')
  })

  it('does not let manager_id leak a person the caller cannot read', async () => {
    // Pankaj's row IS readable to Revathi; Vinay's is not. The column still
    // points at him, and the assembly must say nothing about him.
    const { people } = await organizationAs(ORG.revathi)
    const pankaj = people.find((p) => p.full_name === 'Pankaj')!

    expect(pankaj.manager_id).toBe(ORG.vinay)
    expect(pankaj.managerName).toBeNull()
    expect(pankaj.managerRole).toBeNull()
    expect(people.map((p) => p.id)).not.toContain(ORG.vinay)
  })

  it('resolves each person’s branch by name', async () => {
    const { people } = await organizationAs(ORG.jay)
    const revathi = people.find((p) => p.full_name === 'Revathi')!
    expect(revathi.outletNames).toEqual(['Moolakarai Branch'])
    expect(revathi.outletNames).not.toContain('Chithode Branch')
  })
})

describe('the Reporting Structure screen, from real row-level security', () => {
  it('draws the pilot organisation for the OWNER', async () => {
    const { tree } = await organizationAs(ORG.jay)

    const jay = tree.find((node) => node.person.full_name === 'Jay Khanted')!
    expect(jay).toBeDefined()

    const vinay = jay.reports.find((node) => node.person.full_name === 'Vinay Kumar Jain')!
    expect(vinay).toBeDefined()

    const heads = vinay.reports.map((node) => node.person.full_name).sort()
    expect(heads).toEqual(['Dhanendran', 'Jainendra', 'Pankaj'])

    const teamOf = (name: string) =>
      vinay.reports
        .find((node) => node.person.full_name === name)!
        .reports.map((node) => node.person.full_name)
        .sort()

    expect(teamOf('Pankaj')).toEqual(['Revathi'])
    expect(teamOf('Jainendra')).toEqual(['Ashokji', 'Deivanai', 'Kathirvel', 'Thamarai'])
    expect(teamOf('Dhanendran')).toEqual(['Anandh', 'Ankur Tiwari', 'Sathya', 'Selvi'])
  })

  it('roots a sales head’s tree at their administrator, and shows one team', async () => {
    const { tree } = await organizationAs(ORG.jainendra)
    const roots = tree.map((node) => node.person.full_name)

    // Vinay is readable (their own manager), so the tree hangs from him — and
    // carries exactly one sales head, this one.
    expect(roots).toEqual(['Vinay Kumar Jain'])
    const heads = tree[0].reports.map((node) => node.person.full_name)
    expect(heads).toEqual(['Jainendra'])
    expect(tree[0].reports[0].reports.map((node) => node.person.full_name).sort()).toEqual([
      'Ashokji',
      'Deivanai',
      'Kathirvel',
      'Thamarai',
    ])
  })

  it('draws two nodes for a salesperson, and no other team', async () => {
    const { tree } = await organizationAs(ORG.revathi)
    expect(tree.map((node) => node.person.full_name)).toEqual(['Pankaj'])
    expect(tree[0].reports.map((node) => node.person.full_name)).toEqual(['Revathi'])
  })
})

describe('a deployment with only the bootstrapped owner', () => {
  /** The state the office server is in right now: one OWNER, no branches, nobody else. */
  async function bareOwner<T>(act: (tx: Db) => Promise<T>): Promise<T> {
    await db.query('begin')
    try {
      await db.query(
        `insert into auth.users (id, email, aud, role, encrypted_password, email_confirmed_at, raw_user_meta_data)
         values ($1, 'solo@pilot.test', 'authenticated', 'authenticated', 'x', now(),
                 jsonb_build_object('full_name', 'Solo Owner'::text))`,
        [ORG.jay],
      )
      await db.query(`update public.users set role = 'OWNER' where id = $1`, [ORG.jay])
      await db.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: ORG.jay, role: 'authenticated' }),
      ])
      await db.query('set local role authenticated')
      return await act(db)
    } finally {
      await db.query('rollback')
    }
  }

  it('loads both screens before anybody else exists', async () => {
    const { people, tree } = await bareOwner(async (tx) => {
      const users = await tx.query('select * from public.users order by full_name')
      const links = await tx.query(
        'select user_id, outlet_id, revoked_at from public.user_outlets where revoked_at is null',
      )
      const branches = await tx.query('select id, name from public.outlets')
      const assembled = assembleOrganization(users.rows as UserRow[], links.rows, branches.rows)
      return { people: assembled, tree: buildReportingTree(assembled) }
    })

    // The owner sees themselves. The ADR-003 system actor is an INACTIVE ADMIN
    // and is deliberately visible to an owner administering the organisation.
    const solo = people.find((p) => p.id === ORG.jay)!
    expect(solo.full_name).toBe('Solo Owner')
    expect(solo.managerName).toBeNull()
    expect(solo.outletNames).toEqual([])

    // A tree, not an exception — which is all the page needs to render.
    expect(tree.length).toBeGreaterThan(0)
    expect(tree.some((node) => node.person.id === ORG.jay)).toBe(true)
  })
})
