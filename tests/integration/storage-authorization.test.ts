import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ACCOUNTS,
  ACTIVITIES,
  OPPORTUNITIES,
  PROJECTS,
  USERS,
  becomeUser,
  connect,
  expectRejected,
  type Db,
} from './harness'

/**
 * Storage authorization (§15.6, §19.4, ADR-005).
 *
 * **The path prefix is the authorization key**, and these tests attack the
 * DATABASE rather than the UI (§19.4): they insert and select rows in
 * `storage.objects` directly, as the restricted role, exactly as a signed URL
 * obtained by any route would.
 *
 * A user may read a file only if they can read the entity in its path. Nothing
 * about the file name, the bucket or the uploader changes that.
 */

let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db.end()
})

const OBJECTS = {
  oppA1: `opportunity/${OPPORTUNITIES.aOwnedByA1}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-quote.pdf`,
  oppB1: `opportunity/${OPPORTUNITIES.bOwnedByB1}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef-quote.pdf`,
  accountA1: `account/${ACCOUNTS.aOwnedByA1}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01-doc.pdf`,
  projectB1: `project/${PROJECTS.bOwnedByB1}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee02-plan.pdf`,
  activityB1: `activity/${ACTIVITIES.onBOwnedByB1}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee03-site.jpg`,
  malformed: 'account/not-a-uuid/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee04-x.pdf',
  unknownKind: `invoice/${OPPORTUNITIES.aOwnedByA1}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee05-x.pdf`,
  noPrefix: 'loose-file.pdf',
}

async function seedObjects(): Promise<void> {
  for (const name of Object.values(OBJECTS)) {
    await db.query(`insert into storage.objects (bucket_id, name) values ('crm-files', $1)`, [name])
  }
}

async function visibleTo(userId: string): Promise<string[]> {
  await becomeUser(db, userId)
  const { rows } = await db.query(`select name from storage.objects order by name`)
  await db.query('reset role')
  return rows.map((row: { name: string }) => row.name)
}

