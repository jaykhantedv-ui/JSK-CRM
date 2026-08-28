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
 * The authorization surface, role by role (ADR-042).
 *
 * **Every assertion attacks the database directly, as the restricted role**, with
 * the JWT claims PostgREST would set. Nothing here goes through a screen, a
 * navigation item or a Server Action — those are conveniences, and §15 is
 * explicit that neither a hidden button nor a route guard is the control. If a
 * rule below holds here it holds against `curl`.
 *
 * The four roles, as the business states them (ADR-040, ADR-042):
 *
 *   SALESPERSON  their own work
 *   SALES HEAD   their own and their direct reports'
 *   ADMIN        reads everything operational, runs the business, configures nothing
 *   OWNER        everything, including the system
 */

let db: Db

beforeAll(async () => {
  db = await connect()
})
afterAll(async () => {
  await db.end()
})

const BUSINESS_TABLES = ['accounts', 'opportunities', 'projects', 'contacts', 'activities'] as const

const MANAGEMENT_RPCS = [
  `select * from public.management_period_summary(now() - interval '30 days', now())`,
  `select * from public.management_team_workload(now() - interval '30 days', now(), '{}'::jsonb)`,
  `select * from public.management_outlet_comparison(now() - interval '30 days', now())`,
  `select * from public.management_pipeline_by_stage('{}'::jsonb)`,
] as const

// ================================================== 6. ADMIN operates =====

describe('ADMIN can run the business', () => {
  it('reads every operational table', async () => {
    await asUser(db, USERS.admin, async (tx) => {
      for (const table of BUSINESS_TABLES) {
        const { rows } = await tx.query(`select count(*)::int as n from public.${table}`)
        expect({ table, empty: rows[0].n === 0 }).toEqual({ table, empty: false })
      }
    })
  })

  it('reaches every management report — the four that were erroring', async () => {
    // The reported symptom: the route admitted ADMIN, the service threw, and
    // Dashboard / Team / Reports answered a Server Components error. The database
    // gate is what the services now defer to, so this is the rule they inherit.
    await asUser(db, USERS.admin, async (tx) => {
      for (const sql of MANAGEMENT_RPCS) {
        await expect(tx.query(sql)).resolves.toBeDefined()
      }
    })
  })

  it('sees every branch, so branch comparison and the selectors work', async () => {
    await asUser(db, USERS.admin, async (tx) => {
      const { rows } = await tx.query('select public.scoped_outlet_ids() as id')
      expect(rows.length).toBe(3)
    })
  })

  it('sees every person, so People and the reporting structure load', async () => {
    await asUser(db, USERS.admin, async (tx) => {
      const ids = await visibleIds(tx, 'users')
      for (const person of [USERS.owner, USERS.managerA, USERS.salesA1, USERS.salesB1]) {
        expect(ids).toContain(person)
      }
    })
  })

  it('administers people, branches and imports', async () => {
    await asUser(db, USERS.admin, async (tx) => {
      expect(
        await updateRowCount(tx, `update public.users set phone = '9876500000' where id = $1`, [
          USERS.salesA1,
        ]),
      ).toBe(1)
      expect(
        await updateRowCount(tx, `update public.outlets set city = 'Erode' where id = $1`, [
          OUTLETS.a,
        ]),
      ).toBe(1)
      await expect(
        tx.query(
          `insert into public.import_batches (entity, file_name, uploaded_by)
           values ('accounts', 'audit.csv', $1)`,
          [USERS.admin],
        ),
      ).resolves.toBeDefined()
    })
  })
})

// ============================================ 7. ADMIN configures nothing =

