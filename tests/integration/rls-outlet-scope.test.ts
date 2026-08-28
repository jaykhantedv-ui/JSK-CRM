import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ACCOUNTS,
  OPPORTUNITIES,
  OUTLETS,
  PROJECTS,
  USERS,
  asUser,
  canSee,
  connect,
  expectRejected,
  updateRowCount,
  visibleIds,
  type Db,
} from './harness'

/**
 * The reporting line, outlet scope and the role model, at the database boundary
 * (ADR-016, ADR-040).
 *
 * **What a sales head may READ is their team, not their branch.** ADR-040 made
 * that change because the business runs three sales heads out of one branch, and
 * outlet scope gave every one of them the other two's pipeline. Outlet scope did
 * not go away: it still decides which branches a person may file a record
 * against, compare in reporting, and move a record between.
 *
 * **Every assertion here is made AS THE RESTRICTED ROLE.** Verifying a permission
 * as OWNER proves nothing — OWNER passes everything (§23) — so the OWNER tests
 * exist only to confirm company-wide access, never to confirm a rule.
 */

let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db?.end()
})

describe('sales head team scope (ADR-040)', () => {
  it('a manager assigned to outlet A sees outlet A records', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA1)).toBe(true)
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA2)).toBe(true)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.aOwnedByA1)).toBe(true)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.aOwnedByA2)).toBe(true)
      expect(await canSee(tx, 'projects', PROJECTS.aOwnedByA1)).toBe(true)
    })
  })

  it('a manager assigned to outlet A CANNOT see outlet B records', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.bOwnedByB1)).toBe(false)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.bOwnedByB1)).toBe(false)
      expect(await canSee(tx, 'projects', PROJECTS.bOwnedByB1)).toBe(false)
    })
  })

  it('a sales head follows their report into another branch', async () => {
    // sales.a1 is posted to branch A and owns work at branch C. It is still
    // their sales head's to see: the record follows its OWNER, not its branch.
    await asUser(db, USERS.managerA, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.cOwnedByA1)).toBe(true)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.cOwnedByA1)).toBe(true)
    })
  })

  it('TWO SALES HEADS IN ONE BRANCH ARE TWO TEAMS', async () => {
    // The defect ADR-040 exists to close, stated directly. manager.ac holds
    // branch A — the same branch manager.a's whole team works in — and manages
    // none of them. Under outlet scope they read every one of these rows.
    await asUser(db, USERS.managerAC, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA1)).toBe(false)
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA2)).toBe(false)
      expect(await canSee(tx, 'accounts', ACCOUNTS.cOwnedByA1)).toBe(false)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.aOwnedByA1)).toBe(false)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.cOwnedByA1)).toBe(false)
      expect(await canSee(tx, 'projects', PROJECTS.aOwnedByA1)).toBe(false)

      // Their own report's work, at a branch they do not even hold, they do see.
      expect(await canSee(tx, 'accounts', ACCOUNTS.bOwnedByB1)).toBe(true)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.bOwnedByB1)).toBe(true)
    })
  })

  it('a manager with NO outlets sees no business records at all', async () => {
    await asUser(db, USERS.managerNone, async (tx) => {
      expect(await visibleIds(tx, 'accounts')).toEqual([])
      expect(await visibleIds(tx, 'opportunities')).toEqual([])
      expect(await visibleIds(tx, 'projects')).toEqual([])
      expect(await visibleIds(tx, 'activities')).toEqual([])
    })
  })

  it("the OWNER's sales head decides scope, not the record's branch", async () => {
    // The same opportunity, asked of two sales heads. It sits at branch C, which
    // manager.ac holds and manager.a does not — and it belongs to manager.a,
    // because sales.a1 does.
    await asUser(db, USERS.managerA, async (tx) => {
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.cOwnedByA1)).toBe(true)
    })
    await asUser(db, USERS.managerAC, async (tx) => {
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.cOwnedByA1)).toBe(false)
    })
  })

  it('moving a person to another sales head moves their work with them', async () => {
    await asUser(db, USERS.managerAC, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA1)).toBe(false)
    })

    await asUser(db, null, async (tx) => {
      // Arrange as the database owner: reassigning a person's reporting line is
      // an administrative write by the OWNER or ADMIN, not the thing under test.
      await tx.query('reset role')
      await tx.query(`update public.users set manager_id = $2 where id = $1`, [
        USERS.salesA1,
        USERS.managerAC,
      ])
      await tx.query('set local role authenticated')
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: USERS.managerAC, role: 'authenticated' }),
      ])

      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA1)).toBe(true)
      // sales.a2 did not move, so their work did not either.
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA2)).toBe(false)
    })
  })

  it('a sales head cannot move a person onto their own team', async () => {
    // The reporting line is the read boundary, so being able to edit it would be
    // the whole authorization model in one UPDATE. Refused by the USING clause
    // of `users_admin_update`, which means zero rows rather than an error — the
    // quiet half of "refused" that a rejects-only assertion would miss.
    await asUser(db, USERS.managerAC, async (tx) => {
      expect(
        await updateRowCount(tx, `update public.users set manager_id = $2 where id = $1`, [
          USERS.salesA1,
          USERS.managerAC,
        ]),
      ).toBe(0)
    })

    await asUser(db, USERS.managerAC, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA1)).toBe(false)
    })
  })
})

