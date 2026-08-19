-- 013 — opportunity events (§5.9), the audit trail
--
-- Separate from `activities` by design and must never be merged with it:
-- activities are what the salesperson did with the customer, events are what the
-- system recorded about the record (§10.1).
--
-- Append-only for EVERYONE, including OWNER: there is no UPDATE and no DELETE
-- policy on this table for any role (§9.2).

create table public.opportunity_events (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  event_type     public.opportunity_event_type not null,
  from_stage     public.opportunity_stage,
  to_stage       public.opportunity_stage,
  from_owner_id  uuid references public.users(id),
  to_owner_id    uuid references public.users(id),
  reason         text,
  metadata       jsonb not null default '{}',
  actor_id       uuid not null references public.users(id),
  -- ADR-019: clock_timestamp(), NOT now(). `now()` is transaction START time, so
  -- every event written inside one transaction would share a timestamp — and
  -- §16.3 makes multi-event transactions the norm, since changeOpportunityStage
  -- and a reassignment run in one RPC. The trail would then be unorderable by the
  -- very index §5.9 specifies for reading it. clock_timestamp() records when the
  -- event actually happened, which is what an audit trail is for.
  created_at     timestamptz not null default clock_timestamp()
);

create index opportunity_events_opp_idx   on public.opportunity_events (opportunity_id, created_at desc);
create index opportunity_events_type_idx  on public.opportunity_events (event_type, created_at desc);
create index opportunity_events_actor_idx on public.opportunity_events (actor_id, created_at desc);

-- The trigger is the SINGLE WRITER, so no path can bypass the audit (§5.9).
--
-- `reason` reaches it through the transaction-local `app.event_reason` GUC
-- (ADR-001), which the service sets with `set_config('app.event_reason', …, true)`
-- immediately before the write. The `true` scopes it to the transaction, so it
-- cannot leak between requests on a pooled connection. A stale or unset value
-- reads as null and is ignored.
--
-- The actor falls back to the system user (ADR-003) so service-role writes — cron
-- routes, the import executor — do not abort on `actor_id`'s not-null constraint.
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

  return new;
end
$$;

create trigger opportunities_log_event
  after insert or update on public.opportunities
  for each row execute function public.log_opportunity_event();

-- RLS on, from the moment the table exists (SPEC_AUDIT H-04). The policies
-- themselves arrive in 016, where the whole authorization model can be read at
-- once; until then this table denies everything to every role but its owner, so
-- no intermediate state of the migration sequence is readable.
alter table public.opportunity_events enable row level security;
