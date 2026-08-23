import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ACCOUNTS, ACTIVITIES, OPPORTUNITIES, PROJECTS, USERS,
  asUser, canSee, connect, expectRejected, updateRowCount, type Db,
} from './harness'

/**
 * Permission tests for the Core CRM surfaces (§19.2, §19.4).
 *
 * **Every one of these attacks the database, not the UI.** A hidden button is not
 * a control (§15). Each is written as the *restricted* role — asserting a
 * permission as OWNER proves nothing, because OWNER passes everything (§23).
 */
let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db.end()
})

// ------------------------------------------------------------ outlet scope --

describe('outlet scope (ADR-016)', () => {
  it('a salesperson cannot see another outlet’s customer', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.bOwnedByB1)).toBe(false)
    })
  })

  it('a salesperson cannot see another salesperson’s opportunity in their own outlet', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      // Same outlet, different owner, and no opportunity of A1's attached.
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.aOwnedByA2)).toBe(false)
    })
  })

  it('a salesperson CAN read an account they do not own when they own an opportunity on it (§3.2)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      expect(await canSee(tx, 'accounts', ACCOUNTS.aOwnedByA2)).toBe(true)
      expect(await canSee(tx, 'projects', PROJECTS.aOwnedByA2)).toBe(true)
    })
  })

  it('work context grants READ, not WRITE', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const changed = await updateRowCount(
        tx,
        "update public.accounts set notes = 'edited by a non-owner' where id = $1",
        [ACCOUNTS.aOwnedByA2],
      )
      expect(changed).toBe(0)
    })
  })

  it('a manager sees their own outlet', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.aOwnedByA1)).toBe(true)
    })
  })

  it('a manager CANNOT see an outlet they do not manage', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      // Manager A holds outlet A only. Outlet B is somebody else's.
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.bOwnedByB1)).toBe(false)
      expect(await canSee(tx, 'accounts', ACCOUNTS.bOwnedByB1)).toBe(false)
      expect(await canSee(tx, 'projects', PROJECTS.bOwnedByB1)).toBe(false)
    })
  })

  it('a sales head sees their team and no other, whatever branch they hold', async () => {
    // manager.ac holds branches A and C and manages only sales.b1, who works at
    // branch B. Holding a branch is not a read grant (ADR-040).
    await asUser(db, USERS.managerAC, async (tx) => {
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.aOwnedByA1)).toBe(false)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.cOwnedByA1)).toBe(false)
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.bOwnedByB1)).toBe(true)
    })
  })

  it('a sales head with no team sees only their own records', async () => {
    await asUser(db, USERS.managerNone, async (tx) => {
      const { rows } = await tx.query('select count(*)::int as n from public.opportunities')
      expect(rows[0].n).toBe(0)
    })
  })

  it('an OWNER sees every outlet, by role rather than by membership', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      for (const id of [OPPORTUNITIES.aOwnedByA1, OPPORTUNITIES.bOwnedByB1, OPPORTUNITIES.cOwnedByA1]) {
        expect(await canSee(tx, 'opportunities', id)).toBe(true)
      }
    })
  })

  it('ADMIN reads every operational table (ADR-040, superseding ADR-017)', async () => {
    await asUser(db, USERS.admin, async (tx) => {
      for (const table of ['accounts', 'opportunities', 'projects', 'contacts', 'activities']) {
        const { rows } = await tx.query(`select count(*)::int as n from public.${table}`)
        expect({ table, empty: rows[0].n === 0 }).toEqual({ table, empty: false })
      }
    })
  })

  it('record scope follows the OWNER’s sales head, not the record’s branch', async () => {
    // The opportunity in branch C is owned by a salesperson who reports to
    // manager.a. manager.a sees it; manager.ac, who holds branch C and manages
    // nobody in it, does not (ADR-040).
    await asUser(db, USERS.managerA, async (tx) => {
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.cOwnedByA1)).toBe(true)
    })
    await asUser(db, USERS.managerAC, async (tx) => {
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.cOwnedByA1)).toBe(false)
    })
  })
})

