-- 025 — operations: archive, merge, import execution and rollback (Master Phase 4)
--
-- Four multi-table writes, each one transaction (§16.3). None of them creates a
-- table: §4.1's eleven stand, and §21 of the phase brief rejects a merge-history
-- subsystem, an attachments table and a notifications table explicitly.
--
-- Read the SECURITY INVOKER / SECURITY DEFINER choice on each function as part of
-- its contract. Where a function is DEFINER, the comment says which rule it is
-- standing in for and what it checks instead; a DEFINER function with no explicit
-- role check is a privilege-escalation hole, and there is none here.

-- ------------------------------------------------ the rollback window (§20.6) ----
-- Seven days, in ONE place. Two callers need to agree on it — `rollback_import`,
-- which refuses an expired batch, and the nightly maintenance job, which must
-- leave records inside the window untouched (H-09). A second literal is how those
-- two come to disagree.
--
-- This is a specification constant (§20.6), not a business decision: it is not
-- one of the twelve TODO-BD values and has no `system_settings` key (CLAUDE.md §3
-- lists the keys exhaustively). If the business ever wants to tune it, that is a
-- new settings key and a `/docs/DECISIONS.md` entry — not an edit here.
create or replace function public.import_rollback_days() returns integer
language sql immutable parallel safe
set search_path = ''
as $$ select 7 $$;

comment on function public.import_rollback_days() is
  'The §20.6 import rollback window, in days. The single definition; see H-09.';

-- ------------------------------------------------------- MERGED audit event ----
-- Extends 013's trigger — which remains the SINGLE WRITER of `opportunity_events`
-- (CLAUDE.md §13) — to cover the one change 013 did not anticipate: an
-- opportunity moving between accounts.
--
-- Nothing but `merge_accounts` moves an opportunity between accounts, so any
-- `account_id` change IS a merge and is logged as one. Source, target and the
-- reason travel in `metadata`, which is the audit ADR-008 requires given that the
-- merge itself cannot be undone.
create or replace function public.log_opportunity_event() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(coalesce(current_setting('app.event_reason', true), '')), '');
  v_actor  uuid;
begin
  if TG_OP = 'INSERT' then
    v_actor := coalesce(auth.uid(), new.created_by, public.system_user_id());
    insert into public.opportunity_events
      (opportunity_id, event_type, to_stage, to_owner_id, actor_id, reason)
    values (new.id, 'CREATED', new.stage, new.owner_id, v_actor, v_reason);
    return new;
  end if;

  v_actor := coalesce(auth.uid(), public.system_user_id());

  if new.stage is distinct from old.stage then
    insert into public.opportunity_events
      (opportunity_id, event_type, from_stage, to_stage, actor_id, reason)
    values (
      new.id,
      -- The cast is required, not cosmetic: a CASE whose branches are all
      -- string literals resolves to `text`, and PostgreSQL has no implicit
      -- text-to-enum cast, so without it every stage change is rejected.
      (case
        when new.stage = 'won'  then 'WON'
        when new.stage = 'lost' then 'LOST'
        -- ADR-007: the only exit from `won` is the MANAGER/OWNER reopen to
        -- `qualified`. The historical WON event is never deleted or rewritten.
        when old.stage = 'won'  then 'REOPENED'
        else 'STAGE_CHANGED'
      end)::public.opportunity_event_type,
      old.stage, new.stage, v_actor, v_reason);
  end if;

  if new.owner_id is distinct from old.owner_id then
    insert into public.opportunity_events
      (opportunity_id, event_type, from_owner_id, to_owner_id, actor_id, reason)
    values (new.id, 'OWNER_CHANGED', old.owner_id, new.owner_id, v_actor, v_reason);
  end if;

  if new.archived_at is distinct from old.archived_at then
    insert into public.opportunity_events
      (opportunity_id, event_type, actor_id, reason)
    values (new.id,
            (case when new.archived_at is not null then 'ARCHIVED' else 'RESTORED' end)
              ::public.opportunity_event_type,
            v_actor, v_reason);
  end if;

  -- ADR-008. The merge is one-way, so this row is the only record of where the
  -- opportunity came from.
  if new.account_id is distinct from old.account_id then
    insert into public.opportunity_events
      (opportunity_id, event_type, actor_id, reason, metadata)
    values (new.id, 'MERGED', v_actor, v_reason,
            jsonb_build_object('from_account_id', old.account_id,
                               'to_account_id',   new.account_id));
  end if;

  return new;