describe('salesperson ownership and work context', () => {
  it("a salesperson cannot see another salesperson's unrelated records", async () => {
    await asUser(db, USERS.salesA2, async (tx) => {
      // salesA2 owns account 3002 and opportunity 5002 only.
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA1)).toBe(false)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.aOwnedByA1)).toBe(false)
      expect(await canSee(tx, 'projects', PROJECTS.aOwnedByA1)).toBe(false)
    })
  })

  it('a salesperson in outlet A cannot see outlet B records', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.bOwnedByB1)).toBe(false)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.bOwnedByB1)).toBe(false)
    })
  })

  it('a salesperson reads an account they do not own when they own an opportunity on it', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      // Account and project belong to salesA2; opportunity 5004 belongs to salesA1.
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA2)).toBe(true)
      expect(await canSee(tx, 'projects', PROJECTS.aOwnedByA2)).toBe(true)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.workContext)).toBe(true)
    })
  })

  it('work context does NOT extend to the other salesperson’s own opportunity on that account', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.aOwnedByA2)).toBe(false)
    })
  })

  it('a salesperson cannot reassign an opportunity to somebody else', async () => {
    // The row is visible to them, so the USING clause passes and the refusal
    // comes from WITH CHECK: after the change the row would no longer satisfy
    // `owner_id = current_user_id()`. That is §15.5's "any field except owner_id",
    // enforced without a trigger.
    await asUser(db, USERS.salesA1, async (tx) => {
      await expect(
        tx.query('update public.opportunities set owner_id = $1 where id = $2', [
          USERS.salesA2,
          OPPORTUNITIES.aOwnedByA1,
        ]),
      ).rejects.toMatchObject({ code: '42501' })
    })

    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query('select owner_id from public.opportunities where id = $1', [
        OPPORTUNITIES.aOwnedByA1,
      ])
      expect(rows[0].owner_id).toBe(USERS.salesA1)
    })
  })

  it('a salesperson cannot leave an opportunity unassigned to hide it', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await expect(
        tx.query('update public.opportunities set owner_id = null where id = $1', [
          OPPORTUNITIES.aOwnedByA1,
        ]),
      ).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('a salesperson cannot move their record into another outlet', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await expect(
        tx.query('update public.accounts set outlet_id = $1 where id = $2', [
          OUTLETS.b,
          ACCOUNTS.aOwnedByA1,
        ]),
      ).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('a salesperson cannot archive their own record', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await expect(
        tx.query('update public.accounts set archived_at = now() where id = $1', [
          ACCOUNTS.aOwnedByA1,
        ]),
      ).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('a salesperson cannot promote themselves', async () => {
    // `users_update_self` lets them edit their own row, and its WITH CHECK pins
    // `role` to the role they already hold — so the escalation is refused while
    // an ordinary profile edit still works.
    await asUser(db, USERS.salesA1, async (tx) => {
      // Two independent controls refuse this now, and the hierarchy guard
      // happens to answer first — a BEFORE trigger runs ahead of the policy's
      // WITH CHECK. Either way the role does not move.
      await expect(
        tx.query(`update public.users set role = 'OWNER' where id = $1`, [USERS.salesA1]),
      ).rejects.toMatchObject({ code: expect.stringMatching(/42501|23514/) })
    })

    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query('select role from public.users where id = $1', [USERS.salesA1])
      expect(rows[0].role).toBe('SALESPERSON')
    })
  })

  it('and RLS refuses it on its own, with the hierarchy guard out of the way', async () => {
    // The point of the previous test is that the role does not move. The point of
    // this one is WHICH control stops it: with a legal reporting line for the
    // role being attempted, `users_update_self`'s WITH CHECK is the only thing
    // left, and it must still refuse. Without this, deleting that clause would
    // leave the suite green.
    await asUser(db, null, async (tx) => {
      await tx.query('reset role')
      await tx.query(`update public.users set manager_id = null where id = $1`, [USERS.salesA1])
      await tx.query('set local role authenticated')
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: USERS.salesA1, role: 'authenticated' }),
      ])

      await expect(
        tx.query(`update public.users set role = 'MANAGER' where id = $1`, [USERS.salesA1]),
      ).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('a salesperson can still edit their own name and phone', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const affected = await updateRowCount(
        tx,
        `update public.users set full_name = 'Renamed By Self' where id = $1`,
        [USERS.salesA1],
      )
      expect(affected).toBe(1)
    })
  })

  it('a salesperson cannot reactivate a deactivated colleague, or themselves', async () => {
    await asUser(db, USERS.deactivated, async (tx) => {
      const affected = await updateRowCount(
        tx,
        'update public.users set is_active = true where id = $1',
        [USERS.deactivated],
      ).catch(() => 0)
      expect(affected).toBe(0)
    })
  })
})

