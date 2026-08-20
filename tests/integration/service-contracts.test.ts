import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connect, type Db } from './harness'

/**
 * The service layer's contract with the database schema.
 *
 * **Why this file exists.** Services reach the database through PostgREST, and
 * PostgREST is not runnable in this environment — its images, and the Supabase
 * stack around it, are blocked by the egress policy (ADR-018). So the queries in
 * `src/services/*` cannot be executed here end to end.
 *
 * What *can* be checked, and is checked below, is everything those queries
 * depend on: that each column a service selects, filters or orders by actually
 * exists; that each RPC exists with the signature the generated types describe;
 * that the embedded resources resolve through exactly one foreign key, so
 * PostgREST does not refuse the embed as ambiguous; and that `authenticated` has
 * the grants the calls need.
 *
 * A typo in a column list is the most likely way one of these queries breaks, and
 * it is precisely what a type checker cannot see inside a string. This closes
 * that gap. It does not replace an end-to-end run against a real Supabase
 * project, and is not presented as doing so.
 */
let db: Db

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db.end()
})

async function columnsOf(relation: string): Promise<Set<string>> {
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1`,
    [relation],
  )
  return new Set(rows.map((row: { column_name: string }) => row.column_name))
}

/** The column list in `account.service.ts` (`ACCOUNT_COLUMNS`). */
const ACCOUNT_COLUMNS = [
  'id', 'name', 'account_type', 'phone', 'alt_phone', 'whatsapp_phone', 'email', 'address',
  'city', 'area', 'source', 'owner_id', 'status', 'gstin', 'notes', 'outlet_id',
  'last_activity_at', 'referred_by_contact_id', 'archived_at', 'created_at', 'updated_at',
]

/** The column list in `dashboard.service.ts` (`FLAG_COLUMNS`). */
const FLAG_COLUMNS = [
  'id', 'title', 'account_id', 'project_id', 'owner_id', 'stage', 'category', 'estimated_value',
  'final_order_value', 'next_action', 'next_action_date', 'next_action_note', 'expected_close_date',
  'outlet_id', 'created_at', 'closed_at', 'last_activity_at', 'is_active', 'in_pipeline',
  'is_overdue', 'is_due_today', 'is_missing_next_action', 'is_unassigned', 'days_in_stage',
  'days_since_activity',
]

describe('column lists the services select', () => {
  it('every column account.service.ts asks for exists on accounts', async () => {
    const columns = await columnsOf('accounts')
    expect(ACCOUNT_COLUMNS.filter((column) => !columns.has(column))).toEqual([])
  })

  it('every column dashboard.service.ts asks for exists on v_opportunity_flags', async () => {
    const columns = await columnsOf('v_opportunity_flags')
    expect(FLAG_COLUMNS.filter((column) => !columns.has(column))).toEqual([])
  })

  it('the columns the pipeline list filters and orders by exist on the view', async () => {
    const columns = await columnsOf('v_opportunity_flags')
    for (const column of [
      'owner_id', 'outlet_id', 'stage', 'category', 'is_active', 'is_overdue',
      'is_missing_next_action', 'next_action_date', 'created_at', 'title', 'archived_at',
    ]) {
      expect({ column, present: columns.has(column) }).toEqual({ column, present: true })
    }
  })

  it('the columns the account, project and contact filters use exist', async () => {
    const accounts = await columnsOf('accounts')
    for (const column of ['owner_id', 'outlet_id', 'status', 'account_type', 'city', 'phone_normalized', 'archived_at']) {
      expect({ column, present: accounts.has(column) }).toEqual({ column, present: true })
    }

    const projects = await columnsOf('projects')
    for (const column of ['owner_id', 'outlet_id', 'account_id', 'status', 'construction_stage', 'city', 'archived_at']) {
      expect({ column, present: projects.has(column) }).toEqual({ column, present: true })
    }

    const contacts = await columnsOf('contacts')
    for (const column of ['owner_id', 'account_id', 'role', 'is_referral_source', 'phone_normalized', 'archived_at']) {
      expect({ column, present: contacts.has(column) }).toEqual({ column, present: true })
    }
  })

  it('every table a service reads exposes archived_at, so the archive filter is real', async () => {
    for (const table of ['accounts', 'contacts', 'projects', 'opportunities']) {
      const columns = await columnsOf(table)
      expect({ table, archivable: columns.has('archived_at') }).toEqual({ table, archivable: true })
    }
  })
})

describe('PostgREST embedded resources resolve unambiguously', () => {
  it('project_stakeholders embeds contacts and accounts through exactly one FK each', async () => {
    // `getProjectDetail` selects
    //   `*, contact:contacts(...), account:accounts(...)`
    // PostgREST refuses an embed when two foreign keys could satisfy it, which is
    // why `auth.service.ts` has to hint `user_outlets!user_outlets_user_id_fkey`.
    // These two must stay single-FK or the project screen breaks.
    const { rows } = await db.query(`
      select ccu.table_name as target, count(*)::int as fk_count
        from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
       where tc.table_schema = 'public'
         and tc.table_name = 'project_stakeholders'
         and tc.constraint_type = 'FOREIGN KEY'
         and ccu.table_name in ('contacts','accounts')
       group by ccu.table_name`)

    const byTarget = Object.fromEntries(
      rows.map((row: { target: string; fk_count: number }) => [row.target, row.fk_count]),
    )
    expect(byTarget).toEqual({ contacts: 1, accounts: 1 })
  })
})

describe('the RPCs the services call exist with the expected arity', () => {
  const EXPECTED: Record<string, number> = {
    create_account_with_opportunity: 19,
    log_activity: 16,
    change_opportunity_stage: 14,
    reassign_opportunity: 3,
    bulk_reassign: 3,
    search_crm: 2,
    find_account_duplicates: 8,
  }

  it('each is declared once, with the argument count the generated types describe', async () => {
    const { rows } = await db.query(
      `select p.proname, p.pronargs::int as nargs, count(*) over (partition by p.proname)::int as overloads
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1)`,
      [Object.keys(EXPECTED)],
    )

    const found = Object.fromEntries(
      rows.map((row: { proname: string; nargs: number }) => [row.proname, row.nargs]),
    )
    expect(found).toEqual(EXPECTED)

    // An overload would make the PostgREST call ambiguous.
    for (const row of rows as { proname: string; overloads: number }[]) {
      expect({ fn: row.proname, overloads: row.overloads }).toEqual({ fn: row.proname, overloads: 1 })
    }
  })

  it('runs as the caller, so RLS still applies (§16.3)', async () => {
    const { rows } = await db.query(
      `select p.proname, p.prosecdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1)`,
      [Object.keys(EXPECTED)],
    )
    // SECURITY INVOKER — the RPC buys atomicity, never authority. A DEFINER here
    // would silently bypass every policy in migration 016.
    for (const row of rows as { proname: string; prosecdef: boolean }[]) {
      expect({ fn: row.proname, definer: row.prosecdef }).toEqual({ fn: row.proname, definer: false })
    }
  })
})

describe('grants the service calls depend on', () => {
  it('authenticated may execute every CRM function and none is left open to anon', async () => {
    const functions = [
      'create_account_with_opportunity', 'log_activity', 'change_opportunity_stage',
      'reassign_opportunity', 'bulk_reassign', 'search_crm', 'find_account_duplicates',
      'like_escape', 'raise_not_found',
    ]
    const { rows } = await db.query(
      `select p.proname,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1)`,
      [functions],
    )

    expect(rows.length).toBe(functions.length)
    for (const row of rows as { proname: string; authenticated: boolean; anon: boolean }[]) {
      expect({ fn: row.proname, authenticated: row.authenticated, anon: row.anon }).toEqual({
        fn: row.proname,
        authenticated: true,
        anon: false,
      })
    }
  })

  it('authenticated may read v_opportunity_flags, and the view enforces RLS', async () => {
    const { rows } = await db.query(`
      select has_table_privilege('authenticated', 'public.v_opportunity_flags', 'select') as readable,
             (select c.reloptions from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'v_opportunity_flags') as options`)

    expect(rows[0].readable).toBe(true)
    // Without `security_invoker`, the view would run with the definer's rights
    // and publish every salesperson's pipeline to every other salesperson (§25).
    expect(rows[0].options).toContain('security_invoker=true')
  })

  it('the trigger functions added in 018 are not callable by anybody directly', async () => {
    const { rows } = await db.query(
      `select p.proname,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = any(array['touch_stage_changed_at','touch_last_activity_at','apply_won_account_status'])`,
    )
    expect(rows.length).toBe(3)
    for (const row of rows as { proname: string; authenticated: boolean; anon: boolean }[]) {
      // They run as triggers, owned by the table owner. Exposing them as callable
      // functions would let a user move somebody else's data directly.
      expect({ fn: row.proname, authenticated: row.authenticated, anon: row.anon }).toEqual({
        fn: row.proname,
        authenticated: false,
        anon: false,
      })
    }
  })
})

describe('the schema is still the approved table set (§4.1)', () => {
  it('has not grown an unapproved table', async () => {
    const { rows } = await db.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    )
    const tables = rows.map((row: { table_name: string }) => row.table_name)
    // The eleven of §4.1, plus `outlets` and `user_outlets` from ADR-016, plus
    // `sales_targets` from ADR-021.
    //
    // **Each addition beyond the eleven required approval recorded in
    // /docs/DECISIONS.md BEFORE its migration was written** (CLAUDE.md §4). This
    // list is the enforcement of that rule: a table that appears here without an
    // ADR behind it fails the build, which is exactly what happened when
    // `sales_targets` was added and is why ADR-021 exists.
    expect(tables).toEqual([
      'accounts', 'activities', 'contacts', 'import_batches', 'import_rows', 'opportunities',
      'opportunity_events', 'outlets', 'project_stakeholders', 'projects', 'sales_targets',
      'system_settings', 'user_outlets', 'users',
    ])
  })

  it('still has exactly one DELETE policy in the whole schema (ADR-004)', async () => {
    const { rows } = await db.query(
      `select tablename, policyname from pg_policies
        where schemaname = 'public' and cmd = 'DELETE'`,
    )
    expect(rows).toEqual([
      { tablename: 'project_stakeholders', policyname: 'project_stakeholders_delete' },
    ])
  })

  it('has not introduced a follow_up stage', async () => {
    const { rows } = await db.query(
      `select enumlabel from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'opportunity_stage' order by e.enumsortorder`,
    )
    const stages = rows.map((row: { enumlabel: string }) => row.enumlabel)
    expect(stages).toEqual([
      'new', 'qualified', 'selection', 'quoted', 'negotiation',
      'verbal_confirmation', 'won', 'lost', 'nurture',
    ])
    // §9.1 — follow-up is an action, not a pipeline position.
    expect(stages).not.toContain('follow_up')
  })
})
