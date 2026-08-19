-- 019 — the multi-table write RPCs (§16.3)
--
-- "Multi-table writes use a Postgres RPC (SECURITY INVOKER, so RLS still
-- applies) rather than sequential client calls." Every function here is
-- SECURITY INVOKER: it runs as the caller, every policy in 016 is evaluated for
-- real, and a salesperson calling one against somebody else's record gets
-- nothing. The RPC buys ATOMICITY, not authority.
--
-- What is deliberately NOT here:
--   * the stage transition matrix — it lives in `lib/opportunity/transitions.ts`
--     and is validated there (CLAUDE.md §13). Restating it in SQL would be the
--     same rule in two places, which is how the two come to disagree.
--   * the opportunity title format (§8.4) — generated in the service, editable
--     by the user, and unit-tested.
--   * any threshold, probability or controlled list — those come from
--     `system_settings` through the settings service (CLAUDE.md §3).
--
-- The check constraints on `opportunities` remain the backstop. Nothing below
-- relaxes them; where a function looks like it is enforcing one, it is choosing
-- WHICH value to write, and the constraint still decides whether the row is legal.

-- A record the caller cannot see and a record that does not exist are the same
-- answer (§25, M-03). Raised as `no_data_found`, mapped to NOT_FOUND in
-- `lib/errors.ts`, and never distinguished for the caller.
create or replace function public.raise_not_found() returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  raise exception 'That record no longer exists, or you cannot see it.'
    using errcode = 'P0002';
end
$$;

-- ------------------------------------------- create account + opportunity ----
-- §11.1, the primary mobile flow, target 60 seconds.
--
-- One transaction: account → opportunity → opening activity. The trigger in 013
-- writes `opportunity_events.CREATED` on the way through. No project is created
-- here; projects arrive when site details are known.
create or replace function public.create_account_with_opportunity(
  p_name               text,
  p_account_type       public.account_type,
  p_outlet_id          uuid,
  p_category           public.product_category,
  p_estimated_value    bigint,
  p_title              text,
  p_phone              text default null,
  p_email              text default null,
  p_city               text default null,
  p_area               text default null,
  p_address            text default null,
  p_source             public.lead_source default 'WALK_IN',
  p_notes              text default null,
  p_next_action        public.next_action_type default null,
  p_next_action_date   date default null,
  p_next_action_note   text default null,
  p_expected_close_date date default null,
  p_material_notes     text default null,
  p_project_id         uuid default null
) returns table (account_id uuid, opportunity_id uuid, activity_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_actor    uuid := public.current_user_id();
  v_account  uuid;
  v_opp      uuid;
  v_activity uuid;
begin
  if v_actor is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;

  insert into public.accounts
    (name, account_type, phone, email, city, area, address, source, notes,
     owner_id, outlet_id, status, created_by)
  values
    (p_name, p_account_type, p_phone, p_email, p_city, p_area, p_address, p_source, p_notes,
     v_actor, p_outlet_id, 'PROSPECT', v_actor)
  returning id into v_account;

  insert into public.opportunities
    (title, account_id, project_id, owner_id, stage, category, estimated_value,
     material_notes, expected_close_date, next_action, next_action_date, next_action_note,
     source, outlet_id, created_by)
  values
    (p_title, v_account, p_project_id, v_actor, 'new', p_category, p_estimated_value,
     p_material_notes, p_expected_close_date, p_next_action, p_next_action_date, p_next_action_note,
     p_source, p_outlet_id, v_actor)
  returning id into v_opp;

  -- §11.1 — the enquiry itself is the first thing that happened, so it is
  -- recorded as history rather than left implicit in `created_at`.
  insert into public.activities
    (account_id, opportunity_id, project_id, type, purpose, outcome, summary, performed_by, created_by)
  values
    (v_account, v_opp, p_project_id, 'NOTE', 'ENQUIRY', 'NEUTRAL',
     coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'Enquiry captured'), v_actor, v_actor)
  returning id into v_activity;

  return query select v_account, v_opp, v_activity;
