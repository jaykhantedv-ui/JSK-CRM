import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ACCOUNTS, OUTLETS, USERS, becomeUser, connect, expectRejected, type Db } from './harness'

/**
 * Import execution, duplicate decisions and rollback (§20.4, §20.5, §20.6).
 *
 * These run against a real PostgreSQL server. The RPCs are exercised as the
 * service-role would call them (as the database owner, which bypasses RLS the
 * same way), and the permission rules are exercised as the RESTRICTED role —
 * never as OWNER, which passes everything (§23).
 */

let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db.end()
})

/** A batch in REVIEW with the given rows. Returns the batch id. */
async function makeBatch(
  entity: 'accounts' | 'contacts',
  rows: {
    normalized: Record<string, unknown>
    status?: string
    duplicate_of?: string | null
    decision?: string | null
    raw?: Record<string, string>
  }[],
): Promise<string> {
  const { rows: batch } = await db.query(
    `insert into public.import_batches (entity, file_name, status, total_rows, uploaded_by)
     values ($1, 'test.csv', 'REVIEW', $2, $3) returning id`,
    [entity, rows.length, USERS.owner],
  )
  const batchId = batch[0].id as string

  for (const [index, row] of rows.entries()) {
    await db.query(
      `insert into public.import_rows
         (batch_id, row_number, raw, normalized, status, duplicate_of, decision)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        batchId,
        index + 1,
        JSON.stringify(row.raw ?? {}),
        JSON.stringify(row.normalized),
        row.status ?? 'VALID',
        row.duplicate_of ?? null,
        row.decision ?? null,
      ],
    )
  }

  return batchId
}

const account = (overrides: Record<string, unknown> = {}) => ({
  name: 'Imported Customer',
  account_type: 'HOMEOWNER',
  phone: '9843090001',
  email: null,
  address: null,
  city: 'Erode',
  area: null,
  source: 'OTHER',
  notes: null,
  status: 'PROSPECT',
  owner_id: USERS.salesA1,
  outlet_id: OUTLETS.a,
  legacy_ref: 'REG-1',
  ...overrides,
})

describe('execute_import (§20.5)', () => {
  it('creates rows carrying is_imported, import_batch_id and legacy_ref', async () => {
    await db.query('begin')
    try {
      const batchId = await makeBatch('accounts', [{ normalized: account() }])
      const { rows } = await db.query('select * from public.execute_import($1)', [batchId])
      expect(rows[0]).toMatchObject({ imported: 1, skipped: 0, linked: 0 })

      const { rows: created } = await db.query(
        `select is_imported, import_batch_id, legacy_ref, name, owner_id, outlet_id, created_by
           from public.accounts where import_batch_id = $1`,
        [batchId],
      )
      expect(created).toHaveLength(1)
      expect(created[0]).toMatchObject({
        is_imported: true,
        import_batch_id: batchId,
        legacy_ref: 'REG-1',
        name: 'Imported Customer',
        owner_id: USERS.salesA1,
        outlet_id: OUTLETS.a,
      })
      // ADR-003: the import executor records the SYSTEM user as actor, not a person.
      expect(created[0].created_by).toBe('00000000-0000-4000-8000-000000000001')
    } finally {
      await db.query('rollback')
    }
  })

  it('marks the batch COMPLETED with a completion time', async () => {
    await db.query('begin')
    try {
      const batchId = await makeBatch('accounts', [{ normalized: account() }])
      await db.query('select * from public.execute_import($1)', [batchId])

      const { rows } = await db.query(
        'select status, imported_rows, completed_at from public.import_batches where id = $1',
        [batchId],
      )
      expect(rows[0].status).toBe('COMPLETED')
      expect(rows[0].imported_rows).toBe(1)
      expect(rows[0].completed_at).not.toBeNull()
    } finally {
      await db.query('rollback')
    }
  })

  it('BLOCKS execution when a duplicate row has no decision (§20.4)', async () => {
    await db.query('begin')
    try {
      const batchId = await makeBatch('accounts', [
        { normalized: account() },
        {
          normalized: account({ name: 'Dup', legacy_ref: 'REG-2' }),
          status: 'DUPLICATE_EXACT',
          duplicate_of: ACCOUNTS.aOwnedByA1,
          decision: null,
        },
      ])

      const error = await expectRejected(db, 'select * from public.execute_import($1)', [batchId])
      expect(error.message).toMatch(/decision/i)

      // Nothing was created — the whole batch is one transaction.
      const { rows } = await db.query(
        'select count(*)::int as n from public.accounts where import_batch_id = $1',
        [batchId],
      )
      expect(rows[0].n).toBe(0)
    } finally {
      await db.query('rollback')
    }
  })

  it('SKIP creates nothing and records the row as skipped', async () => {
    await db.query('begin')
    try {
      const batchId = await makeBatch('accounts', [
        {
          normalized: account(),
          status: 'DUPLICATE_EXACT',
          duplicate_of: ACCOUNTS.aOwnedByA1,
          decision: 'SKIP',
        },
      ])
      const { rows } = await db.query('select * from public.execute_import($1)', [batchId])
      expect(rows[0]).toMatchObject({ imported: 0, skipped: 1, linked: 0 })

      const { rows: created } = await db.query(
        'select count(*)::int as n from public.accounts where import_batch_id = $1',
        [batchId],
      )
      expect(created[0].n).toBe(0)
    } finally {
      await db.query('rollback')
    }
  })

  it('IMPORT creates a second record even though it is a duplicate', async () => {
    await db.query('begin')
    try {
      const batchId = await makeBatch('accounts', [
        {
          normalized: account({ name: 'Ravi Kumar' }),
          status: 'DUPLICATE_EXACT',
          duplicate_of: ACCOUNTS.aOwnedByA1,
          decision: 'IMPORT',
        },
      ])
      const { rows } = await db.query('select * from public.execute_import($1)', [batchId])
      expect(rows[0]).toMatchObject({ imported: 1, skipped: 0, linked: 0 })
    } finally {
      await db.query('rollback')
    }
  })

  describe('LINK_EXISTING (§20.4)', () => {
    it('records legacy_ref on the existing record and creates nothing', async () => {
      await db.query('begin')
      try {
        const batchId = await makeBatch('accounts', [
          {
            normalized: account({ legacy_ref: 'REG-99' }),
            status: 'DUPLICATE_EXACT',
            duplicate_of: ACCOUNTS.aOwnedByA1,
            decision: 'LINK_EXISTING',
          },
        ])

        const { rows } = await db.query('select * from public.execute_import($1)', [batchId])
        expect(rows[0]).toMatchObject({ imported: 0, skipped: 0, linked: 1 })

        const { rows: existing } = await db.query(
          'select legacy_ref from public.accounts where id = $1',
          [ACCOUNTS.aOwnedByA1],
        )
        expect(existing[0].legacy_ref).toBe('REG-99')

        const { rows: created } = await db.query(
          'select count(*)::int as n from public.accounts where import_batch_id = $1',
          [batchId],
        )
        expect(created[0].n).toBe(0)
      } finally {
        await db.query('rollback')
      }
    })

    it('NEVER overwrites the existing record’s other fields', async () => {
      await db.query('begin')
      try {
        const before = await db.query(
          'select name, phone, account_type, city, owner_id, notes from public.accounts where id = $1',
          [ACCOUNTS.aOwnedByA1],
        )

        const batchId = await makeBatch('accounts', [
          {
            normalized: account({
              name: 'COMPLETELY DIFFERENT NAME',
              phone: '9800000000',
              account_type: 'BUILDER',
              city: 'Bhavani',
              notes: 'overwritten notes',
              owner_id: USERS.salesB1,
              legacy_ref: 'REG-100',
            }),
            status: 'DUPLICATE_EXACT',
            duplicate_of: ACCOUNTS.aOwnedByA1,
            decision: 'LINK_EXISTING',
          },
        ])
        await db.query('select * from public.execute_import($1)', [batchId])

        const after = await db.query(
          'select name, phone, account_type, city, owner_id, notes from public.accounts where id = $1',
          [ACCOUNTS.aOwnedByA1],
        )
        expect(after.rows[0]).toEqual(before.rows[0])
      } finally {
        await db.query('rollback')
      }
    })

    it('does not overwrite a legacy_ref the existing record already carries', async () => {
      await db.query('begin')
      try {
        await db.query('update public.accounts set legacy_ref = $1 where id = $2', [
          'ORIGINAL-REF',
          ACCOUNTS.aOwnedByA1,
        ])

        const batchId = await makeBatch('accounts', [
          {
            normalized: account({ legacy_ref: 'NEW-REF' }),
            status: 'DUPLICATE_EXACT',
            duplicate_of: ACCOUNTS.aOwnedByA1,
            decision: 'LINK_EXISTING',
          },
        ])
        await db.query('select * from public.execute_import($1)', [batchId])

        const { rows } = await db.query('select legacy_ref from public.accounts where id = $1', [
          ACCOUNTS.aOwnedByA1,
        ])
        expect(rows[0].legacy_ref).toBe('ORIGINAL-REF')
      } finally {
        await db.query('rollback')
      }
    })

    it('records which record the row was linked to', async () => {
      await db.query('begin')
      try {
        const batchId = await makeBatch('accounts', [
          {
            normalized: account(),
            status: 'DUPLICATE_EXACT',
            duplicate_of: ACCOUNTS.aOwnedByA1,
            decision: 'LINK_EXISTING',
          },
        ])
        await db.query('select * from public.execute_import($1)', [batchId])

        const { rows } = await db.query(
          'select status, created_entity_id from public.import_rows where batch_id = $1',
          [batchId],
        )
        expect(rows[0].status).toBe('SKIPPED')
        expect(rows[0].created_entity_id).toBe(ACCOUNTS.aOwnedByA1)
      } finally {
        await db.query('rollback')
      }
    })
  })

  it('is ATOMIC — one invalid row rolls the whole batch back (§20.5)', async () => {
    await db.query('begin')
    try {
      const batchId = await makeBatch('accounts', [
        { normalized: account({ legacy_ref: 'GOOD-1' }) },
        // No phone and no email: `account_reachable` refuses it (ADR-013).
        { normalized: account({ phone: null, email: null, legacy_ref: 'BAD' }) },
        { normalized: account({ legacy_ref: 'GOOD-2' }) },
      ])

      await expectRejected(db, 'select * from public.execute_import($1)', [batchId])

      const { rows } = await db.query(
        'select count(*)::int as n from public.accounts where import_batch_id = $1',
        [batchId],
      )
      // Not one, not two — nothing. Everything imports together or nothing does.
      expect(rows[0].n).toBe(0)

      const { rows: batch } = await db.query(
        'select status from public.import_batches where id = $1',
        [batchId],
      )
      // Still reviewable, so the file can be fixed and the batch re-run.
      expect(batch[0].status).toBe('REVIEW')
    } finally {
      await db.query('rollback')
    }
  })

  it('skips ERROR rows rather than importing them', async () => {
    await db.query('begin')
    try {
      const batchId = await makeBatch('accounts', [
        { normalized: {}, status: 'ERROR' },
        { normalized: account() },
      ])
      const { rows } = await db.query('select * from public.execute_import($1)', [batchId])
      expect(rows[0]).toMatchObject({ imported: 1, skipped: 1 })
    } finally {
      await db.query('rollback')
    }
  })

  it('refuses to run a batch that is not in REVIEW', async () => {
    await db.query('begin')
    try {
      const batchId = await makeBatch('accounts', [{ normalized: account() }])
      await db.query('select * from public.execute_import($1)', [batchId])
      // Second run: the batch is COMPLETED now.
      const error = await expectRejected(db, 'select * from public.execute_import($1)', [batchId])
      expect(error.message).toMatch(/not ready/i)
    } finally {
      await db.query('rollback')
    }
  })

  it('imports contacts with their provenance columns', async () => {
    await db.query('begin')
    try {
      const batchId = await makeBatch('contacts', [
        {
          normalized: {
            full_name: 'Imported Contact',
            phone: '9843090002',
            email: null,
            account_id: ACCOUNTS.aOwnedByA1,
            role: 'ARCHITECT',
            influence: 'INFLUENCER',
            is_referral_source: false,
            notes: null,
            owner_id: USERS.salesA1,
            legacy_ref: 'REG-C1',
          },
        },
      ])
      const { rows } = await db.query('select * from public.execute_import($1)', [batchId])
      expect(rows[0].imported).toBe(1)

      const { rows: created } = await db.query(
        'select is_imported, import_batch_id, legacy_ref, account_id from public.contacts where import_batch_id = $1',
        [batchId],
      )
      expect(created[0]).toMatchObject({
        is_imported: true,
        import_batch_id: batchId,
        legacy_ref: 'REG-C1',
        account_id: ACCOUNTS.aOwnedByA1,
      })
    } finally {
      await db.query('rollback')
    }
  })

  it('refuses an entity V1 does not import (TODO-BD-10)', async () => {
    await db.query('begin')
    try {
      const { rows: batch } = await db.query(
        `insert into public.import_batches (entity, file_name, status, total_rows, uploaded_by)
         values ('projects', 't.csv', 'REVIEW', 1, $1) returning id`,
        [USERS.owner],
      )
      await db.query(
        `insert into public.import_rows (batch_id, row_number, raw, normalized, status)
         values ($1, 1, '{}', '{}', 'VALID')`,
        [batch[0].id],
      )

      const error = await expectRejected(db, 'select * from public.execute_import($1)', [
        batch[0].id,
      ])
      expect(error.message).toMatch(/not supported/i)
    } finally {
      await db.query('rollback')
    }
  })
})

describe('rollback_import (§20.6)', () => {
  async function importedBatch(): Promise<string> {
    const batchId = await makeBatch('accounts', [
      { normalized: account({ legacy_ref: 'R-1' }) },
      { normalized: account({ phone: '9843090009', legacy_ref: 'R-2' }) },
    ])
    await db.query('select * from public.execute_import($1)', [batchId])
    return batchId
  }

  it('ARCHIVES the imported records — it never deletes them', async () => {
    await db.query('begin')
    try {
      const batchId = await importedBatch()
      const { rows } = await db.query('select * from public.rollback_import($1)', [batchId])
      expect(rows[0]).toMatchObject({ accounts: 2, contacts: 0 })

      const { rows: after } = await db.query(
        `select count(*)::int as total,
                count(*) filter (where archived_at is not null)::int as archived
           from public.accounts where import_batch_id = $1`,
        [batchId],
      )
      // Still there. Archived, not deleted (CLAUDE.md §11).
      expect(after[0]).toEqual({ total: 2, archived: 2 })
    } finally {
      await db.query('rollback')
    }
  })

  it('marks the batch ROLLED_BACK', async () => {
    await db.query('begin')
    try {
      const batchId = await importedBatch()
      await db.query('select * from public.rollback_import($1)', [batchId])
      const { rows } = await db.query('select status from public.import_batches where id = $1', [
        batchId,
      ])
      expect(rows[0].status).toBe('ROLLED_BACK')
    } finally {
      await db.query('rollback')
    }
  })

  it('REFUSES once an imported record has been edited', async () => {
    await db.query('begin')
    try {
      const batchId = await importedBatch()

      // Backdate the completion, because `now()` is TRANSACTION START time: the
      // import and the edit below share one transaction here, so without this
      // they share a timestamp and the `updated_at > completed_at` test cannot
      // fire. In reality the import commits and the edit happens minutes or days
      // later, in its own transaction with its own clock. This reproduces that
      // gap rather than weakening the rule.
      await db.query(
        `update public.import_batches set completed_at = now() - interval '1 hour' where id = $1`,
        [batchId],
      )

      // A person edits one of the imported customers.
      await db.query(
        `update public.accounts set notes = 'a real edit' where import_batch_id = $1
          and id = (select id from public.accounts where import_batch_id = $1 limit 1)`,
        [batchId],
      )

      const error = await expectRejected(db, 'select * from public.rollback_import($1)', [batchId])
      expect(error.message).toMatch(/edited/i)

      const { rows } = await db.query(
        'select count(*) filter (where archived_at is not null)::int as archived from public.accounts where import_batch_id = $1',
        [batchId],
      )
      expect(rows[0].archived).toBe(0)
    } finally {
      await db.query('rollback')
    }
  })

  it('REFUSES after the seven-day window', async () => {
    await db.query('begin')
    try {
      const batchId = await importedBatch()
      await db.query(
        `update public.import_batches set completed_at = now() - interval '8 days' where id = $1`,
        [batchId],
      )

      const error = await expectRejected(db, 'select * from public.rollback_import($1)', [batchId])
      expect(error.message).toMatch(/older than/i)
    } finally {
      await db.query('rollback')
    }
  })

  it('preserves relationships — an activity on an imported customer survives', async () => {
    await db.query('begin')
    try {
      const batchId = await importedBatch()
      const { rows: created } = await db.query(
        'select id from public.accounts where import_batch_id = $1 limit 1',
        [batchId],
      )
      const accountId = created[0].id

      // Same reason as above: `now()` is transaction start time.
      await db.query(
        `update public.import_batches set completed_at = now() - interval '1 hour' where id = $1`,
        [batchId],
      )

      await db.query(
        `insert into public.activities (account_id, type, summary, performed_by)
         values ($1, 'NOTE', 'Something happened', $2)`,
        [accountId, USERS.salesA1],
      )

      // That activity is an edit — `touch_last_activity_at` moved `updated_at` —
      // so rollback is correctly refused. This is the H-09 behaviour seen from
      // the other side: real activity makes an import permanent.
      const error = await expectRejected(db, 'select * from public.rollback_import($1)', [batchId])
      expect(error.message).toMatch(/edited/i)

      const { rows: activities } = await db.query(
        'select count(*)::int as n from public.activities where account_id = $1',
        [accountId],
      )
      expect(activities[0].n).toBe(1)
    } finally {
      await db.query('rollback')
    }
  })

  it('rolls back contacts as well as accounts', async () => {
    await db.query('begin')
    try {
      const batchId = await makeBatch('contacts', [
        {
          normalized: {
            full_name: 'Imported Contact',
            phone: '9843090003',
            email: null,
            account_id: ACCOUNTS.aOwnedByA1,
            role: 'OTHER',
            influence: 'INFLUENCER',
            is_referral_source: false,
            notes: null,
            owner_id: USERS.salesA1,
            legacy_ref: 'RC-1',
          },
        },
      ])
      await db.query('select * from public.execute_import($1)', [batchId])

      const { rows } = await db.query('select * from public.rollback_import($1)', [batchId])
      expect(rows[0]).toMatchObject({ accounts: 0, contacts: 1 })
    } finally {
      await db.query('rollback')
    }
  })

  it('NO ROW IS EVER DELETED by a rollback', async () => {
    await db.query('begin')
    try {
      const before = await db.query('select count(*)::int as n from public.accounts')
      const batchId = await importedBatch()
      await db.query('select * from public.rollback_import($1)', [batchId])
      const after = await db.query('select count(*)::int as n from public.accounts')

      expect(after.rows[0].n).toBe(before.rows[0].n + 2)
    } finally {
      await db.query('rollback')
    }
  })
})

describe('import permissions (§3.1, §15.5)', () => {
  it('a SALESPERSON cannot see or create import batches', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.salesA1)

      const { rows } = await db.query('select count(*)::int as n from public.import_batches')
      expect(rows[0].n).toBe(0)

      await expectRejected(
        db,
        `insert into public.import_batches (entity, file_name, uploaded_by)
         values ('accounts', 'x.csv', $1)`,
        [USERS.salesA1],
      )
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('a MANAGER cannot import either — it is OWNER/ADMIN only', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.managerA)

      const { rows } = await db.query('select count(*)::int as n from public.import_batches')
      expect(rows[0].n).toBe(0)

      await expectRejected(
        db,
        `insert into public.import_batches (entity, file_name, uploaded_by)
         values ('accounts', 'x.csv', $1)`,
        [USERS.managerA],
      )
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('an ADMIN can create a batch', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.admin)
      await db.query(
        `insert into public.import_batches (entity, file_name, uploaded_by)
         values ('accounts', 'x.csv', $1)`,
        [USERS.admin],
      )
      const { rows } = await db.query('select count(*)::int as n from public.import_batches')
      expect(rows[0].n).toBeGreaterThan(0)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('a signed-in OWNER cannot call execute_import directly through PostgREST', async () => {
    // §15.7/ADR-009: the executor is reached through the service-role client only,
    // after the service has checked the role. `authenticated` has no EXECUTE.
    await db.query('begin')
    try {
      const batchId = await makeBatch('accounts', [{ normalized: account() }])
      await becomeUser(db, USERS.owner)
      const error = await expectRejected(db, 'select * from public.execute_import($1)', [batchId])
      expect(error.code).toBe('42501')
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('nobody may DELETE an import batch or row', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.owner)
      await expectRejected(db, 'delete from public.import_batches')
      await expectRejected(db, 'delete from public.import_rows')
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })
})
