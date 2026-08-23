-- 031 — the reporting line, and what a Sales Head may see (ADR-040)
--
-- WHAT WAS WRONG. Outlet scope alone cannot express this business. The pilot runs
-- three Sales Heads out of ONE branch, so `outlet_id in scoped_outlet_ids()` gives
-- every one of them every other one's pipeline. The rule the business actually
-- has is "my team", and until now the schema had no way to say who that is.
--
-- WHAT THIS ADDS. One column — `users.manager_id` — and the scope helpers that
-- read it. No new table: the organisation is the `users` rows and the line
-- between them (CLAUDE.md §4, ADR-040).
--
-- WHAT CHANGES ABOUT VISIBILITY
--
--   SALESPERSON  unchanged. Own records, plus work context (§3.2).
--   MANAGER      was: every record in their outlet scope.
--                now: records owned by themselves or by a DIRECT REPORT.
--                Outlet scope still governs which branches they may pick, and
--                still guards moving a record between branches — it is no longer
--                a read grant.
--   ADMIN        was: no business data at all (ADR-017).
--                now: reads everything operational. It administers the
--                organisation and is the escalation point above the Sales Heads,
--                which it cannot be while unable to see their work. It gains no
--                write, no archive and no reassignment.
--   OWNER        unchanged. Everything, by role.
--
-- The role is still MANAGER in the database. "Sales Head" is what the UI calls
-- it — a display name, not a second authorization concept (ADR-040).

-- ------------------------------------------------------------ the column ----
alter table public.users
  add column if not exists manager_id uuid references public.users(id) on delete restrict;

comment on column public.users.manager_id is
  'Who this person reports to. SALESPERSON -> MANAGER (Sales Head) -> ADMIN -> OWNER. '
  'Null only for the OWNER and for a person not yet placed in the line.';

-- Cheap, and it is the lookup every scope check makes.
create index if not exists users_manager_idx on public.users (manager_id) where manager_id is not null;

-- Nobody reports to themselves. A constraint rather than trigger-only logic,
-- because it is the one case that needs no other row to detect.
alter table public.users drop constraint if exists manager_not_self;
alter table public.users add constraint manager_not_self check (manager_id is null or manager_id <> id);

-- ------------------------------------------------------- the line is legal ----
--
-- The pairing rules, as the business states them:
--
--   SALESPERSON reports to a MANAGER (Sales Head)   — never to another salesperson
--   MANAGER     reports to an ADMIN                 — never to the OWNER directly
--   ADMIN       reports to the OWNER
--   OWNER       reports to nobody
--
-- Enforced here rather than in the service layer because a service-layer bug must
-- not be able to create an illegal organisation (CLAUDE.md §5). A trigger and not
-- a CHECK constraint: the rule compares this row to ANOTHER row, which a CHECK
-- cannot do.
--
-- Three separate failures are caught: an illegal pairing on the row being
-- written, an illegal pairing on the rows that report TO it (demoting a Sales
-- Head with a team underneath), and a cycle.
create or replace function public.guard_user_hierarchy() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  manager_role public.user_role;
  child        record;
  step         uuid;
  hops         integer := 0;
