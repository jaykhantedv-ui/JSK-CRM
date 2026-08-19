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
  updateRowCount,
  visibleIds,
  type Db,
} from './harness'

/**
 * Outlet scope and the role model, at the database boundary (ADR-016, ADR-017).
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

describe('manager outlet scope', () => {
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

  it('a manager assigned to outlet A CANNOT see outlet C records either', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.cOwnedByA1)).toBe(false)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.cOwnedByA1)).toBe(false)
    })
  })

  it('a manager assigned to A and C sees both, and still not B', async () => {
    await asUser(db, USERS.managerAC, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA1)).toBe(true)
      expect(await canSee(tx, 'accounts', ACCOUNTS.cOwnedByA1)).toBe(true)
      expect(await canSee(tx, 'accounts', ACCOUNTS.bOwnedByB1)).toBe(false)

      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.cOwnedByA1)).toBe(true)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.bOwnedByB1)).toBe(false)
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

  it("a record's outlet decides scope, not the owner's posting", async () => {
    // salesA1 is posted to outlet A but owns an opportunity in outlet C. The
    // outlet-C manager must see it; the outlet-A manager must not.
    await asUser(db, USERS.managerA, async (tx) => {
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.cOwnedByA1)).toBe(false)
    })
    await asUser(db, USERS.managerAC, async (tx) => {
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.cOwnedByA1)).toBe(true)
    })
  })

  it('revoking an outlet assignment removes the manager from that scope', async () => {
    await asUser(db, USERS.managerAC, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.cOwnedByA1)).toBe(true)
    })

    await asUser(db, null, async (tx) => {
      // Arrange as the database owner: this models the OWNER/ADMIN moving a
      // manager between outlets, which is an administrative write, not the thing
      // under test.
      await tx.query('reset role')
      await tx.query(
        `update public.user_outlets set revoked_at = now()
         where user_id = $1 and outlet_id = $2 and revoked_at is null`,
        [USERS.managerAC, OUTLETS.c],
      )
      await tx.query('set local role authenticated')
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: USERS.managerAC, role: 'authenticated' }),
      ])

      expect(await canSee(tx, 'accounts', ACCOUNTS.cOwnedByA1)).toBe(false)
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA1)).toBe(true)
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
      await expect(
        tx.query(`update public.users set role = 'OWNER' where id = $1`, [USERS.salesA1]),
      ).rejects.toMatchObject({ code: '42501' })
    })

    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query('select role from public.users where id = $1', [USERS.salesA1])
      expect(rows[0].role).toBe('SALESPERSON')
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

  it('an admin gets NO automatic business-data visibility', async () => {
    await asUser(db, USERS.admin, async (tx) => {
      expect(await visibleIds(tx, 'accounts')).toEqual([])
      expect(await visibleIds(tx, 'opportunities')).toEqual([])
      expect(await visibleIds(tx, 'projects')).toEqual([])
      expect(await visibleIds(tx, 'contacts')).toEqual([])
      expect(await visibleIds(tx, 'activities')).toEqual([])
      expect(await visibleIds(tx, 'opportunity_events')).toEqual([])
    })
  })

  it('an admin still administers users, outlets, settings and imports', async () => {
    await asUser(db, USERS.admin, async (tx) => {
      expect((await visibleIds(tx, 'users')).length).toBeGreaterThan(1)
      expect((await visibleIds(tx, 'outlets')).length).toBe(3)

      const settings = await tx.query('select count(*)::int as n from public.system_settings')
      expect(settings.rows[0].n).toBeGreaterThan(0)

      const affected = await updateRowCount(
        tx,
        `update public.system_settings set value = '31' where key = 'account_dormancy_days'`,
      )
      expect(affected).toBe(1)
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