// ------------------------------------------------------------- assignment --

describe('assignment and reassignment (§11.9)', () => {
  it('a salesperson cannot reassign their own opportunity away', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      // After the change the row no longer satisfies `owner_id = current_user_id()`,
      // so the WITH CHECK refuses it.
      const error = await expectRejected(
        tx,
        'update public.opportunities set owner_id = $1 where id = $2',
        [USERS.salesA2, OPPORTUNITIES.aOwnedByA1],
      )
      expect(error.code).toBe('42501')
    })
  })

  it('a salesperson calling the reassign RPC directly is refused', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(
        tx,
        'select public.reassign_opportunity($1,$2,$3)',
        [OPPORTUNITIES.aOwnedByA1, USERS.salesA2, 'trying it on'],
      )
      expect(error.code).toBe('42501')
    })
  })

  it('a manager may reassign inside their outlet, and the reason reaches the audit row', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const { rows } = await tx.query('select owner_id from public.reassign_opportunity($1,$2,$3)', [
        OPPORTUNITIES.aOwnedByA1,
        USERS.salesA2,
        'A1 is on leave',
      ])
      expect(rows[0].owner_id).toBe(USERS.salesA2)

      const event = await tx.query(
        `select event_type, from_owner_id, to_owner_id, reason from public.opportunity_events
          where opportunity_id = $1 order by created_at desc limit 1`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      expect(event.rows[0]).toMatchObject({
        event_type: 'OWNER_CHANGED',
        from_owner_id: USERS.salesA1,
        to_owner_id: USERS.salesA2,
        reason: 'A1 is on leave',
      })
    })
  })

  it('reassignment never rewrites who logged the activity (§8.1)', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const before = await tx.query('select performed_by from public.activities where id = $1', [
        ACTIVITIES.onAOwnedByA1,
      ])
      await tx.query('select public.reassign_opportunity($1,$2,$3)', [
        OPPORTUNITIES.aOwnedByA1,
        USERS.salesA2,
        'handover',
      ])
      const after = await tx.query('select performed_by from public.activities where id = $1', [
        ACTIVITIES.onAOwnedByA1,
      ])
      expect(after.rows[0].performed_by).toBe(before.rows[0].performed_by)
      expect(after.rows[0].performed_by).toBe(USERS.salesA1)
    })
  })

  it('reassignment requires a reason', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const error = await expectRejected(tx, 'select public.reassign_opportunity($1,$2,$3)', [
        OPPORTUNITIES.aOwnedByA1,
        USERS.salesA2,
        '   ',
      ])
      expect(error.code).toBe('23514')
    })
  })

  it('the previous owner loses access after a reassignment (§19.3 scenario 9)', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      await tx.query('select public.reassign_opportunity($1,$2,$3)', [
        OPPORTUNITIES.aOwnedByA1,
        USERS.salesA2,
        'moved to a colleague on the same team',
      ])

      // Same transaction, now reading as the previous owner.
      await tx.query('select set_config($1,$2,true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: USERS.salesA1, role: 'authenticated' }),
      ])
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.aOwnedByA1)).toBe(false)
    })
  })

  it('a sales head cannot hand work to another sales head’s salesperson', async () => {
    // The new owner has to be readable to the caller too, or the WITH CHECK
    // fails: a sales head may move work around their own team and no further.
    // Handing a deal across teams is the administrator's or the owner's call.
    await asUser(db, USERS.managerA, async (tx) => {
      const error = await expectRejected(tx, 'select public.reassign_opportunity($1,$2,$3)', [
        OPPORTUNITIES.aOwnedByA1,
        USERS.salesB1,
        'attempting to cross teams',
      ])
      expect(error.code).toBe('42501')
    })

    await asUser(db, USERS.salesA1, async (tx) => {
      expect(await canSee(tx, 'opportunities', OPPORTUNITIES.aOwnedByA1)).toBe(true)
    })
  })

  it('bulk reassign moves only active work and returns the count', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      await tx.query(
        `select public.change_opportunity_stage($1,'lost',null,null,null,null,null,null,'NO_RESPONSE')`,
        [OPPORTUNITIES.aOwnedByA1],
      )
      const { rows } = await tx.query('select public.bulk_reassign($1,$2,$3) as moved', [
        USERS.salesA1,
        USERS.salesA2,
        'A1 has left',
      ])
      // The closed one stays put: reassigning a closed deal rewrites history for
      // no operational gain.
      const stillLost = await tx.query('select owner_id from public.opportunities where id = $1', [
        OPPORTUNITIES.aOwnedByA1,
      ])
      expect(stillLost.rows[0].owner_id).toBe(USERS.salesA1)
      expect(Number(rows[0].moved)).toBeGreaterThanOrEqual(1)
    })
  })

  it('a salesperson calling bulk_reassign moves nothing', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query('select public.bulk_reassign($1,$2,$3) as moved', [
        USERS.salesA2,
        USERS.salesA1,
        'trying to take work',
      ])
      expect(Number(rows[0].moved)).toBe(0)
    })
  })
})