begin
  -- A person may not move themselves up the line. OWNER and ADMIN administer the
  -- organisation; everyone else's reporting line is set for them. Service-role
  -- callers (provisioning, import, cron) have no auth.uid() and are exempt for
  -- the same reason guard_record_scope() exempts them (§15.7).
  if tg_op = 'UPDATE'
     and auth.uid() is not null
     and new.manager_id is distinct from old.manager_id
     and not public.is_owner_or_admin() then
    raise exception 'Only an owner or an administrator may change who a person reports to.'
      using errcode = '42501';
  end if;

  -- 1. the rows that report to this one, when the role moves under them.
  --    FIRST, because it is the more specific complaint: demoting a sales head
  --    with a team underneath fails their own pairing too, and "you still have
  --    four people" tells the administrator what to do about it while "a
  --    salesperson reports to a sales head" does not.
  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    for child in select u.id, u.role from public.users u where u.manager_id = new.id loop
      if (child.role = 'SALESPERSON' and new.role <> 'MANAGER')
         or (child.role = 'MANAGER'  and new.role <> 'ADMIN')
         or (child.role = 'ADMIN'    and new.role <> 'OWNER') then
        raise exception
          'This person still has direct reports. Move their team first, then change the role.'
          using errcode = '23514';
      end if;
    end loop;
  end if;

  -- 2. this row's own pairing
  if new.role = 'OWNER' then
    if new.manager_id is not null then
      raise exception 'The owner reports to nobody.' using errcode = '23514';
    end if;
  elsif new.manager_id is not null then
    select u.role into manager_role from public.users u where u.id = new.manager_id;
    if manager_role is null then
      raise exception 'The manager does not exist.' using errcode = '23503';
    end if;
    if new.role = 'SALESPERSON' and manager_role <> 'MANAGER' then
      raise exception 'A salesperson reports to a sales head, not to a %.', manager_role
        using errcode = '23514';
    end if;
    if new.role = 'MANAGER' and manager_role <> 'ADMIN' then
      raise exception 'A sales head reports to an administrator, not to a %.', manager_role
        using errcode = '23514';
    end if;
    if new.role = 'ADMIN' and manager_role <> 'OWNER' then
      raise exception 'An administrator reports to the owner, not to a %.', manager_role
        using errcode = '23514';
    end if;
  end if;

  -- 3. no cycles.
  --
  --    A BACKSTOP, and deliberately kept even though the pairing ladder above
  --    already makes a loop unreachable: SALESPERSON -> MANAGER -> ADMIN ->
  --    OWNER is strictly ranked and the OWNER reports to nobody, so no legal
  --    line can close on itself. Relax any one of those rules — a second admin
  --    tier, a deputy sales head — and this is the only thing standing between
  --    the change and a `scoped_owner_ids()` that never terminates. The line is
  --    four deep by design, so the walk is bounded well below any real depth.
  step := new.manager_id;
  while step is not null loop
    hops := hops + 1;
    if step = new.id or hops > 32 then
      raise exception 'That would make the reporting line circular.' using errcode = '23514';
    end if;
    select u.manager_id into step from public.users u where u.id = step;
  end loop;

  return new;
end
$$;

comment on function public.guard_user_hierarchy() is
  'Keeps the reporting line legal: role pairing, no self-manager, no cycle, and no '
  'self-service change of who you report to.';

drop trigger if exists users_guard_hierarchy on public.users;
create trigger users_guard_hierarchy
  before insert or update on public.users
  for each row execute function public.guard_user_hierarchy();

-- ---------------------------------------------------------------- scope ----
--
-- Two set-returning helpers, in the shape 028 established: uncorrelated, so the
-- planner evaluates them once per query rather than once per row.

-- The people whose records a MANAGER may read: themselves and their direct
-- reports. Empty for every other role — SALESPERSON access comes from
-- `owner_id = current_user_id()`, and OWNER/ADMIN short-circuit before this.
--
-- A DEACTIVATED report is deliberately still in the set. Their pipeline does not
-- disappear when they leave, and it is their sales head who has to pick it up.
create or replace function public.scoped_owner_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select u.id
    from public.users u
   where public.user_role() = 'MANAGER'
     and (u.id = auth.uid() or u.manager_id = auth.uid())
$$;

comment on function public.scoped_owner_ids() is
  'Record owners a MANAGER (Sales Head) may read: self plus direct reports. Empty for other roles.';

-- Company-wide operational read. Named apart from `is_owner_or_admin()` — which
-- is about ADMINISTERING users, outlets and settings — because they are two
-- different questions that happen to have the same answer today. One predicate,
-- two names: change the rule here and both callers move together.
create or replace function public.reads_all_records() returns boolean
language sql stable security definer
set search_path = ''
as $$ select public.is_owner_or_admin() $$;

comment on function public.reads_all_records() is
  'May this caller read every operational record? OWNER and ADMIN (ADR-040, superseding ADR-017).';

-- The caller's own sales head. A SECURITY DEFINER helper and NOT an inline
-- subquery, because the one place it is used is a policy ON `public.users`, and a
-- policy on that table which selects from that table recurses — the trap §15.1
-- and CLAUDE.md §6 both name, and which this migration hit before the helper
-- existed.
create or replace function public.my_manager_id() returns uuid
language sql stable security definer
set search_path = ''
as $$ select u.manager_id from public.users u where u.id = auth.uid() and u.is_active $$;

comment on function public.my_manager_id() is
  'Who the caller reports to. SECURITY DEFINER so a policy on public.users can ask without recursing.';