describe('the crm-files bucket', () => {
  it('is private and capped at 10 MB (§15.6)', async () => {
    const { rows } = await db.query(
      `select public, file_size_limit from storage.buckets where id = 'crm-files'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].public).toBe(false)
    expect(Number(rows[0].file_size_limit)).toBe(10 * 1024 * 1024)
  })
})

describe('reading (§19.4 — no visibility of the parent, no file)', () => {
  it('a salesperson sees only files for entities they can reach', async () => {
    await db.query('begin')
    try {
      await seedObjects()

      // sales.a1 owns opportunity 5001 and account 3001; outlet B is not theirs.
      const visible = await visibleTo(USERS.salesA1)
      expect(visible).toContain(OBJECTS.oppA1)
      expect(visible).toContain(OBJECTS.accountA1)
      expect(visible).not.toContain(OBJECTS.oppB1)
      expect(visible).not.toContain(OBJECTS.projectB1)
      expect(visible).not.toContain(OBJECTS.activityB1)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('a salesperson in another outlet cannot read the first one’s quotation', async () => {
    await db.query('begin')
    try {
      await seedObjects()
      const visible = await visibleTo(USERS.salesB1)
      expect(visible).not.toContain(OBJECTS.oppA1)
      expect(visible).toContain(OBJECTS.oppB1)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('a MANAGER sees files from their outlets only', async () => {
    await db.query('begin')
    try {
      await seedObjects()
      // manager.a manages outlet A.
      const visible = await visibleTo(USERS.managerA)
      expect(visible).toContain(OBJECTS.oppA1)
      expect(visible).not.toContain(OBJECTS.oppB1)
      expect(visible).not.toContain(OBJECTS.projectB1)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('the OWNER sees everything that has a valid path', async () => {
    await db.query('begin')
    try {
      await seedObjects()
      const visible = await visibleTo(USERS.owner)
      expect(visible).toContain(OBJECTS.oppA1)
      expect(visible).toContain(OBJECTS.oppB1)
      expect(visible).toContain(OBJECTS.projectB1)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('an ADMIN sees business files, because it can see the records (ADR-040)', async () => {
    await db.query('begin')
    try {
      await seedObjects()
      // Storage visibility is derived from the parent entity, never restated —
      // so widening ADMIN's read of accounts and opportunities widens this too,
      // automatically and by construction. That is the property worth pinning:
      // if these ever disagree, one of them has grown its own copy of the rule.
      expect((await visibleTo(USERS.admin)).length).toBeGreaterThan(0)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('an unauthenticated caller sees nothing', async () => {
    await db.query('begin')
    try {
      await seedObjects()
      await becomeUser(db, null)
      const { rows } = await db.query('select name from storage.objects')
      expect(rows).toEqual([])
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('a deactivated user sees nothing, even with a valid token', async () => {
    await db.query('begin')
    try {
      await seedObjects()
      expect(await visibleTo(USERS.deactivated)).toEqual([])
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })
})

describe('malformed and unknown paths are refused, never served', () => {
  it('a non-uuid id is invisible to everyone, including the OWNER', async () => {
    await db.query('begin')
    try {
      await seedObjects()
      expect(await visibleTo(USERS.owner)).not.toContain(OBJECTS.malformed)
      expect(await visibleTo(USERS.salesA1)).not.toContain(OBJECTS.malformed)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('an unknown entity kind is refused — there is no default-allow branch', async () => {
    await db.query('begin')
    try {
      await seedObjects()
      expect(await visibleTo(USERS.owner)).not.toContain(OBJECTS.unknownKind)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('a path with no prefix at all is refused', async () => {
    await db.query('begin')
    try {
      await seedObjects()
      expect(await visibleTo(USERS.owner)).not.toContain(OBJECTS.noPrefix)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('a malformed path does not raise a database error (it is attacker input)', async () => {
    const { rows } = await db.query('select public.can_read_storage_path($1) as ok', [
      'account/;drop table accounts;/x.pdf',
    ])
    expect(rows[0].ok).toBe(false)
  })
})

describe('writing', () => {
  it('a salesperson cannot write into an entity they cannot see', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.salesB1)
      const error = await expectRejected(
        db,
        `insert into storage.objects (bucket_id, name) values ('crm-files', $1)`,
        [OBJECTS.oppA1],
      )
      expect(error.code).toBe('42501')
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('a salesperson CAN write into an opportunity they own', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.salesA1)
      await db.query(`insert into storage.objects (bucket_id, name) values ('crm-files', $1)`, [
        OBJECTS.oppA1,
      ])
      const { rows } = await db.query('select count(*)::int as n from storage.objects')
      expect(rows[0].n).toBe(1)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('nobody can write a malformed path', async () => {
    await db.query('begin')
    try {
      await becomeUser(db, USERS.owner)
      await expectRejected(
        db,
        `insert into storage.objects (bucket_id, name) values ('crm-files', $1)`,
        [OBJECTS.malformed],
      )
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })

  it('NO ROLE MAY DELETE AN OBJECT — there is no delete policy (CLAUDE.md §11)', async () => {
    await db.query('begin')
    try {
      await seedObjects()
      await becomeUser(db, USERS.owner)
      await expectRejected(db, `delete from storage.objects where bucket_id = 'crm-files'`)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })
})

describe('work context reaches attachments too (§3.2)', () => {
  it('a salesperson owning an opportunity on someone else’s account can read that account’s files', async () => {
    await db.query('begin')
    try {
      // Opportunity 5004 belongs to sales.a1 but sits on account 3002, owned by
      // sales.a2. Work context is what lets a1 see the parent account — and so
      // its files.
      const path = `account/${ACCOUNTS.aOwnedByA2}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee06-x.pdf`
      await db.query(`insert into storage.objects (bucket_id, name) values ('crm-files', $1)`, [path])

      await becomeUser(db, USERS.salesA1)
      const { rows } = await db.query('select name from storage.objects where name = $1', [path])
      expect(rows).toHaveLength(1)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })
})

describe('archiving does not orphan a file’s authorization', () => {
  it('an archived opportunity’s files follow the same visibility rule', async () => {
    await db.query('begin')
    try {
      await db.query(`insert into storage.objects (bucket_id, name) values ('crm-files', $1)`, [
        OBJECTS.oppA1,
      ])
      await db.query('update public.opportunities set archived_at = now() where id = $1', [
        OPPORTUNITIES.aOwnedByA1,
      ])

      // `can_read_opportunity` does not filter on archived_at, so a manager
      // reviewing an archived record can still open its quotation — which is what
      // §8.8's "remain available to authorized roles" requires.
      await becomeUser(db, USERS.managerA)
      const { rows } = await db.query('select name from storage.objects where name = $1', [
        OBJECTS.oppA1,
      ])
      expect(rows).toHaveLength(1)
    } finally {
      await db.query('rollback')
      await db.query('reset role')
    }
  })
})