// ---------------------------------------------------------------- search --

describe('global search is permission-scoped (§11.10, §25)', () => {
  it('never returns a record the caller cannot open', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(`select entity, id from public.search_crm('Bhavani')`)
      const ids = rows.map((row: { id: string }) => row.id)
      expect(ids).not.toContain(ACCOUNTS.bOwnedByB1)
      expect(ids).not.toContain(PROJECTS.bOwnedByB1)
      expect(ids).not.toContain(OPPORTUNITIES.bOwnedByB1)
    })
  })

  it('an OWNER searching the same term does find it — so the term itself was fine', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      const { rows } = await tx.query(`select id from public.search_crm('Bhavani')`)
      expect(rows.map((row: { id: string }) => row.id)).toContain(ACCOUNTS.bOwnedByB1)
    })
  })

  it('finds a customer by the last digits of their phone', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(`select entity, id, rank from public.search_crm('11111')`)
      expect(rows[0].id).toBe(ACCOUNTS.aOwnedByA1)
      // §11.10 — phone is rank 1, ahead of every name match.
      expect(rows[0].rank).toBe(1)
    })
  })

  it('returns nothing below three characters', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(`select * from public.search_crm('Ra')`)
      expect(rows).toHaveLength(0)
    })
  })

  it('treats SQL injection attempts as literal text (§19.4)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      for (const attack of [
        "'; drop table public.accounts; --",
        "' or 1=1 --",
        "\\'; delete from public.opportunities where '1'='1",
        "1) union select null,null,null,null,null,null --",
      ]) {
        const { rows } = await tx.query('select * from public.search_crm($1)', [attack])
        expect(Array.isArray(rows)).toBe(true)
      }
      // The tables are all still there.
      const { rows } = await tx.query('select count(*)::int as n from public.accounts')
      expect(rows[0].n).toBeGreaterThan(0)
    })
  })

  it('treats a wildcard as a literal character, not a pattern', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      // If `%` reached the ilike pattern unescaped this would match everything.
      const { rows } = await tx.query(`select * from public.search_crm('%%%')`)
      expect(rows).toHaveLength(0)
    })
  })

  it('excludes archived records', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      await tx.query('update public.accounts set archived_at = now() where id = $1', [ACCOUNTS.aOwnedByA1])
      const { rows } = await tx.query(`select id from public.search_crm('Ravi Kumar')`)
      expect(rows.map((row: { id: string }) => row.id)).not.toContain(ACCOUNTS.aOwnedByA1)
    })
  })
})

// ------------------------------------------------------------ duplicates --

