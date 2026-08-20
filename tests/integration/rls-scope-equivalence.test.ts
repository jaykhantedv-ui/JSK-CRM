import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { OUTLETS, USERS, asUser, connect, type Db } from './harness'

/**
 * Migrations 028 and 029 replaced three per-row policy calls with per-query sets,
 * because outlet scope was costing 792 ms on 20,005 opportunities and the accounts
 * list 3,754 ms. The claim made in those migrations is that the rule did not
 * change — only how often the planner asks it.
 *
 * The 403 tests in the rest of this suite are the real proof of that: they assert
 * who can see what, and they passed unchanged across both migrations. This file
 * pins the claim directly, one role at a time, so that if someone later edits a
 * helper and quietly widens it, the failure names the helper rather than showing
 * up as a puzzling change in a permission test somewhere else.
 *
 * **Every assertion is made AS THE RESTRICTED ROLE** (§23). OWNER appears only to
 * confirm company-wide access.
 */

let db: Db

beforeAll(async () => {
  db = await connect()
})
afterAll(async () => {
  await db.end()
})

/** `manages_outlet(x)` — the pre-028 predicate, still present as a readable helper. */
async function oldWay(userId: string | null, outlet: string): Promise<boolean> {
  return asUser(db, userId, async (c) => {
    const { rows } = await c.query('select public.manages_outlet($1::uuid) as v', [outlet])
    return rows[0].v === true
  })
}

/** `(select is_owner()) or x in (select scoped_outlet_ids())` — what 028 put in the policies. */
async function newWay(userId: string | null, outlet: string): Promise<boolean> {
  return asUser(db, userId, async (c) => {
    const { rows } = await c.query(
      `select ((select public.is_owner())
               or $1::uuid in (select public.scoped_outlet_ids())) as v`,
      [outlet],
    )
    return rows[0].v === true
  })
}

describe('028 — outlet scope: the set form decides exactly what manages_outlet decided', () => {
  const cases: Array<[string, string | null, string]> = [
    ['OWNER, outlet A', USERS.owner, OUTLETS.a],
    ['OWNER, outlet B', USERS.owner, OUTLETS.b],
    ['OWNER, outlet C', USERS.owner, OUTLETS.c],
    ['MANAGER of A, outlet A', USERS.managerA, OUTLETS.a],
    ['MANAGER of A, outlet B', USERS.managerA, OUTLETS.b],
    ['MANAGER of A, outlet C', USERS.managerA, OUTLETS.c],
    ['MANAGER of A+C, outlet A', USERS.managerAC, OUTLETS.a],
    ['MANAGER of A+C, outlet B', USERS.managerAC, OUTLETS.b],
    ['MANAGER of A+C, outlet C', USERS.managerAC, OUTLETS.c],
    ['MANAGER with no outlets, outlet A', USERS.managerNone, OUTLETS.a],
    ['SALESPERSON, own outlet A', USERS.salesA1, OUTLETS.a],
    ['SALESPERSON, outlet B', USERS.salesA1, OUTLETS.b],
    ['ADMIN, outlet A', USERS.admin, OUTLETS.a],
    ['DEACTIVATED user, outlet A', USERS.deactivated, OUTLETS.a],
  ]

  for (const [label, user, outlet] of cases) {
    it(`agrees for ${label}`, async () => {
      expect(await newWay(user, outlet)).toBe(await oldWay(user, outlet))
    })
  }

  // An anonymous caller never reaches either form: every scoped policy is `to
  // authenticated`, so `anon` matches no policy and the expression is never
  // evaluated. Asking "do the two agree for anon?" is therefore the wrong
  // question — EXECUTE on both helpers is revoked from `anon` on purpose, and
  // that, plus seeing no rows, is the property worth pinning.
  it('refuses an anonymous caller outright rather than evaluating either form', async () => {
    await asUser(db, null, async (c) => {
      await expect(c.query('select public.is_owner()')).rejects.toThrow(/permission denied/i)
    })
    await asUser(db, null, async (c) => {
      await expect(c.query('select public.scoped_outlet_ids()')).rejects.toThrow(/permission denied/i)
    })
    // Stronger than "sees no rows": `anon` holds no SELECT grant on the table at
    // all, so the request is refused before RLS is even consulted.
    await asUser(db, null, async (c) => {
      await expect(c.query('select count(*) from public.accounts')).rejects.toThrow(
        /permission denied for table accounts/i,
      )
    })
  })

  // The one case where the two forms would have diverged if `scoped_outlet_ids()`
  // had been used on its own: its OWNER branch lists only `is_active` outlets, so
  // without the separate `is_owner()` disjunct an owner would silently lose a
  // closed outlet's history. 028 keeps them separate precisely for this.
  it('keeps an OWNER on a DEACTIVATED outlet, which scoped_outlet_ids() alone would not', async () => {
    const still = await asUser(db, USERS.owner, async (c) => {
      // Arranged inside the transaction asUser rolls back, so outlet C is active
      // again for every other test.
      await c.query('set local role postgres')
      await c.query('update public.outlets set is_active = false where id = $1', [OUTLETS.c])
      await c.query('set local role authenticated')
      const { rows } = await c.query(
        `select ((select public.is_owner())
                 or $1::uuid in (select public.scoped_outlet_ids())) as v`,
        [OUTLETS.c],
      )
      const { rows: legacy } = await c.query('select public.manages_outlet($1::uuid) as v', [
        OUTLETS.c,
      ])
      return { now: rows[0].v, before: legacy[0].v }
    })

    expect(still.before).toBe(true)
    expect(still.now).toBe(true)
  })
})

