import { z } from 'zod'

import { AppError, forbidden, fromPostgrestError, notFound } from '@/lib/errors'
import { pageRange, paginate, type PageParams, type Paginated } from '@/lib/pagination'
import { isManagerOrAbove } from '@/lib/permissions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'

import { requireUser } from './auth.service'

/**
 * Archive and restore (§8.8, C-3/M-06).
 *
 * **NOTHING IS EVER HARD-DELETED.** "Remove" in this application means archive,
 * and archive means a timestamp. Archived records keep every relationship and
 * every activity, contribute nothing to pipeline value, disappear from active
 * lists and dashboards, stay readable to the roles that could see them before,
 * and come back intact.
 *
 * Archiving a customer is C-3's **four-step controlled operation**:
 *
 *   1. preview the complete set of affected child records
 *   2. display it plainly
 *   3. require explicit confirmation
 *   4. archive the account and its children as ONE operation
 *
 * Steps 1–3 are the caller's; step 4 is `archive_account` in migration 025. **The
 * preview is informational — children do not require separate opt-ins**, because
 * a customer whose opportunities stayed live after they were archived would keep
 * counting towards the pipeline, which is the bug archiving exists to prevent.
 *
 * The children are opportunities, projects and contacts. **Activities and
 * opportunity events are history and are never archived** — that is precisely
 * what preserves §8.8's promise that an archived record retains all
 * relationships and activities.
 */

export const ARCHIVABLE_ENTITIES = ['account', 'project', 'opportunity', 'contact'] as const
export type ArchivableEntity = (typeof ARCHIVABLE_ENTITIES)[number]

const TABLE_FOR: Record<ArchivableEntity, 'accounts' | 'projects' | 'opportunities' | 'contacts'> = {
  account: 'accounts',
  project: 'projects',
  opportunity: 'opportunities',
  contact: 'contacts',
}

const NAME_COLUMN: Record<ArchivableEntity, string> = {
  account: 'name',
  project: 'name',
  opportunity: 'title',
  contact: 'full_name',
}

export const archiveInputSchema = z.object({
  entity: z.enum(ARCHIVABLE_ENTITIES),
  id: uuidSchema,
  reason: z.string().trim().max(500).optional(),
})

export type ArchivePreview = {
  entity: ArchivableEntity
  id: string
  name: string
  /** What else this operation will archive. Empty for anything but an account. */
  children: { opportunities: number; projects: number; contacts: number }
  /** Pipeline value that leaves the active pipeline, in paise (§8.8). */
  pipelineValueRemovedPaise: number
  /** Activities that stay exactly where they are. Shown so nobody fears losing them. */
  activitiesRetained: number
}

async function requireArchiver() {
  const user = await requireUser()
  // Mirrors `guard_record_scope()` in migration 015, which is the actual control:
  // a salesperson's UPDATE setting `archived_at` is refused by the database.
  if (!isManagerOrAbove(user)) {
    throw forbidden('Only a manager or the owner can archive or restore a record.')
  }
  return user
}

/**
 * Step 1 of C-3: what will this archive affect?
 *
 * Every count is a real query against real rows (CLAUDE.md §15). A preview that
 * under-reports is the trust failure Phase 16 names — so the archive itself
 * refuses rather than silently skipping a child the caller cannot see (see
 * `count_live_account_children` in migration 025).
 */