-- Does the caller manage this person? Direct reports, not shared outlets
-- (ADR-040). Two sales heads in one branch are no longer each other's managers,
-- which was the whole defect.
create or replace function public.manages_user(p_user uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when public.reads_all_records() then true
    when public.user_role() = 'MANAGER' then exists (
      select 1 from public.users u
       where u.id = p_user and u.manager_id = auth.uid())
    else false
  end
$$;

-- --------------------------------------------------- parent-visibility ----
-- These mirror the SELECT policies below exactly; changing one without the other
-- is a defect (the note in 015 still holds).
create or replace function public.can_read_account(a uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.accounts acc
    where acc.id = a
      and (acc.owner_id = public.current_user_id()
           or public.reads_all_records()
           or acc.owner_id in (select public.scoped_owner_ids())
           or public.owns_opportunity_on_account(acc.id)))
$$;

create or replace function public.can_read_project(p uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects pr
    where pr.id = p
      and (pr.owner_id = public.current_user_id()
           or public.reads_all_records()
           or pr.owner_id in (select public.scoped_owner_ids())
           or public.owns_opportunity_on_project(pr.id)))
$$;

-- WRITE, not read: ADMIN reads everything and writes nothing operational, so
-- `reads_all_records()` is deliberately absent here.
create or replace function public.can_write_project(p uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects pr
    where pr.id = p
      and (pr.owner_id = public.current_user_id()
           or public.is_owner()
           or pr.owner_id in (select public.scoped_owner_ids())))
$$;

create or replace function public.can_read_opportunity(o uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.opportunities opp
    where opp.id = o
      and (opp.owner_id = public.current_user_id()
           or public.reads_all_records()
           or opp.owner_id in (select public.scoped_owner_ids())))
$$;

-- --------------------------------------------------------------- users ----
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (
    id = (select public.current_user_id())
    or (select public.reads_all_records())
    or public.manages_user(id)
    -- A salesperson may read the row of the sales head they report to: the name
    -- appears on their own records. It reveals no other person.
    or id = (select public.my_manager_id())
  );

-- -------------------------------------------------------- user_outlets ----
drop policy if exists user_outlets_select on public.user_outlets;
create policy user_outlets_select on public.user_outlets for select to authenticated
using (
  user_id = (select public.current_user_id())
  or (select public.reads_all_records())
  or user_id in (select public.scoped_owner_ids())
);

-- ------------------------------------------------------------ accounts ----
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.reads_all_records())
  or owner_id in (select public.scoped_owner_ids())
  or public.owns_opportunity_on_account(id)
);

drop policy if exists accounts_insert on public.accounts;
create policy accounts_insert on public.accounts for insert to authenticated
with check (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or owner_id in (select public.scoped_owner_ids())
);

drop policy if exists accounts_update on public.accounts;
create policy accounts_update on public.accounts for update to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or owner_id in (select public.scoped_owner_ids())
)
with check (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or owner_id in (select public.scoped_owner_ids())
);

-- ------------------------------------------------------- opportunities ----
drop policy if exists opportunities_select on public.opportunities;
create policy opportunities_select on public.opportunities for select to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.reads_all_records())
  or owner_id in (select public.scoped_owner_ids())
);

drop policy if exists opportunities_insert on public.opportunities;
create policy opportunities_insert on public.opportunities for insert to authenticated
with check (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or owner_id in (select public.scoped_owner_ids())
);

drop policy if exists opportunities_update on public.opportunities;
create policy opportunities_update on public.opportunities for update to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or owner_id in (select public.scoped_owner_ids())
)
with check (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or owner_id in (select public.scoped_owner_ids())
);

-- ------------------------------------------------------------ projects ----
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.reads_all_records())
  or owner_id in (select public.scoped_owner_ids())
  or public.owns_opportunity_on_project(id)
);

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated
with check (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or owner_id in (select public.scoped_owner_ids())
);

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or owner_id in (select public.scoped_owner_ids())
)
with check (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or owner_id in (select public.scoped_owner_ids())
);

-- ------------------------------------------------------- sales_targets ----
-- A target follows the person it is set for. The outlet ladder stays for
-- outlet-level and company-wide targets, which are management figures rather
-- than a salesperson's own.
drop policy if exists sales_targets_select on public.sales_targets;
create policy sales_targets_select on public.sales_targets for select to authenticated
using (
  case
    when user_id is not null then
      user_id = (select public.current_user_id())
      or (select public.reads_all_records())
      or user_id in (select public.scoped_owner_ids())
    when outlet_id is null then (select public.reads_all_records())
    else (select public.reads_all_records()) or outlet_id in (select public.scoped_outlet_ids())
  end
);