describe('029 — work context and readability sets match the functions they replaced', () => {
  it('my_opportunity_account_ids agrees with owns_opportunity_on_account, for every account', async () => {
    for (const user of [USERS.salesA1, USERS.salesA2, USERS.salesB1, USERS.managerA, USERS.owner]) {
      const mismatches = await asUser(db, user, async (c) => {
        const { rows } = await c.query(`
          with ids as (select public.my_opportunity_account_ids() as id)
          select a.id
            from public.accounts a
           where (a.id in (select id from ids))
                 is distinct from public.owns_opportunity_on_account(a.id)`)
        return rows.map((r: { id: string }) => r.id)
      })
      expect(mismatches, `user ${user}`).toEqual([])
    }
  })

  it('my_opportunity_project_ids agrees with owns_opportunity_on_project, for every project', async () => {
    for (const user of [USERS.salesA1, USERS.salesA2, USERS.salesB1, USERS.owner]) {
      const mismatches = await asUser(db, user, async (c) => {
        const { rows } = await c.query(`
          with ids as (select public.my_opportunity_project_ids() as id)
          select p.id
            from public.projects p
           where (p.id in (select id from ids))
                 is distinct from public.owns_opportunity_on_project(p.id)`)
        return rows.map((r: { id: string }) => r.id)
      })
      expect(mismatches, `user ${user}`).toEqual([])
    }
  })

  it('readable_opportunity_ids returns exactly the opportunities RLS lets through', async () => {
    for (const user of [USERS.salesA1, USERS.salesB1, USERS.managerA, USERS.managerNone, USERS.admin, USERS.owner]) {
      const { viaHelper, viaPolicy } = await asUser(db, user, async (c) => {
        const a = await c.query('select public.readable_opportunity_ids() as id')
        const b = await c.query('select id from public.opportunities')
        return {
          viaHelper: a.rows.map((r: { id: string }) => r.id).sort(),
          viaPolicy: b.rows.map((r: { id: string }) => r.id).sort(),
        }
      })
      expect(viaHelper, `user ${user}`).toEqual(viaPolicy)
    }
  })

  it('readable_account_ids returns exactly the accounts RLS lets through', async () => {
    for (const user of [USERS.salesA1, USERS.salesB1, USERS.managerA, USERS.managerNone, USERS.admin, USERS.owner]) {
      const { viaHelper, viaPolicy } = await asUser(db, user, async (c) => {
        const a = await c.query('select public.readable_account_ids() as id')
        const b = await c.query('select id from public.accounts')
        return {
          viaHelper: a.rows.map((r: { id: string }) => r.id).sort(),
          viaPolicy: b.rows.map((r: { id: string }) => r.id).sort(),
        }
      })
      expect(viaHelper, `user ${user}`).toEqual(viaPolicy)
    }
  })

  // The reason the helpers are SECURITY INVOKER. A DEFINER version would restate
  // the rule and, on a mistake, hand every row to everyone.
  it('a deactivated user reads nothing through the readable_* helpers', async () => {
    const counts = await asUser(db, USERS.deactivated, async (c) => {
      const o = await c.query('select count(*)::int n from (select public.readable_opportunity_ids()) s')
      const a = await c.query('select count(*)::int n from (select public.readable_account_ids()) s')
      return { opportunities: o.rows[0].n, accounts: a.rows[0].n }
    })
    expect(counts).toEqual({ opportunities: 0, accounts: 0 })
  })

  it('ADMIN still gets no business data through them (ADR-017)', async () => {
    const counts = await asUser(db, USERS.admin, async (c) => {
      const o = await c.query('select count(*)::int n from (select public.readable_opportunity_ids()) s')
      const a = await c.query('select count(*)::int n from (select public.readable_account_ids()) s')
      return { opportunities: o.rows[0].n, accounts: a.rows[0].n }
    })
    expect(counts).toEqual({ opportunities: 0, accounts: 0 })
  })
})