export async function previewArchive(
  entity: ArchivableEntity,
  id: string,
): Promise<ArchivePreview> {
  await requireArchiver()
  const entityId = uuidSchema.parse(id)
  const supabase = await createSupabaseServerClient()

  // The table and the name column are both chosen at runtime, which the typed
  // client cannot follow; the pair comes from the two frozen maps above, so the
  // string is never caller-controlled.
  const { data: record, error } = await supabase
    .from(TABLE_FOR[entity])
    .select(`id, ${NAME_COLUMN[entity]}` as '*')
    .eq('id', entityId)
    .is('archived_at', null)
    .maybeSingle()

  if (error) throw fromPostgrestError(error)
  if (!record) throw notFound(entity)

  const name = (record as unknown as Record<string, string>)[NAME_COLUMN[entity]] ?? ''

  if (entity !== 'account') {
    // Only an account cascades (C-3). A project, contact or opportunity archives
    // alone — nothing hangs off it that would be orphaned.
    const pipeline =
      entity === 'opportunity' ? await opportunityPipelineValue(supabase, [entityId]) : 0

    return {
      entity,
      id: entityId,
      name,
      children: { opportunities: 0, projects: 0, contacts: 0 },
      pipelineValueRemovedPaise: pipeline,
      activitiesRetained: await countActivities(supabase, entity, entityId),
    }
  }

  const [opportunities, projects, contacts, activities] = await Promise.all([
    supabase
      .from('opportunities')
      .select('id, estimated_value, stage')
      .eq('account_id', entityId)
      .is('archived_at', null),
    supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', entityId)
      .is('archived_at', null),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', entityId)
      .is('archived_at', null),
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', entityId),
  ])

  if (opportunities.error) throw fromPostgrestError(opportunities.error)

  const openOpportunities = (opportunities.data ?? []).filter(
    (row) => row.stage !== 'won' && row.stage !== 'lost',
  )

  return {
    entity,
    id: entityId,
    name,
    children: {
      opportunities: (opportunities.data ?? []).length,
      projects: projects.count ?? 0,
      contacts: contacts.count ?? 0,
    },
    pipelineValueRemovedPaise: openOpportunities.reduce(
      (total, row) => total + (row.estimated_value ?? 0),
      0,
    ),
    activitiesRetained: activities.count ?? 0,
  }
}

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>

async function opportunityPipelineValue(supabase: Db, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0
  const { data, error } = await supabase
    .from('opportunities')
    .select('estimated_value, stage')
    .in('id', ids as string[])

  if (error) throw fromPostgrestError(error)
  return (data ?? [])
    .filter((row) => row.stage !== 'won' && row.stage !== 'lost')
    .reduce((total, row) => total + (row.estimated_value ?? 0), 0)
}

async function countActivities(
  supabase: Db,
  entity: ArchivableEntity,
  id: string,
): Promise<number> {
  if (entity === 'contact') return 0

  const column = entity === 'opportunity' ? 'opportunity_id' : entity === 'project' ? 'project_id' : 'account_id'
  const { count, error } = await supabase
    .from('activities')
    .select('id', { count: 'exact', head: true })
    .eq(column, id)

  if (error) throw fromPostgrestError(error)
  return count ?? 0
}

export type ArchiveResult = {
  accounts: number
  opportunities: number
  projects: number
  contacts: number
}

/**
 * Step 4 of C-3: archive, as one operation.
 *
 * An account goes through the RPC, which stamps the account and all three child
 * types with the SAME instant — that shared timestamp is what lets `restore`
 * reverse exactly this operation and nothing else. Everything else is a
 * single-row update, where the RLS policy and `guard_record_scope()` are the
 * control.
 */
export async function archiveRecord(input: {
  entity: ArchivableEntity
  id: string
  reason?: string
}): Promise<ArchiveResult> {
  await requireArchiver()
  const { entity, id, reason } = archiveInputSchema.parse(input)
  const supabase = await createSupabaseServerClient()

  if (entity === 'account') {
    const { data, error } = await supabase
      .rpc('archive_account', { p_account_id: id, p_reason: reason ?? undefined })
      .single()

    if (error) throw fromPostgrestError(error)
    return {
      accounts: data.accounts,
      opportunities: data.opportunities,
      projects: data.projects,
      contacts: data.contacts,
    }
  }

  const user = await requireUser()

  // ADR-001: `opportunities` writes its ARCHIVED event from the trigger, reading
  // the reason from the transaction-local GUC. A single PostgREST update is its
  // own transaction, so the GUC has to travel with it — which PostgREST cannot
  // do. The reason is therefore recorded for accounts (through the RPC) and the
  // event is still written for a bare opportunity archive, without one. Noted in
  // /docs/DECISIONS.md rather than papered over.
  const { data, error } = await supabase
    .from(TABLE_FOR[entity])
    .update({ archived_at: new Date().toISOString(), archived_by: user.id })
    .eq('id', id)
    .is('archived_at', null)
    .select('id')

  if (error) throw fromPostgrestError(error)
  if (!data || data.length === 0) throw notFound(entity)

  return {
    accounts: 0,
    opportunities: entity === 'opportunity' ? 1 : 0,
    projects: entity === 'project' ? 1 : 0,
    contacts: entity === 'contact' ? 1 : 0,
  }
}