end
$$;

-- ------------------------------------------------------------------ archive ----
-- §8.8, C-3/M-06: preview → display → confirm → archive, and the archive is ONE
-- controlled operation over the account and its explicitly defined children —
-- opportunities, projects and contacts.
--
-- ACTIVITIES AND OPPORTUNITY EVENTS ARE NEVER ARCHIVED. They are history, and
-- leaving them is exactly what preserves §8.8's promise that an archived record
-- "retains all relationships and activities".
--
-- All four tables are stamped with the SAME `archived_at` instant. That timestamp
-- is what `restore_account` uses to reverse precisely this operation and nothing
-- else: a contact archived on its own last month keeps a different timestamp and
-- stays archived when the account comes back. Without it, restore would silently
-- resurrect records nobody asked for.
--
-- SECURITY INVOKER: every policy in 016 applies, and `guard_record_scope()`
-- refuses anyone below MANAGER. The RPC buys atomicity, not authority.
create or replace function public.archive_account(p_account_id uuid, p_reason text default null)
returns table (accounts integer, opportunities integer, projects integer, contacts integer)
language plpgsql
set search_path = ''
as $$
declare
  v_now      timestamptz := now();
  v_actor    uuid := public.current_user_id();
  v_accounts integer;
  v_opps     integer;
  v_projects integer;
  v_contacts integer;
  v_orphans  integer;
begin
  if v_actor is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;

  -- ADR-001: the reason reaches `opportunity_events` through the GUC, so the
  -- trigger stays the single writer. Transaction-local, so it cannot leak between
  -- requests on a pooled connection.
  perform set_config('app.event_reason', coalesce(p_reason, ''), true);

  update public.accounts
     set archived_at = v_now, archived_by = v_actor
   where id = p_account_id and archived_at is null;
  get diagnostics v_accounts = row_count;

  if v_accounts = 0 then
    -- Already archived, or invisible, or absent — the same answer for all three
    -- (§25, M-03).
    perform public.raise_not_found();
  end if;

  update public.opportunities
     set archived_at = v_now, archived_by = v_actor
   where account_id = p_account_id and archived_at is null;
  get diagnostics v_opps = row_count;

  update public.projects
     set archived_at = v_now, archived_by = v_actor
   where account_id = p_account_id and archived_at is null;
  get diagnostics v_projects = row_count;

  update public.contacts
     set archived_at = v_now, archived_by = v_actor
   where account_id = p_account_id and archived_at is null;
  get diagnostics v_contacts = row_count;

  -- A child the caller cannot see would be skipped SILENTLY by the four
  -- statements above — row-level security simply does not offer them the row —
  -- leaving an archived customer with a live opportunity still counting towards
  -- pipeline value. That is the trust failure Phase 16 names. Count without RLS
  -- and refuse the whole operation rather than half-doing it.
  select public.count_live_account_children(p_account_id) into v_orphans;
  if v_orphans > 0 then
    raise exception 'This customer has records outside your scope. Ask the owner to archive it.'
      using errcode = '42501';
  end if;

  return query select v_accounts, v_opps, v_projects, v_contacts;
end
$$;