drop policy if exists sales_targets_insert on public.sales_targets;
create policy sales_targets_insert on public.sales_targets for insert to authenticated
with check (
  case
    when user_id is not null then
      (select public.is_owner()) or user_id in (select public.scoped_owner_ids())
    when outlet_id is null then (select public.is_owner())
    else (select public.is_owner()) or outlet_id in (select public.scoped_outlet_ids())
  end
);

drop policy if exists sales_targets_update on public.sales_targets;
create policy sales_targets_update on public.sales_targets for update to authenticated
using (
  case
    when user_id is not null then
      (select public.is_owner()) or user_id in (select public.scoped_owner_ids())
    when outlet_id is null then (select public.is_owner())
    else (select public.is_owner()) or outlet_id in (select public.scoped_outlet_ids())
  end
)
with check (
  case
    when user_id is not null then
      (select public.is_owner()) or user_id in (select public.scoped_owner_ids())
    when outlet_id is null then (select public.is_owner())
    else (select public.is_owner()) or outlet_id in (select public.scoped_outlet_ids())
  end
);

-- -------------------------------------------------- management surfaces ----
--
-- ADMIN now passes. It reads every operational record, so refusing it the
-- reports it can already assemble row by row protects nothing and hides the
-- escalation point's own view of the business.
create or replace function public.assert_management_access() returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (public.is_manager_or_above() or public.reads_all_records()) then
    raise exception 'Management reporting is available to sales heads, the administrator and the owner only.'
      using errcode = '42501';
  end if;
end
$$;

comment on function public.assert_management_access() is
  'Refuses SALESPERSON at the database boundary. Every analytics RPC performs it first.';

-- Outlets the caller may compare. ADMIN joins OWNER on "every active outlet":
-- it administers them, so it must be able to see each one's numbers.
create or replace function public.scoped_outlet_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select o.id from public.outlets o
   where o.is_active and public.reads_all_records()
  union
  select uo.outlet_id from public.user_outlets uo
   where uo.user_id = auth.uid()
     and uo.revoked_at is null
     and public.user_role() = 'MANAGER'
$$;

comment on function public.scoped_outlet_ids() is
  'Outlets the caller may compare, and may file a record against. OWNER/ADMIN: every active outlet, by role.';