end
$$;

-- ------------------------------------------------------------ log activity ----
-- §10.2. One transaction: insert the activity, then apply the next-action
-- decision from the same form.
--
-- `accounts.last_activity_at` and `opportunities.last_activity_at` are NOT
-- touched here: migration 018's trigger maintains them, because a work-context
-- salesperson may log the activity without being able to update the parent row.
--
-- The next-action decision has three shapes and the third is the important one:
--   type + date given   → set them
--   p_clear_next_action → clear both, and the opportunity surfaces in the
--                         "Missing next action" exception list (§8.3)
--   neither             → leave the opportunity's next action exactly as it was
--
-- A closed opportunity is never given a next action, whatever the form said.
create or replace function public.log_activity(
  p_account_id        uuid,
  p_type              public.activity_type,
  p_summary           text,
  p_purpose           public.activity_purpose default 'FOLLOW_UP',
  p_outcome           public.activity_outcome default 'NEUTRAL',
  p_opportunity_id    uuid default null,
  p_project_id        uuid default null,
  p_contact_id        uuid default null,
  p_occurred_at       timestamptz default now(),
  p_duration_minutes  smallint default null,
  p_measurements      text default null,
  p_location_note     text default null,
  p_next_action       public.next_action_type default null,
  p_next_action_date  date default null,
  p_next_action_note  text default null,
  p_clear_next_action boolean default false
) returns table (activity_id uuid, opportunity_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_actor    uuid := public.current_user_id();
  v_activity uuid;
  v_stage    public.opportunity_stage;
begin
  if v_actor is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;

  insert into public.activities
    (account_id, opportunity_id, project_id, contact_id, type, purpose, outcome, summary,
     occurred_at, duration_minutes, measurements, location_note, performed_by, created_by)
  values
    (p_account_id, p_opportunity_id, p_project_id, p_contact_id, p_type, p_purpose, p_outcome,
     p_summary, p_occurred_at, p_duration_minutes, p_measurements, p_location_note, v_actor, v_actor)
  returning id into v_activity;

  if p_opportunity_id is not null then
    select o.stage into v_stage
      from public.opportunities o
     where o.id = p_opportunity_id and o.archived_at is null;

    if v_stage is not null and v_stage not in ('won', 'lost') then
      if p_clear_next_action then
        update public.opportunities
           set next_action = null, next_action_date = null, next_action_note = null
         where id = p_opportunity_id;
      elsif p_next_action is not null and p_next_action_date is not null then
        update public.opportunities
           set next_action = p_next_action,
               next_action_date = p_next_action_date,
               next_action_note = p_next_action_note
         where id = p_opportunity_id;
      end if;
    end if;
  end if;

  return query select v_activity, p_opportunity_id;
end
$$;

-- --------------------------------------------------- change opportunity stage ----
-- §9.3 side effects, applied atomically with the stage change itself.
--
-- The transition's LEGALITY was decided before this was called, against the
-- matrix in `lib/opportunity/transitions.ts`. What happens here is the write and
-- the field housekeeping that must not be able to half-happen: a `won` that sets
-- `closed_at` but forgets to clear the next action would leave a closed
-- opportunity sitting in somebody's overdue list forever.
create or replace function public.change_opportunity_stage(
  p_opportunity_id     uuid,
  p_to_stage           public.opportunity_stage,
  p_reason             text default null,
  p_quotation_ref      text default null,
  p_quotation_date     date default null,
  p_quoted_value       bigint default null,
  p_final_order_value  bigint default null,
  p_order_reference    text default null,
  p_lost_reason        public.lost_reason default null,
  p_lost_detail        text default null,
  p_competitor         text default null,
  p_next_action        public.next_action_type default null,
  p_next_action_date   date default null,
  p_next_action_note   text default null
) returns public.opportunities
language plpgsql
set search_path = ''
as $$
declare
  v_old public.opportunities;
  v_new public.opportunities;
begin
  select * into v_old
    from public.opportunities
   where id = p_opportunity_id and archived_at is null;

  if not found then
    perform public.raise_not_found();
  end if;

  -- ADR-001: the trigger in 013 is the single writer of the audit trail, and
  -- this is how the reason reaches it. `true` scopes the setting to this
  -- transaction, so it cannot leak to the next request on a pooled connection.
  perform set_config('app.event_reason', coalesce(p_reason, ''), true);

  update public.opportunities set
    stage = p_to_stage,

    -- §9.3 `quoted`: the quotation fields are required by
    -- `quoted_requires_quotation`. Coalesce so a re-entry into `quoted` does not
    -- have to resend values the record already holds.
    quotation_ref  = case when p_to_stage = 'quoted'
                          then coalesce(p_quotation_ref, quotation_ref) else quotation_ref end,
    quotation_date = case when p_to_stage = 'quoted'
                          then coalesce(p_quotation_date, quotation_date) else quotation_date end,
    quoted_value   = case when p_to_stage = 'quoted'
                          then coalesce(p_quoted_value, quoted_value) else quoted_value end,
    quotation_status = case
                         when p_to_stage = 'quoted' and quotation_status = 'NONE' then 'SENT'
                         else quotation_status
                       end,

    -- §9.3 `won`. Reopening (ADR-007) is the mirror image: the value and the
    -- close date are cleared, while the historical WON event stays untouched.
    final_order_value = case
                          when p_to_stage = 'won' then coalesce(p_final_order_value, final_order_value)
                          when v_old.stage = 'won' then null
                          else final_order_value
                        end,
    order_reference   = case
                          when p_to_stage = 'won' then coalesce(p_order_reference, order_reference)
                          when v_old.stage = 'won' then null
                          else order_reference
                        end,

    -- §9.3 `lost`. Reopening a lost opportunity clears the reason with it: the
    -- constraint only binds while the stage is `lost`, so a stale reason left
    -- behind would report as a real one.
    lost_reason = case
                    when p_to_stage = 'lost' then coalesce(p_lost_reason, lost_reason)
                    when v_old.stage = 'lost' then null
                    else lost_reason
                  end,
    lost_detail = case
                    when p_to_stage = 'lost' then coalesce(p_lost_detail, lost_detail)
                    when v_old.stage = 'lost' then null
                    else lost_detail
                  end,
    competitor  = case when p_to_stage = 'lost' then coalesce(p_competitor, competitor)
                       else competitor end,

    closed_at = case
                  when p_to_stage in ('won', 'lost') then coalesce(closed_at, now())
                  else null
                end,

    -- Closing clears the next action (§8.7); everything else keeps what the
    -- caller supplied, or what was already there.
    next_action      = case when p_to_stage in ('won', 'lost') then null
                            else coalesce(p_next_action, next_action) end,
    next_action_date = case when p_to_stage in ('won', 'lost') then null
                            else coalesce(p_next_action_date, next_action_date) end,
    next_action_note = case when p_to_stage in ('won', 'lost') then null
                            else coalesce(p_next_action_note, next_action_note) end
  where id = p_opportunity_id
  returning * into v_new;

  -- The USING clause of `opportunities_update` hid the row: the caller may read
  -- this opportunity but may not change it.
  if not found then
    raise exception 'You do not have permission to change this opportunity.'
      using errcode = '42501';
  end if;

  return v_new;
end
$$;

-- ------------------------------------------------------------ reassign one ----
-- §11.9, single reassignment. MANAGER/OWNER only — enforced by
-- `opportunities_update`, whose WITH CHECK a salesperson cannot satisfy once
-- `owner_id` names somebody else.
--
-- This exists as an RPC rather than a plain update for one reason: ADR-001 sends
-- the reason to the audit trigger through a transaction-local GUC, and PostgREST
-- gives each statement its own transaction. A `set_config` in one request and an
-- update in the next would record every reassignment with an empty reason.
--
-- Activities are NOT touched. They keep their original `performed_by` (§8.1):
-- moving the deal does not rewrite who made the calls.
create or replace function public.reassign_opportunity(
  p_opportunity_id uuid,
  p_to_user        uuid,
  p_reason         text
) returns public.opportunities
language plpgsql
set search_path = ''
as $$
declare
  v_new public.opportunities;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required to reassign work.' using errcode = '23514';
  end if;

  if not exists (select 1 from public.opportunities where id = p_opportunity_id and archived_at is null) then
    perform public.raise_not_found();
  end if;

  perform set_config('app.event_reason', p_reason, true);

  update public.opportunities
     set owner_id = p_to_user
   where id = p_opportunity_id and archived_at is null
  returning * into v_new;

  if not found then
    raise exception 'You do not have permission to reassign this opportunity.'
      using errcode = '42501';
  end if;

  return v_new;
end
$$;

-- -------------------------------------------------------------- bulk reassign ----
-- §11.9. MANAGER/OWNER only — enforced by `opportunities_update`, which a
-- salesperson's session cannot satisfy for somebody else's row, so this returns 0
-- for them rather than moving anything.
--
-- Active opportunities only: reassigning a closed deal rewrites history for no
-- operational gain. Activities keep their original `performed_by` (§8.1) — this
-- function does not touch them, and nothing else may either.
create or replace function public.bulk_reassign(
  p_from_user uuid,
  p_to_user   uuid,
  p_reason    text
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required to reassign work.' using errcode = '23514';
  end if;

  perform set_config('app.event_reason', p_reason, true);

  with moved as (
    update public.opportunities
       set owner_id = p_to_user
     where owner_id is not distinct from p_from_user
       and archived_at is null
       and stage not in ('won', 'lost')
    returning 1)
  select count(*) into v_count from moved;

  return v_count;
end
$$;

-- §15.1 — revoke from anon, grant to authenticated. Repeated per migration
-- because a new function is created with EXECUTE granted to PUBLIC by default,
-- and 015's blanket statement only covered what existed when it ran.
revoke execute on function
  public.raise_not_found(),
  public.create_account_with_opportunity(text, public.account_type, uuid, public.product_category,
    bigint, text, text, text, text, text, text, public.lead_source, text, public.next_action_type,
    date, text, date, text, uuid),
  public.log_activity(uuid, public.activity_type, text, public.activity_purpose,
    public.activity_outcome, uuid, uuid, uuid, timestamptz, smallint, text, text,
    public.next_action_type, date, text, boolean),
  public.change_opportunity_stage(uuid, public.opportunity_stage, text, text, date, bigint, bigint,
    text, public.lost_reason, text, text, public.next_action_type, date, text),
  public.reassign_opportunity(uuid, uuid, text),
  public.bulk_reassign(uuid, uuid, text)
from public, anon;

grant execute on function
  public.raise_not_found(),
  public.create_account_with_opportunity(text, public.account_type, uuid, public.product_category,
    bigint, text, text, text, text, text, text, public.lead_source, text, public.next_action_type,
    date, text, date, text, uuid),
  public.log_activity(uuid, public.activity_type, text, public.activity_purpose,
    public.activity_outcome, uuid, uuid, uuid, timestamptz, smallint, text, text,
    public.next_action_type, date, text, boolean),
  public.change_opportunity_stage(uuid, public.opportunity_stage, text, text, date, bigint, bigint,
    text, public.lost_reason, text, text, public.next_action_type, date, text),
  public.reassign_opportunity(uuid, uuid, text),
  public.bulk_reassign(uuid, uuid, text)
to authenticated, service_role;