-- Counts children that are still live, ignoring row-level security.
--
-- SECURITY DEFINER, and it returns a COUNT rather than rows: the caller learns
-- "something you cannot see is attached to this", which is what makes the refusal
-- above honest, and learns nothing about what it is.
create or replace function public.count_live_account_children(p_account_id uuid) returns integer
language sql stable security definer
set search_path = ''
as $$
  select (select count(*) from public.opportunities where account_id = p_account_id and archived_at is null)
       + (select count(*) from public.projects      where account_id = p_account_id and archived_at is null)
       + (select count(*) from public.contacts      where account_id = p_account_id and archived_at is null)
$$;

comment on function public.count_live_account_children(uuid) is
  'How many un-archived children an account still has, ignoring RLS. Makes a partial archive impossible (C-3).';

-- Reverses exactly what `archive_account` did, identified by the shared instant.
create or replace function public.restore_account(p_account_id uuid, p_reason text default null)
returns table (accounts integer, opportunities integer, projects integer, contacts integer)
language plpgsql
set search_path = ''
as $$
declare
  v_actor    uuid := public.current_user_id();
  v_stamp    timestamptz;
  v_accounts integer;
  v_opps     integer;
  v_projects integer;
  v_contacts integer;
begin
  if v_actor is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;

  perform set_config('app.event_reason', coalesce(p_reason, ''), true);

  select a.archived_at into v_stamp
    from public.accounts a where a.id = p_account_id;

  if v_stamp is null then
    perform public.raise_not_found();
  end if;

  update public.accounts
     set archived_at = null, archived_by = null
   where id = p_account_id;
  get diagnostics v_accounts = row_count;

  if v_accounts = 0 then
    perform public.raise_not_found();
  end if;

  update public.opportunities
     set archived_at = null, archived_by = null
   where account_id = p_account_id and archived_at = v_stamp;
  get diagnostics v_opps = row_count;

  update public.projects
     set archived_at = null, archived_by = null
   where account_id = p_account_id and archived_at = v_stamp;
  get diagnostics v_projects = row_count;

  update public.contacts
     set archived_at = null, archived_by = null
   where account_id = p_account_id and archived_at = v_stamp;
  get diagnostics v_contacts = row_count;

  return query select v_accounts, v_opps, v_projects, v_contacts;
end
$$;

-- -------------------------------------------------------------------- merge ----
-- Manual account merge, MANAGER/OWNER only (§8.9).
--
-- ADR-008: THIS IS NOT REVERSIBLE IN V1. Nothing here pretends otherwise and the
-- UI must not either. What it does guarantee is that the move is fully recorded:
-- every moved opportunity gets a `MERGED` event carrying source, target and
-- reason, written by 013's trigger.
--
-- SECURITY DEFINER — and here is exactly why, because a DEFINER function without
-- a stated reason is a hole:
--
--   `activities` is append-only with a 24-hour author-only edit window (§5.8).
--   A manager has NO update path to it, by design. But an activity is keyed to
--   `account_id`, and a merge that left the activities behind would strand the
--   customer's entire history on a record that is about to be archived — the
--   Customer 360 timeline the whole system exists to produce (§1.2) would come up
--   empty for the surviving customer.
--
--   So this function does something the caller genuinely cannot do directly, in
--   the same sense as `touch_last_activity_at` (ADR-020). It is not a way to edit
--   an activity: `performed_by`, `summary`, `occurred_at` and every other column
--   are untouched, and history is not rewritten (§8.1) — the activity still
--   records who did what, when. Only the customer it hangs off moves.
--
-- The role and visibility checks below replace the policies that DEFINER skips.
-- They are the authorization for this function, and they run first.
create or replace function public.merge_accounts(
  p_source_id uuid,
  p_target_id uuid,
  p_reason    text default null
)
returns table (contacts integer, projects integer, opportunities integer, activities integer)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor    uuid := public.current_user_id();
  v_contacts integer;
  v_projects integer;
  v_opps     integer;
  v_acts     integer;