describe('duplicate detection is advisory and scoped (§8.9)', () => {
  it('flags an exact phone match', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(
        `select name, signal from public.find_account_duplicates(0.6, 0.8, '+91 98430 11111')`,
      )
      expect(rows[0]).toMatchObject({ name: 'Ravi Kumar', signal: 'PHONE' })
    })
  })

  it('flags a similar name in the same city as POSSIBLE, not EXACT', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(
        `select signal from public.find_account_duplicates(0.6, 0.8, null, null, 'Ravi Kuma', 'Erode')`,
      )
      expect(rows[0].signal).toBe('NAME_CITY')
    })
  })

  it('does not flag a similar name without a city below the stricter threshold', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(
        `select signal from public.find_account_duplicates(0.6, 0.8, null, null, 'Ravi Kuma', null)`,
      )
      // 0.75 similarity clears the with-city bar of 0.6 but not the 0.8 required
      // when there is no city to corroborate it (§8.9).
      expect(rows).toHaveLength(0)
    })
  })

  it('never surfaces a duplicate the caller has no right to see', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(
        `select id from public.find_account_duplicates(0.6, 0.8, '9843033333')`,
      )
      // That number belongs to outlet B's customer.
      expect(rows).toHaveLength(0)
    })
  })

  it('excludes the record being edited', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(
        `select id from public.find_account_duplicates(0.6, 0.8, '9843011111', null, null, null, $1)`,
        [ACCOUNTS.aOwnedByA1],
      )
      expect(rows).toHaveLength(0)
    })
  })
})

// ----------------------------------------------------------- stakeholders --

describe('project stakeholders (§5.6, ADR-004)', () => {
  it('rejects a second primary person on the same site', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      await tx.query(
        `insert into public.project_stakeholders (project_id, contact_id, role, is_primary)
         values ($1,$2,'OWNER_BUYER',true)`,
        [PROJECTS.aOwnedByA1, '00000000-0000-4000-8000-000000006001'],
      )
      const error = await expectRejected(
        tx,
        `insert into public.project_stakeholders (project_id, account_id, role, is_primary)
         values ($1,$2,'ARCHITECT',true)`,
        [PROJECTS.aOwnedByA1, ACCOUNTS.aOwnedByA1],
      )
      expect(error.constraint).toBe('one_primary_per_project')
    })
  })

  it('rejects a link that points at nobody', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.project_stakeholders (project_id, role) values ($1,'MASON')`,
        [PROJECTS.aOwnedByA1],
      )
      expect(error.constraint).toBe('stakeholder_target')
    })
  })

  it('a salesperson cannot add somebody to a project outside their scope', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.project_stakeholders (project_id, account_id, role) values ($1,$2,'MASON')`,
        [PROJECTS.bOwnedByB1, ACCOUNTS.aOwnedByA1],
      )
      expect(error.code).toBe('42501')
    })
  })

  it('supports the multi-stakeholder case end to end (§4.4)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const people = [
        ['SPOUSE_FAMILY', 'DECISION_MAKER'],
        ['ARCHITECT', 'STRONG_INFLUENCER'],
        ['CONTRACTOR', 'INFLUENCER'],
        ['MASON', 'EXECUTOR'],
      ]
      for (const [role, influence] of people) {
        const contact = await tx.query(
          `insert into public.contacts (full_name, account_id, phone, role, influence, owner_id)
           values ($1,$2,$3,$4,$5,$6) returning id`,
          [`${role} person`, ACCOUNTS.aOwnedByA1, '9800000001', role, influence, USERS.salesA1],
        )
        await tx.query(
          `insert into public.project_stakeholders (project_id, contact_id, role, influence)
           values ($1,$2,$3,$4)`,
          [PROJECTS.aOwnedByA1, contact.rows[0].id, role, influence],
        )
      }
      const { rows } = await tx.query(
        'select count(*)::int as n from public.project_stakeholders where project_id = $1',
        [PROJECTS.aOwnedByA1],
      )
      expect(rows[0].n).toBe(4)
    })
  })

  it('is still the ONLY table anybody may delete from (ADR-004)', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const inserted = await tx.query(
        `insert into public.project_stakeholders (project_id, contact_id, role)
         values ($1,$2,'MASON') returning id`,
        [PROJECTS.aOwnedByA1, '00000000-0000-4000-8000-000000006001'],
      )
      const removed = await updateRowCount(tx, 'delete from public.project_stakeholders where id = $1', [
        inserted.rows[0].id,
      ])
      expect(removed).toBe(1)

      // And nothing else.
      for (const table of ['accounts', 'contacts', 'projects', 'opportunities', 'activities']) {
        const error = await expectRejected(tx, `delete from public.${table} where id is not null`)
        expect({ table, code: error.code }).toEqual({ table, code: '42501' })
      }
    })
  })
})