describe('owner and admin', () => {
  it('the owner sees every outlet, without any outlet assignment', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      const { rows } = await tx.query(
        'select count(*)::int as n from public.user_outlets where user_id = $1',
        [USERS.owner],
      )
      expect(rows[0].n).toBe(0)

      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA1)).toBe(true)
      expect(await canSee(tx, 'accounts', ACCOUNTS.bOwnedByB1)).toBe(true)
      expect(await canSee(tx, 'accounts', ACCOUNTS.cOwnedByA1)).toBe(true)
      expect((await visibleIds(tx, 'opportunities')).length).toBe(5)
    })
  })

  it('an admin READS every operational record (ADR-040, superseding ADR-017)', async () => {
    // The administrator is the escalation point above the sales heads. It cannot
    // be that while unable to see their work — which is what ADR-017 required.
    await asUser(db, USERS.admin, async (tx) => {
      expect((await visibleIds(tx, 'accounts')).length).toBeGreaterThan(0)
      expect((await visibleIds(tx, 'opportunities')).length).toBeGreaterThan(0)
      expect((await visibleIds(tx, 'projects')).length).toBeGreaterThan(0)
      expect((await visibleIds(tx, 'contacts')).length).toBeGreaterThan(0)
      expect((await visibleIds(tx, 'activities')).length).toBeGreaterThan(0)
    })
  })

  it('an admin still WRITES no business data', async () => {
    // Read is the whole of what ADR-040 gave it. Creating, archiving and
    // reassigning stay on the sales hierarchy.
    await asUser(db, USERS.admin, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.accounts (name, account_type, phone, owner_id, outlet_id)
         values ('Admin Should Not Create', 'HOMEOWNER', '+91 90000 00001', $1, $2)`,
        [USERS.salesA1, OUTLETS.a],
      )
      expect(error.code).toBe('42501')

      expect(
        await updateRowCount(
          tx,
          `update public.opportunities set title = 'Admin edit' where id = $1`,
          [OPPORTUNITIES.aOwnedByA1],
        ),
      ).toBe(0)
    })
  })

  it('an admin still administers users, outlets and imports', async () => {
    await asUser(db, USERS.admin, async (tx) => {
      expect((await visibleIds(tx, 'users')).length).toBeGreaterThan(1)
      expect((await visibleIds(tx, 'outlets')).length).toBe(3)
      expect((await tx.query('select count(*)::int as n from public.system_settings')).rows[0].n)
        .toBeGreaterThan(0)
    })
  })

  it('an admin CANNOT change a global business rule (ADR-042)', async () => {
    // Found by the audit, reproduced exactly like this: an administrator could
    // move the high-value threshold, the taluk list, the stage probabilities and
    // every other §24 value with one PostgREST call. Those are the Project
    // Owner's, and configuring the system is not running the business.
    await asUser(db, USERS.admin, async (tx) => {
      expect(
        await updateRowCount(
          tx,
          `update public.system_settings set value = '31' where key = 'account_dormancy_days'`,
        ),
      ).toBe(0)
      expect(
        await updateRowCount(
          tx,
          `update public.system_settings set value = '99999999' where key = 'high_value_threshold_paise'`,
        ),
      ).toBe(0)
    })

    // Unchanged afterwards, read back outside the caller's transaction.
    await asUser(db, USERS.owner, async (tx) => {
      const { rows } = await tx.query(
        `select value::text as v from public.system_settings where key = 'high_value_threshold_paise'`,
      )
      expect(rows[0].v).toBe('30000000')
    })
  })

  it('the OWNER still changes every business rule', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      expect(
        await updateRowCount(
          tx,
          `update public.system_settings set value = '31' where key = 'account_dormancy_days'`,
        ),
      ).toBe(1)
    })
  })

  it('a salesperson cannot edit system settings', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const affected = await updateRowCount(
        tx,
        `update public.system_settings set value = '999' where key = 'account_dormancy_days'`,
      ).catch(() => 0)
      expect(affected).toBe(0)
    })
  })

  it('a manager cannot manage users or outlets', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const users = await updateRowCount(
        tx,
        `update public.users set role = 'MANAGER' where id = $1`,
        [USERS.salesA1],
      ).catch(() => 0)
      expect(users).toBe(0)

      const outlets = await updateRowCount(
        tx,
        `update public.outlets set name = 'Renamed' where id = $1`,
        [OUTLETS.a],
      ).catch(() => 0)
      expect(outlets).toBe(0)
    })
  })

  it('a manager sees only the users who share an outlet with them', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const ids = await visibleIds(tx, 'users')
      expect(ids).toContain(USERS.salesA1)
      expect(ids).toContain(USERS.salesA2)
      expect(ids).not.toContain(USERS.salesB1)
      expect(ids).not.toContain(USERS.owner)
    })
  })
})

describe('inactive users and anonymous callers', () => {
  it('a deactivated user with a valid token sees nothing', async () => {
    await asUser(db, USERS.deactivated, async (tx) => {
      expect(await visibleIds(tx, 'accounts')).toEqual([])
      expect(await visibleIds(tx, 'opportunities')).toEqual([])
      expect(await visibleIds(tx, 'users')).toEqual([])
      expect(await visibleIds(tx, 'outlets')).toEqual([])
    })
  })

  it('an anonymous caller reaches nothing', async () => {
    await asUser(db, null, async (tx) => {
      await expect(tx.query('select id from public.accounts')).rejects.toMatchObject({
        code: '42501',
      })
    })
  })
})