begin
  if v_actor is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;

  if p_source_id = p_target_id then
    raise exception 'A customer cannot be merged into itself.' using errcode = '22023';
  end if;

  -- §8.9 and `canArchive`/`canReassign`: merge is a management action.
  if not public.is_manager_or_above() then
    raise exception 'Only a manager or the owner may merge customers.' using errcode = '42501';
  end if;

  -- Both records must be visible to the caller. Without this a manager could
  -- merge a record from an outlet they do not manage into one they do, which is
  -- a way to read another outlet's data — the DEFINER context makes that check
  -- this function's responsibility rather than the policy's.
  if not public.can_read_account(p_source_id) or not public.can_read_account(p_target_id) then
    perform public.raise_not_found();
  end if;

  if exists (select 1 from public.accounts
              where id in (p_source_id, p_target_id) and archived_at is not null) then
    raise exception 'An archived customer cannot take part in a merge.' using errcode = '22023';
  end if;

  perform set_config('app.event_reason', coalesce(p_reason, ''), true);

  update public.contacts set account_id = p_target_id
   where account_id = p_source_id;
  get diagnostics v_contacts = row_count;

  update public.contacts set linked_account_id = p_target_id
   where linked_account_id = p_source_id;

  update public.projects set account_id = p_target_id
   where account_id = p_source_id;
  get diagnostics v_projects = row_count;

  -- Fires 013's trigger once per row: one MERGED event each, carrying source and
  -- target (ADR-008).
  update public.opportunities set account_id = p_target_id
   where account_id = p_source_id;
  get diagnostics v_opps = row_count;

  update public.activities set account_id = p_target_id
   where account_id = p_source_id;
  get diagnostics v_acts = row_count;

  -- The source is archived, never deleted (CLAUDE.md §11). Its children have all
  -- moved, so nothing is left to cascade to.
  update public.accounts
     set archived_at = now(), archived_by = v_actor
   where id = p_source_id;

  -- Recency on the surviving record has to account for the history it just
  -- absorbed, or a merged-in customer looks stale the moment they are merged.
  update public.accounts t
     set last_activity_at = greatest(t.last_activity_at, s.last_activity_at)
    from public.accounts s
   where t.id = p_target_id and s.id = p_source_id
     and s.last_activity_at is not null;

  return query select v_contacts, v_projects, v_opps, v_acts;
end
$$;