// ------------------------------------------------------------- activities --

describe('activities (§8.10)', () => {
  it('a salesperson may log against an account they hold work context on', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const { rows } = await tx.query(
        `select * from public.log_activity($1,'CALL','Rang the site engineer.','FOLLOW_UP','POSITIVE',$2)`,
        [ACCOUNTS.aOwnedByA2, OPPORTUNITIES.workContext],
      )
      expect(rows[0].activity_id).toBeTruthy()
    })
  })

  it('a salesperson cannot log against an account in another outlet', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(
        tx,
        `select public.log_activity($1,'CALL','Should not be possible.','FOLLOW_UP','NEUTRAL')`,
        [ACCOUNTS.bOwnedByB1],
      )
      expect(error.code).toBe('42501')
    })
  })

  it('cannot be logged on somebody else’s behalf', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.activities (account_id, type, summary, performed_by)
         values ($1,'CALL','Pretending to be someone else.',$2)`,
        [ACCOUNTS.aOwnedByA1, USERS.salesA2],
      )
      expect(error.code).toBe('42501')
    })
  })

  it('is editable by the author for 24 hours and immutable after', async () => {
    await asUser(db, USERS.salesA1, async (tx) => {
      const fresh = await updateRowCount(
        tx,
        "update public.activities set summary = 'Corrected within the window.' where id = $1",
        [ACTIVITIES.onAOwnedByA1],
      )
      expect(fresh).toBe(1)

      // Age it past the window and try again.
      await tx.query('set local role postgres')
      await tx.query("update public.activities set created_at = now() - interval '25 hours' where id = $1", [
        ACTIVITIES.onAOwnedByA1,
      ])
      await tx.query('set local role authenticated')

      const stale = await updateRowCount(
        tx,
        "update public.activities set summary = 'Too late to change this.' where id = $1",
        [ACTIVITIES.onAOwnedByA1],
      )
      expect(stale).toBe(0)
    })
  })
})

// ---------------------------------------------------- audit trail is final --

describe('the audit trail cannot be rewritten (§9.2)', () => {
  it('nobody may update an opportunity event — not even the OWNER', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      const changed = await updateRowCount(
        tx,
        "update public.opportunity_events set reason = 'rewriting history'",
      )
      expect(changed).toBe(0)
    })
  })

  it('nobody may delete an opportunity event — not even the OWNER', async () => {
    await asUser(db, USERS.owner, async (tx) => {
      const error = await expectRejected(tx, 'delete from public.opportunity_events where id is not null')
      expect(error.code).toBe('42501')
    })
  })

  it('nobody may forge an event directly', async () => {
    await asUser(db, USERS.managerA, async (tx) => {
      const error = await expectRejected(
        tx,
        `insert into public.opportunity_events (opportunity_id, event_type, actor_id)
         values ($1,'WON',$2)`,
        [OPPORTUNITIES.aOwnedByA1, USERS.managerA],
      )
      expect(error.code).toBe('42501')
    })
  })
})