/** Restore. For an account, reverses exactly the cascade that archived it. */
export async function restoreRecord(input: {
  entity: ArchivableEntity
  id: string
  reason?: string
}): Promise<ArchiveResult> {
  await requireArchiver()
  const { entity, id, reason } = archiveInputSchema.parse(input)
  const supabase = await createSupabaseServerClient()

  if (entity === 'account') {
    const { data, error } = await supabase
      .rpc('restore_account', { p_account_id: id, p_reason: reason ?? undefined })
      .single()

    if (error) throw fromPostgrestError(error)
    return {
      accounts: data.accounts,
      opportunities: data.opportunities,
      projects: data.projects,
      contacts: data.contacts,
    }
  }

  // A child cannot come back while its customer is archived: it would be a live
  // opportunity on a customer nobody can see, counting towards pipeline value.
  if (entity === 'opportunity' || entity === 'project' || entity === 'contact') {
    // Narrowed by hand: `TABLE_FOR[entity]` still includes `accounts` as far as
    // the compiler is concerned, and `accounts` has no `account_id`.
    const childTable: 'opportunities' | 'projects' | 'contacts' =
      entity === 'opportunity' ? 'opportunities' : entity === 'project' ? 'projects' : 'contacts'

    const { data: parent, error: parentError } = await supabase
      .from(childTable)
      .select('account_id')
      .eq('id', id)
      .maybeSingle()

    if (parentError) throw fromPostgrestError(parentError)
    if (!parent) throw notFound(entity)

    if (parent.account_id) {
      const { data: account, error: accountError } = await supabase
        .from('accounts')
        .select('archived_at')
        .eq('id', parent.account_id)
        .maybeSingle()

      if (accountError) throw fromPostgrestError(accountError)
      if (account?.archived_at) {
        throw new AppError(
          'CONFLICT',
          'Restore the customer first — this record belongs to an archived customer.',
        )
      }
    }
  }

  const { data, error } = await supabase
    .from(TABLE_FOR[entity])
    .update({ archived_at: null, archived_by: null })
    .eq('id', id)
    .not('archived_at', 'is', null)
    .select('id')

  if (error) throw fromPostgrestError(error)
  if (!data || data.length === 0) throw notFound(entity)

  return {
    accounts: 0,
    opportunities: entity === 'opportunity' ? 1 : 0,
    projects: entity === 'project' ? 1 : 0,
    contacts: entity === 'contact' ? 1 : 0,
  }
}

export type ArchivedRecord = {
  id: string
  entity: ArchivableEntity
  name: string
  archivedAt: string
  archivedBy: string | null
}

/**
 * The `/archive` screen (§12.2).
 *
 * The one place in the application that deliberately does NOT filter
 * `archived_at is null` — it is the archive view CLAUDE.md §11 carves out.
 * Everything here is still subject to the same RLS policies, so a manager sees
 * archived records from their outlets and no others.
 */
export async function listArchived(
  entity: ArchivableEntity,
  page: PageParams,
): Promise<Paginated<ArchivedRecord>> {
  await requireArchiver()
  const supabase = await createSupabaseServerClient()
  const { from, to } = pageRange(page)

  const { data, error, count } = await supabase
    .from(TABLE_FOR[entity])
    .select(`id, ${NAME_COLUMN[entity]}, archived_at, archived_by` as '*', { count: 'exact' })
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })
    .range(from, to)

  if (error) throw fromPostgrestError(error)

  const rows = (data ?? []).map((row) => {
    const record = row as unknown as Record<string, string | null>
    return {
      id: record.id as string,
      entity,
      name: (record[NAME_COLUMN[entity]] as string) ?? '',
      archivedAt: record.archived_at as string,
      archivedBy: record.archived_by,
    }
  })

  return paginate(rows, count ?? 0, page)
}