-- ------------------------------------------------------------ import execute ----
-- §20.5. ONE TRANSACTION PER BATCH. Any unhandled error rolls the whole batch
-- back, which is the guarantee ADR-012 chose over live per-100-row progress:
-- reporting progress for a transaction that has not committed is reporting
-- something that may never have happened.
--
-- Called by the import executor through the service-role client (§15.7, ADR-009),
-- which is why there is no role check here — `import.service.ts` performs the
-- OWNER/ADMIN check BEFORE it reaches for the admin client, and reversing that
-- order is the hole ADR-009 exists to prevent.
--
-- Every created row carries `is_imported`, `import_batch_id` and `legacy_ref`.
-- That is not bookkeeping: it is what makes rollback possible, and
-- `is_imported` is what keeps a 1998 paper-register customer out of the
-- new-enquiry SLA queue for ever (§20.5's "no automations fire during import").
create or replace function public.execute_import(p_batch_id uuid)
returns table (imported integer, skipped integer, linked integer)
language plpgsql
set search_path = ''
as $$
declare
  v_entity   text;
  v_status   public.import_status;
  v_row      record;
  v_n        jsonb;
  v_new_id   uuid;
  v_imported integer := 0;
  v_skipped  integer := 0;
  v_linked   integer := 0;
begin
  select entity, status into v_entity, v_status
    from public.import_batches where id = p_batch_id
    for update;

  if v_entity is null then
    perform public.raise_not_found();
  end if;

  if v_status <> 'REVIEW' then
    raise exception 'This batch is not ready to import.' using errcode = '22023';
  end if;

  -- §20.4: a row the reviewer has not ruled on BLOCKS the batch. Not a warning,
  -- not a default to IMPORT — the whole point of the review step is that a human
  -- decided, and defaulting would quietly create the duplicates the step exists
  -- to prevent.
  if exists (
    select 1 from public.import_rows
     where batch_id = p_batch_id
       and status in ('DUPLICATE_EXACT','DUPLICATE_POSSIBLE')
       and decision is null
  ) then
    raise exception 'Every possible duplicate needs a decision before this batch can be imported.'
      using errcode = '22023';
  end if;

  for v_row in
    select * from public.import_rows
     where batch_id = p_batch_id
     order by row_number
  loop
    v_n := v_row.normalized;

    -- An invalid row is never imported. It was reported at validation and is
    -- recorded here as skipped so the result summary adds up.
    if v_row.status = 'ERROR' then
      update public.import_rows set status = 'SKIPPED' where id = v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_row.status in ('DUPLICATE_EXACT','DUPLICATE_POSSIBLE') then
      if v_row.decision = 'SKIP' then
        update public.import_rows set status = 'SKIPPED' where id = v_row.id;
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if v_row.decision = 'LINK_EXISTING' then
        -- §20.4: "discard the row and record `legacy_ref` on the existing
        -- record". NEVER OVERWRITE AN EXISTING RECORD'S FIELDS — and that
        -- includes a `legacy_ref` it already carries, so the coalesce is the
        -- rule, not a nicety.
        if v_entity = 'accounts' then
          update public.accounts
             set legacy_ref = coalesce(legacy_ref, v_n ->> 'legacy_ref')
           where id = v_row.duplicate_of;
        elsif v_entity = 'contacts' then
          update public.contacts
             set legacy_ref = coalesce(legacy_ref, v_n ->> 'legacy_ref')
           where id = v_row.duplicate_of;
        end if;

        -- `created_entity_id` points at the record it was linked to, so the link
        -- is auditable afterwards. The row created nothing, so it is SKIPPED.
        update public.import_rows
           set status = 'SKIPPED', created_entity_id = v_row.duplicate_of
         where id = v_row.id;
        v_linked := v_linked + 1;
        continue;
      end if;
    end if;

    -- VALID, WARNING, or a duplicate the reviewer chose to IMPORT anyway.
    if v_entity = 'accounts' then
      insert into public.accounts
        (name, account_type, phone, email, address, city, area, source, notes,
         status, owner_id, outlet_id, legacy_ref, is_imported, import_batch_id, created_by)
      values (
        v_n ->> 'name',
        (v_n ->> 'account_type')::public.account_type,
        v_n ->> 'phone',
        v_n ->> 'email',
        v_n ->> 'address',
        v_n ->> 'city',
        v_n ->> 'area',
        coalesce((v_n ->> 'source')::public.lead_source, 'OTHER'),
        v_n ->> 'notes',
        coalesce((v_n ->> 'status')::public.account_status, 'PROSPECT'),
        (v_n ->> 'owner_id')::uuid,
        (v_n ->> 'outlet_id')::uuid,
        v_n ->> 'legacy_ref',
        true, p_batch_id, public.system_user_id())
      returning id into v_new_id;

    elsif v_entity = 'contacts' then
      insert into public.contacts
        (full_name, account_id, phone, email, role, influence, is_referral_source,
         notes, owner_id, legacy_ref, is_imported, import_batch_id, created_by)
      values (
        v_n ->> 'full_name',
        (v_n ->> 'account_id')::uuid,
        v_n ->> 'phone',
        v_n ->> 'email',
        coalesce((v_n ->> 'role')::public.stakeholder_role, 'OTHER'),
        coalesce((v_n ->> 'influence')::public.influence_level, 'INFLUENCER'),
        coalesce((v_n ->> 'is_referral_source')::boolean, false),
        v_n ->> 'notes',
        (v_n ->> 'owner_id')::uuid,
        v_n ->> 'legacy_ref',
        true, p_batch_id, public.system_user_id())
      returning id into v_new_id;

    else
      -- TODO-BD-10: accounts and contacts only in V1. `import_batches.entity`
      -- accepts projects and opportunities so the templates can be added later
      -- with no schema change (§20.2) — but nothing here invents that import.
      raise exception 'Importing % is not supported in this version.', v_entity
        using errcode = '22023';
    end if;

    update public.import_rows
       set status = 'IMPORTED', created_entity_id = v_new_id
     where id = v_row.id;
    v_imported := v_imported + 1;
  end loop;

  update public.import_batches
     set status = 'COMPLETED',
         imported_rows = v_imported,
         completed_at = now()
   where id = p_batch_id;

  return query select v_imported, v_skipped, v_linked;
end
$$;

-- ----------------------------------------------------------- import rollback ----
-- §20.6. OWNER only, within seven days, and only while nothing imported has been
-- edited. ARCHIVES — never deletes (CLAUDE.md §11).
--
-- "Has been edited" is `updated_at > completed_at`: an imported row's
-- `updated_at` is stamped at import and only `touch_updated_at` moves it
-- afterwards. That makes the test exact, and it is also why the nightly
-- maintenance job must leave records inside this window alone (H-09) — a
-- maintenance write would look identical to a user's edit and would silently cost
-- the business its ability to undo a bad import.
create or replace function public.rollback_import(p_batch_id uuid)
returns table (accounts integer, contacts integer)
language plpgsql
set search_path = ''
as $$
declare
  v_status    public.import_status;
  v_completed timestamptz;
  v_actor     uuid := coalesce(public.current_user_id(), public.system_user_id());
  v_accounts  integer;
  v_contacts  integer;
begin
  select status, completed_at into v_status, v_completed
    from public.import_batches where id = p_batch_id
    for update;

  if v_status is null then
    perform public.raise_not_found();
  end if;

  if v_status <> 'COMPLETED' then
    raise exception 'Only a completed import can be rolled back.' using errcode = '22023';
  end if;

  if v_completed < now() - (public.import_rollback_days() || ' days')::interval then
    raise exception 'This import is older than % days and can no longer be rolled back.',
      public.import_rollback_days() using errcode = '22023';
  end if;

  if exists (
    select 1 from public.accounts
     where import_batch_id = p_batch_id and updated_at > v_completed
    union all
    select 1 from public.contacts
     where import_batch_id = p_batch_id and updated_at > v_completed
  ) then
    raise exception 'Some imported records have been edited since the import. Roll back is no longer safe.'
      using errcode = '22023';
  end if;

  update public.accounts
     set archived_at = now(), archived_by = v_actor
   where import_batch_id = p_batch_id and archived_at is null;
  get diagnostics v_accounts = row_count;

  update public.contacts
     set archived_at = now(), archived_by = v_actor
   where import_batch_id = p_batch_id and archived_at is null;
  get diagnostics v_contacts = row_count;

  update public.import_batches set status = 'ROLLED_BACK' where id = p_batch_id;

  return query select v_accounts, v_contacts;
end
$$;

-- §15.1 — a new function is created with EXECUTE granted to PUBLIC by default.
revoke execute on function
  public.import_rollback_days(),
  public.count_live_account_children(uuid),
  public.archive_account(uuid, text),
  public.restore_account(uuid, text),
  public.merge_accounts(uuid, uuid, text),
  public.execute_import(uuid),
  public.rollback_import(uuid)
from public, anon;

grant execute on function
  public.import_rollback_days(),
  public.count_live_account_children(uuid),
  public.archive_account(uuid, text),
  public.restore_account(uuid, text),
  public.merge_accounts(uuid, uuid, text)
to authenticated, service_role;

-- The import executor reaches these through the service-role client only
-- (§15.7, ADR-009). `authenticated` is deliberately absent: a direct PostgREST
-- call from a signed-in OWNER must not be able to run an import outside the
-- service that validates it.
grant execute on function
  public.execute_import(uuid),
  public.rollback_import(uuid)
to service_role;