-- The team list on /team and the manager dashboard. It enumerated salespeople by
-- shared outlet, which is the same defect the policies had: in a one-branch pilot
-- every sales head saw every salesperson.
create or replace function public.management_team_workload(
  p_from       timestamptz,
  p_to         timestamptz,
  p_stall_days jsonb,
  p_outlet     uuid default null
) returns table (
  user_id              uuid,
  full_name            text,
  role                 public.user_role,
  is_active            boolean,
  active_count         bigint,
  pipeline_value_paise bigint,
  overdue_count        bigint,
  due_today_count      bigint,
  missing_next_action  bigint,
  stalled_count        bigint,
  won_count            bigint,
  won_value_paise      bigint,
  lost_count           bigint,
  quoted_reached_count bigint,
  quoted_won_count     bigint,
  activity_count       bigint,
  site_visit_count     bigint,
  last_activity_at     timestamptz
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  with team as (
    select distinct u.id as member_id, u.full_name as member_name,
           u.role as member_role, u.is_active as member_active
    from public.users u
    -- LEFT, not INNER (ADR-040): membership of the caller's outlet is no longer
    -- what puts someone on this list, and a salesperson not yet assigned to a
    -- branch must not vanish from their own sales head's team.
    left join public.user_outlets uo
      on uo.user_id = u.id and uo.revoked_at is null
    where (
            -- OWNER and ADMIN: everybody. MANAGER: their direct reports, which
            -- is the whole point — three sales heads in one branch are not one
            -- team (ADR-040).
            (select public.reads_all_records())
            or u.id in (select public.scoped_owner_ids())
          )
      and (p_outlet is null or uo.outlet_id = p_outlet)
      and u.role = 'SALESPERSON'
  ),
  opps as (
    select
      f.owner_id                                                              as opp_owner,
      count(*) filter (where f.in_pipeline)                                   as c_active,
      coalesce(sum(f.estimated_value) filter (where f.in_pipeline), 0)        as v_pipeline,
      count(*) filter (where f.is_overdue)                                    as c_overdue,
      count(*) filter (where f.is_due_today)                                  as c_due_today,
      count(*) filter (where f.is_missing_next_action)                        as c_missing,
      count(*) filter (where f.is_active and f.days_in_stage
        > coalesce((p_stall_days ->> f.stage::text)::integer, 2147483647))    as c_stalled,
      count(*) filter (where f.stage = 'won'  and f.closed_at >= p_from and f.closed_at < p_to) as c_won,
      coalesce(sum(f.final_order_value)
        filter (where f.stage = 'won' and f.closed_at >= p_from and f.closed_at < p_to), 0)     as v_won,
      count(*) filter (where f.stage = 'lost' and f.closed_at >= p_from and f.closed_at < p_to) as c_lost,
      -- Quote-to-order needs "did this opportunity ever reach `quoted`", which is
      -- a question about history and therefore about `opportunity_events` — the
      -- current stage cannot answer it for a deal that has since moved on.
      count(*) filter (where f.closed_at >= p_from and f.closed_at < p_to
                         and f.stage in ('won','lost')
                         and exists (select 1 from public.opportunity_events e
                                      where e.opportunity_id = f.id and e.to_stage = 'quoted')) as c_quoted_reached,
      count(*) filter (where f.closed_at >= p_from and f.closed_at < p_to
                         and f.stage = 'won'
                         and exists (select 1 from public.opportunity_events e
                                      where e.opportunity_id = f.id and e.to_stage = 'quoted')) as c_quoted_won
    from public.v_opportunity_flags f
    where f.owner_id is not null
      and (p_outlet is null or f.outlet_id = p_outlet)
    group by f.owner_id
  ),
  acts as (
    select
      a.performed_by                                        as actor,
      count(*)                                              as c_activity,
      count(*) filter (where a.type = 'SITE_VISIT')         as c_site_visit,
      max(a.occurred_at)                                    as t_last
    from public.activities a
    where a.occurred_at >= p_from and a.occurred_at < p_to
    group by a.performed_by
  )
  select
    team.member_id, team.member_name, team.member_role, team.member_active,
    coalesce(opps.c_active, 0)::bigint,
    coalesce(opps.v_pipeline, 0)::bigint,
    coalesce(opps.c_overdue, 0)::bigint,
    coalesce(opps.c_due_today, 0)::bigint,
    coalesce(opps.c_missing, 0)::bigint,
    coalesce(opps.c_stalled, 0)::bigint,
    coalesce(opps.c_won, 0)::bigint,
    coalesce(opps.v_won, 0)::bigint,
    coalesce(opps.c_lost, 0)::bigint,
    coalesce(opps.c_quoted_reached, 0)::bigint,
    coalesce(opps.c_quoted_won, 0)::bigint,
    coalesce(acts.c_activity, 0)::bigint,
    coalesce(acts.c_site_visit, 0)::bigint,
    acts.t_last
  from team
  left join opps on opps.opp_owner = team.member_id
  left join acts on acts.actor     = team.member_id
  order by team.member_name;
end
$$;

-- §15.1 — revoke from anon, grant to authenticated, FUNCTION BY FUNCTION.
--
-- Never `grant execute on all functions in schema public`. 015, 018 and 027
-- deliberately leave several functions ungranted — the SECURITY DEFINER trigger
-- bodies, and the maintenance RPC — and a blanket grant here would silently
-- re-expose every one of them. 022 says so in as many words and
-- `tests/integration/service-contracts.test.ts` asserts it. `create or replace`
-- keeps the existing grants, so only the functions this migration INTRODUCES
-- need anything.
revoke execute on function public.scoped_owner_ids()  from public, anon;
revoke execute on function public.reads_all_records() from public, anon;
revoke execute on function public.my_manager_id()     from public, anon;
grant  execute on function public.scoped_owner_ids()  to authenticated, service_role;
grant  execute on function public.reads_all_records() to authenticated, service_role;
grant  execute on function public.my_manager_id()     to authenticated, service_role;

-- A trigger body, and nothing else. It runs as the table owner when the trigger
-- fires; no caller has any business invoking it directly.
revoke execute on function public.guard_user_hierarchy() from public, anon, authenticated;