describe('ADMIN cannot configure the system', () => {
  it('cannot change a global business rule', async () => {
    await asUser(db, USERS.admin, async (tx) => {
      for (const key of ['high_value_threshold_paise', 'cities', 'stage_probabilities']) {
        expect(
          await updateRowCount(tx, `update public.system_settings set value = '1' where key = $1`, [
            key,
          ]),
        ).toBe(0)
      }
    })
  })

  it('CANNOT MINT A SECOND OWNER — the escalation the audit found', async () => {
    // Reproduced before the fix, in one statement: `manager_id = null` in the
    // same UPDATE satisfied the hierarchy guard, and the role went through.
    await asUser(db, USERS.admin, async (tx) => {
      const error = await expectRejected(
        tx,
        `update public.users set role = 'OWNER', manager_id = null where id = $1`,
        [USERS.salesB1],
      )
      expect(error.code).toBe('42501')
      expect(error.message).toMatch(/only the owner can make somebody an owner/i)
    })
  })

  it('CANNOT DEACTIVATE THE OWNER — the other half of the takeover', async () => {
    // `current_user_id()` filters on `is_active`, so this locked the owner out of
    // every policy in the schema, with no way back short of the bootstrap script.
    await asUser(db, USERS.admin, async (tx) => {
      const error = await expectRejected(
        tx,
        `update public.users set is_active = false where id = $1`,
        [USERS.owner],
      )
      expect(error.code).toBe('42501')
      expect(error.message).toMatch(/only the owner can change the owner/i)
    })

    await asUser(db, USERS.owner, async (tx) => {
      const { rows } = await tx.query('select is_active from public.users where id = $1', [
        USERS.owner,
      ])
      expect(rows[0].is_active).toBe(true)
    })
  })

  it('cannot demote or even rename the owner', async () => {
    await asUser(db, USERS.admin, async (tx) => {
      const attempts: [string, unknown[]][] = [
        [`update public.users set role = 'SALESPERSON' where id = $1`, [USERS.owner]],
        [`update public.users set full_name = 'Renamed By Admin' where id = $1`, [USERS.owner]],
        [`update public.users set manager_id = $2 where id = $1`, [USERS.owner, USERS.admin]],
      ]
      for (const [sql, params] of attempts) {
        const error = await expectRejected(tx, sql, params)
        // The privilege guard is the one that must answer, and it fires first —
        // see the trigger names in migration 032. Before that, the hierarchy
        // guard replied "move their team first", which reads as an ordering
        // problem the administrator could solve.
        expect(error.code).toBe('42501')
        expect(error.message).toMatch(/only the owner/i)
      }
    })
  })

  it('writes no business data — it reads, it does not operate the records', async () => {
    await asUser(db, USERS.admin, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.accounts (name, account_type, phone, owner_id, outlet_id)
         values ('Admin Should Not Create', 'HOMEOWNER', '+91 90000 00009', $1, $2)`,
        [USERS.salesA1, OUTLETS.a],
      )
      expect(error.code).toBe('42501')

      expect(
        await updateRowCount(tx, `update public.opportunities set title = 'x' where id = $1`, [
          OPPORTUNITIES.aOwnedByA1,
        ]),
      ).toBe(0)
    })
  })
})

// ==================================================== 8. OWNER is total ===

describe('OWNER keeps everything', () => {
  it('reads every record and every report', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      for (const table of BUSINESS_TABLES) {
        const { rows } = await tx.query(`select count(*)::int as n from public.${table}`)
        expect(rows[0].n).toBeGreaterThan(0)
      }
      for (const sql of MANAGEMENT_RPCS) {
        await expect(tx.query(sql)).resolves.toBeDefined()
      }
    })
  })

  it('configures the system, and administers the owner', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      expect(
        await updateRowCount(
          tx,
          `update public.system_settings set value = '45' where key = 'account_dormancy_days'`,
        ),
      ).toBe(1)
      expect(
        await updateRowCount(tx, `update public.users set full_name = 'Renamed' where id = $1`, [
          USERS.owner,
        ]),
      ).toBe(1)
    })
  })

  it('is the only role that can appoint an owner', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      expect(
        await updateRowCount(
          tx,
          `update public.users set role = 'OWNER', manager_id = null where id = $1`,
          [USERS.salesB1],
        ),
      ).toBe(1)
    })
  })
})

// ============================================== 1-3. SALESPERSON =========

describe('SALESPERSON has their own workspace and nothing else', () => {
  it('sees no colleague’s records', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.bOwnedByB1)).toBe(false)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.bOwnedByB1)).toBe(false)
      expect(await canSee(tx, 'projects', PROJECTS.bOwnedByB1)).toBe(false)
    })
  })

  it('is refused every company report at the database boundary', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      for (const sql of MANAGEMENT_RPCS) {
        const error = await expectRejected(tx, sql)
        expect(error.code).toBe('42501')
      }
    })
  })

  it('cannot administer people, branches, settings or imports', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      expect(
        await updateRowCount(tx, `update public.users set role = 'MANAGER' where id = $1`, [
          USERS.salesA2,
        ]),
      ).toBe(0)
      expect(
        await updateRowCount(tx, `update public.outlets set name = 'Renamed' where id = $1`, [
          OUTLETS.a,
        ]),
      ).toBe(0)
      expect(
        await updateRowCount(
          tx,
          `update public.system_settings set value = '1' where key = 'account_dormancy_days'`,
        ),
      ).toBe(0)
      expect(await visibleIds(tx, 'import_batches')).toEqual([])
    })
  })

  it('has no branch scope, so no selector or report can widen through one', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query('select public.scoped_outlet_ids() as id')
      expect(rows).toEqual([])
    })
  })
})

// ============================================ 4-5, 17. SALES HEAD ========

describe('SALES HEAD sees their team and no other', () => {
  it('sees their direct reports’ work and not another team’s', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.aOwnedByA1)).toBe(true)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.bOwnedByB1)).toBe(false)
    })
    await asUser(db, USERS.managerAC, async (tx) => {
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.bOwnedByB1)).toBe(true)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.aOwnedByA1)).toBe(false)
    })
  })

  it('cannot move somebody onto their own team to acquire their work', async () => {
    await asUser(db, USERS.managerAC, async (tx) => {
      expect(
        await updateRowCount(tx, `update public.users set manager_id = $2 where id = $1`, [
          USERS.salesA1,
          USERS.managerAC,
        ]),
      ).toBe(0)
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA1)).toBe(false)
    })
  })

  it('cannot administer the organisation, settings or imports', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      expect(
        await updateRowCount(tx, `update public.outlets set name = 'Renamed' where id = $1`, [
          OUTLETS.a,
        ]),
      ).toBe(0)
      expect(
        await updateRowCount(
          tx,
          `update public.system_settings set value = '1' where key = 'account_dormancy_days'`,
        ),
      ).toBe(0)
      expect(await visibleIds(tx, 'import_batches')).toEqual([])
    })
  })

  it('cannot appoint an owner either', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      expect(
        await updateRowCount(
          tx,
          `update public.users set role = 'OWNER', manager_id = null where id = $1`,
          [USERS.salesA1],
        ),
      ).toBe(0)
    })
  })
})

// ============================ 11-13. search, reports and export privacy ==

describe('search, reports and export carry no more than the caller may read', () => {
  it('search returns only records the caller can open', async () => {
    // `search_crm()` is SECURITY INVOKER, so the row filter is each table's own
    // policy rather than a copy of it. This is that claim, measured.
    // SEQUENTIALLY, on purpose. `asUser` wraps one shared connection in a
    // transaction and sets the JWT claims on it; running two concurrently
    // interleaves them and one caller's identity leaks into the other's query.
    // Written as a Promise.all first, this test reported four rows for a
    // salesperson who can see none.
    const asSales = await asUser(db, USERS.salesB1, async (tx) => {
      const { rows } = await tx.query(`select id from public.search_crm('Ravi', 200)`)
      return rows.map((r: { id: string }) => r.id)
    })
    const asOwner = await asUser(db, USERS.owner, async (tx) => {
      const { rows } = await tx.query(`select id from public.search_crm('Ravi', 200)`)
      return rows.map((r: { id: string }) => r.id)
    })

    // "Ravi Kumar" is sales.a1's customer. The owner finds them; sales.b1, who
    // owns nothing of theirs, finds nothing — the search index is shared and the
    // policy is what filters it.
    expect(asOwner).toContain(ACCOUNTS.aOwnedByA1)
    expect(asSales).toEqual([])
  })

  it('a report narrowed to another team returns nothing, not that team', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const { rows } = await tx.query(
        `select won_count from public.management_period_summary(
           now() - interval '365 days', now(), $1)`,
        [OUTLETS.b],
      )
      expect(Number(rows[0].won_count)).toBe(0)
    })
  })

  it('the rows an export would carry are the rows the caller can already read', async () => {
    // `buildExport` reads through the caller's own session, so the CSV is bounded
    // by exactly this. There is no separate export query to get wrong.
    const asManager = await asUser(db, USERS.managerA, async (tx) =>
      visibleIds(tx, 'opportunities'),
    )
    expect(asManager).not.toContain(OPPORTUNITIES.bOwnedByB1)
  })
})

// ================================= 15-16. inactive users, immediate effect =

describe('deactivation and scope changes take effect at once', () => {
  it('a deactivated user reads nothing, token or no token', async () => {
    await asUser(db, USERS.deactivated, async (tx) => {
      const { rows } = await tx.query('select public.current_user_id() as id')
      expect(rows[0].id).toBeNull()

      for (const table of BUSINESS_TABLES) {
        expect(await visibleIds(tx, table)).toEqual([])
      }
    })
  })

  it('deactivating somebody closes their access in the same transaction', async () => {
    await asUser(db, null, async (tx) => {
      await tx.query('reset role')
      await tx.query('update public.users set is_active = false where id = $1', [USERS.salesA1])
      await tx.query('set local role authenticated')
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: USERS.salesA1, role: 'authenticated' }),
      ])

      // No grace period, no cached role: the policies read `is_active` every time.
      expect(await visibleIds(tx, 'accounts')).toEqual([])
    })
  })

  it('moving a person to another sales head moves their work in the same breath', async () => {
    await asUser(db, null, async (tx) => {
      await tx.query('reset role')
      await tx.query('update public.users set manager_id = $2 where id = $1', [
        USERS.salesA1,
        USERS.managerAC,
      ])
      await tx.query('set local role authenticated')
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: USERS.managerAC, role: 'authenticated' }),
      ])
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA1)).toBe(true)
    })
  })
})

// ============================================= 18. nothing over-exposed ===

describe('the schema exposes no more than the rules allow', () => {
  it('has exactly one DELETE policy, on the one approved table', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      const { rows } = await tx.query(
        `select c.relname from pg_policy p
           join pg_class c on c.oid = p.polrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and p.polcmd = 'd'`,
      )
      expect(rows.map((r: { relname: string }) => r.relname)).toEqual(['project_stakeholders'])
    })
  })

  it('has row-level security on every table in public', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      const { rows } = await tx.query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
      )
      expect(rows).toEqual([])
    })
  })

  it('grants anon nothing at all', async () => {
    // One transaction per probe: a refused statement aborts its transaction, and
    // the next would fail with 25P02 rather than the permission error under test.
    for (const table of ['accounts', 'users', 'opportunities', 'system_settings']) {
      await asUser(db, null, async (tx) => {
        await expect(tx.query(`select count(*) from public.${table}`)).rejects.toThrow(
          /permission denied/i,
        )
      })
    }
  })

  it('keeps every view SECURITY INVOKER, so none of them bypasses a policy', async () => {
    // A view without it runs as its owner and silently returns every row (§25).
    await asUser(db, USERS.owner, async (tx) => {
      const { rows } = await tx.query(
        `select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'v'
            and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=true%'`,
      )
      expect(rows).toEqual([])
    })
  })
})
