-- 022 — management analytics (Master Phase 3, ADR-022)
--
-- Every function here is **SECURITY INVOKER**, exactly like the RPCs in 019: it
-- runs as the caller, so every policy in 016 is evaluated for real and a
-- salesperson who reaches one through a direct PostgREST call sees only what the
-- policies already let them see. An RPC buys ATOMICITY and AGGREGATION, never
-- authority (§16.3).
--
-- WHY AGGREGATE IN SQL AT ALL. PostgREST cannot GROUP BY, so the alternative is
-- to pull every row into the Node process and reduce it there. That is what the
-- Phase 2 pipeline tile does with `.limit(5000)`, and it has two defects a
-- management surface cannot carry: the transfer grows with the pipeline, and a
-- set larger than the limit is silently truncated — a dashboard that quietly
-- under-reports is worse than one that fails. Aggregating here means one round
-- trip, a bounded result, and no silent truncation (§12.8, §19).
--
-- WHY EVERY FUNCTION IS plpgsql RATHER THAN sql. The management gate has to run
-- whether or not the query matches a single row. Expressed as a predicate inside
-- a `language sql` body it is subject to the planner: against a caller who can
-- see nothing, the scan yields nothing and a gate written as a WHERE clause may
-- never be evaluated at all — the caller gets a polite empty report instead of a
-- refusal. `perform` on the first line of a plpgsql body is unconditional. A
-- security control must not depend on a planner decision.
--
-- NO THRESHOLD IS WRITTEN IN THIS FILE. Stall days, dormancy days and the
-- high-value threshold arrive as parameters from `services/settings.service.ts`,
-- which is the only reader of `system_settings` (CLAUDE.md §3). A number from
-- migration 014 appearing below would be exactly the hard-coding that rule exists
-- to prevent.
--
-- THE `p_limit` CEILING IS 1000, and it is a technical ceiling rather than a
-- business threshold: it is the largest page any caller may ask for, and it
-- exists so a hostile `?pageSize=` cannot turn a report into a full table scan.
--
-- **1000 is not arbitrary: it is `max_rows` in `supabase/config.toml`.** PostgREST
-- truncates any response beyond that number, silently, so a higher ceiling here
-- would be a promise the transport cannot keep — the caller would receive 1000
-- rows believing they had all of them. Screens ask for at most `MAX_PAGE_SIZE`
-- (100) through `parsePageParams`; the CSV export asks for `EXPORT_ROW_LIMIT`,
-- which is this same number for this same reason. If `max_rows` ever changes,
-- all three change together.
--
-- PERIOD BOUNDARIES ARRIVE AS INSTANTS. `p_from`/`p_to` are computed in
-- `lib/dates.ts` from Asia/Kolkata day boundaries and passed as `timestamptz`, so
-- the business day is defined in one place rather than restated in SQL. Where SQL
-- must bucket by month it does so explicitly at `Asia/Kolkata` — a bare
-- `date_trunc` on a `timestamptz` would bucket in the session timezone, which is
-- UTC on Supabase, and would put the first five and a half hours of every Indian
-- month in the previous one (CLAUDE.md §10).

-- ------------------------------------------------------------- the gate ----
--
-- Management reporting is MANAGER and OWNER (§3.1). ADMIN is deliberately absent
-- (ADR-017) and SALESPERSON never had it.
--
-- This is a real control, not a convenience. Without it a salesperson calling
-- `management_team_workload` through PostgREST would get a one-row report of
-- their own numbers — no other person's data, because RLS holds, but a team
-- surface all the same. The Master Phase 3 brief is explicit that team dashboards
-- are not a salesperson surface, so the refusal belongs at the database boundary
-- where a hidden menu item is not doing the work.
create or replace function public.assert_management_access() returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_manager_or_above() then
    raise exception 'Management reporting is available to managers and the owner only.'
      using errcode = '42501';
  end if;
end
$$;

comment on function public.assert_management_access() is
  'Refuses SALESPERSON and ADMIN at the database boundary. Every analytics RPC performs it first.';

-- The outlets the caller may see management data for (ADR-016).
--
-- OWNER is company-wide BY ROLE and is never enumerated as a member of every
-- outlet, so their scope is "every active outlet" resolved at read time — an
-- outlet opened tomorrow is in scope tomorrow, with no membership row to
-- remember. A MANAGER's scope is their live `user_outlets` rows, which may be
-- empty; an empty scope compares nothing, which is the correct reading.
--
-- SECURITY DEFINER for the same reason the 015 helpers are: it reads
-- `user_outlets` to answer a question about the caller.
create or replace function public.scoped_outlet_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select o.id from public.outlets o
   where o.is_active and public.user_role() = 'OWNER'
  union
  select uo.outlet_id from public.user_outlets uo
   where uo.user_id = auth.uid()
     and uo.revoked_at is null
     and public.user_role() = 'MANAGER'
$$;

comment on function public.scoped_outlet_ids() is
  'Outlets the caller may compare in management reporting. OWNER: every active outlet, by role.';

-- ------------------------------------------------------ pipeline by stage ----
--
-- Count and value per stage over the ACTIVE set, plus the weighting each stage
-- contributes to Weighted Pipeline (§13.1). The probability map is a parameter;
-- `stage_probabilities` is a setting, not a constant.
create or replace function public.management_pipeline_by_stage(
  p_probabilities jsonb,
  p_outlet        uuid default null,
  p_owner         uuid default null
) returns table (
  stage             public.opportunity_stage,
  opportunity_count bigint,
  value_paise       bigint,
  weighted_paise    bigint,
  counts_in_pipeline boolean
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  select
    f.stage,
    count(*)::bigint,
    coalesce(sum(f.estimated_value), 0)::bigint,
    -- round() per row before summing, so the total matches the per-row figure a
    -- drill-down shows. Summing first and rounding once would differ by a rupee
    -- or two and make the two screens disagree for no reason anybody could explain.
    coalesce(sum(round(f.estimated_value
      * coalesce((p_probabilities ->> f.stage::text)::numeric, 0) / 100)), 0)::bigint,
    bool_and(f.in_pipeline)
  from public.v_opportunity_flags f
  where f.is_active
    and (p_outlet is null or f.outlet_id = p_outlet)
    and (p_owner  is null or f.owner_id  = p_owner)
  group by f.stage;
end
$$;

-- ------------------------------------------------------------ exceptions ----
--
-- The daily review of §13.3 Panel A, as one row. Eight counts in one round trip
-- rather than eight queries — the difference is invisible at this scale, and the
-- point is that nothing here can drift out of step with anything else.
create or replace function public.management_exceptions(
  p_stall_days    jsonb,
  p_dormancy_days integer,
  p_high_value    bigint,
  p_sla_cutoff    timestamptz,
  p_outlet        uuid default null,
  p_owner         uuid default null
) returns table (
  unassigned          bigint,
  overdue             bigint,
  missing_next_action bigint,
  sla_breach          bigint,
  stalled             bigint,
  dormant             bigint,
  high_value_at_risk  bigint,
  quotation_expired   bigint,
  active_total        bigint,
  overdue_value_paise bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  with scoped as (
    select f.*,
           (f.days_in_stage > coalesce((p_stall_days ->> f.stage::text)::integer, 2147483647))
             as row_is_stalled
    from public.v_opportunity_flags f
    where f.is_active
      and (p_outlet is null or f.outlet_id = p_outlet)
      and (p_owner  is null or f.owner_id  = p_owner)
  )
  select
    count(*) filter (where s.is_unassigned)::bigint,
    count(*) filter (where s.is_overdue)::bigint,
    count(*) filter (where s.is_missing_next_action)::bigint,
    count(*) filter (where s.stage = 'new' and s.created_at < p_sla_cutoff)::bigint,
    count(*) filter (where s.row_is_stalled)::bigint,
    count(*) filter (where s.days_since_activity > p_dormancy_days)::bigint,
    -- §13.3: high value AND (overdue OR stalled). Value alone is not a risk.
    count(*) filter (where s.estimated_value >= p_high_value
                       and (s.is_overdue or s.row_is_stalled))::bigint,
    count(*) filter (where s.quotation_valid_until is not null
                       and s.quotation_valid_until < (now() at time zone 'Asia/Kolkata')::date)::bigint,
    count(*)::bigint,
    coalesce(sum(s.estimated_value) filter (where s.is_overdue), 0)::bigint
  from scoped s;
end
$$;

-- -------------------------------------------------------- period summary ----
--
-- Won, lost and new enquiries for a period (§13.1). Win Rate is NOT computed
-- here: it is a division whose zero-denominator case must render an em dash
-- rather than 0%, and that rule belongs in one unit-tested TypeScript function
-- rather than in SQL, where a null would have to survive a round trip and keep
-- meaning the same thing.
create or replace function public.management_period_summary(
  p_from   timestamptz,
  p_to     timestamptz,
  p_outlet uuid default null,
  p_owner  uuid default null
) returns table (
  won_count          bigint,
  won_value_paise    bigint,
  lost_count         bigint,
  lost_value_paise   bigint,
  new_enquiry_count  bigint,
  quoted_value_paise bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  select
    count(*) filter (where f.stage = 'won' and f.closed_at >= p_from and f.closed_at < p_to)::bigint,
    coalesce(sum(f.final_order_value)
      filter (where f.stage = 'won' and f.closed_at >= p_from and f.closed_at < p_to), 0)::bigint,
    count(*) filter (where f.stage = 'lost' and f.closed_at >= p_from and f.closed_at < p_to)::bigint,
    -- Lost Value is the ESTIMATED value (§13.1): a lost opportunity has no final
    -- order value, and using the quoted figure would silently exclude everything
    -- lost before a quotation was ever issued.
    coalesce(sum(f.estimated_value)
      filter (where f.stage = 'lost' and f.closed_at >= p_from and f.closed_at < p_to), 0)::bigint,
    count(*) filter (where f.created_at >= p_from and f.created_at < p_to)::bigint,
    coalesce(sum(f.quoted_value)
      filter (where f.quotation_date is not null
                and f.quotation_date >= (p_from at time zone 'Asia/Kolkata')::date
                and f.quotation_date <  (p_to   at time zone 'Asia/Kolkata')::date), 0)::bigint
  from public.v_opportunity_flags f
  where (p_outlet is null or f.outlet_id = p_outlet)
    and (p_owner  is null or f.owner_id  = p_owner);
end
$$;

-- --------------------------------------------------------- team workload ----
--
-- One row per salesperson in scope (§13.3 Panel B, Master Phase 3 §8).
--
-- The LEFT JOINs are the point: a salesperson with no opportunities and no
-- activity still appears, with zeros. Dropping them would hide the person a
-- manager most needs to see. Rows come from `users` and `user_outlets`, both of
-- which carry their own policies, so the list a manager gets is already their
-- team and not the company.
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
    join public.user_outlets uo
      on uo.user_id = u.id and uo.revoked_at is null
    where uo.outlet_id in (select public.scoped_outlet_ids())
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

-- ----------------------------------------------------- outlet comparison ----
--
-- The business runs two outlets and plans five to ten (Master Phase 3 §7), so
-- comparison is a first-class surface rather than a filter.
--
-- Rows come from `scoped_outlet_ids()`: a MANAGER compares the outlets they
-- manage and nothing else, and an OWNER compares every active outlet. **No outlet
-- name is written here** — outlets are data (ADR-016).
create or replace function public.management_outlet_comparison(
  p_from timestamptz,
  p_to   timestamptz
) returns table (
  outlet_id            uuid,
  outlet_code          text,
  outlet_name          text,
  new_enquiry_count    bigint,
  active_count         bigint,
  pipeline_value_paise bigint,
  quoted_value_paise   bigint,
  won_count            bigint,
  won_value_paise      bigint,
  lost_count           bigint,
  quoted_reached_count bigint,
  quoted_won_count     bigint,
  overdue_count        bigint,
  site_visit_count     bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  with scope as (
    select o.id as sid, o.code as scode, o.name as sname
    from public.outlets o
    where o.id in (select public.scoped_outlet_ids())
  ),
  opps as (
    select
      f.outlet_id                                                              as opp_outlet,
      count(*) filter (where f.created_at >= p_from and f.created_at < p_to)   as c_new,
      count(*) filter (where f.in_pipeline)                                    as c_active,
      coalesce(sum(f.estimated_value) filter (where f.in_pipeline), 0)         as v_pipeline,
      coalesce(sum(f.quoted_value) filter (
        where f.quotation_date is not null
          and f.quotation_date >= (p_from at time zone 'Asia/Kolkata')::date
          and f.quotation_date <  (p_to   at time zone 'Asia/Kolkata')::date), 0) as v_quoted,
      count(*) filter (where f.stage = 'won'  and f.closed_at >= p_from and f.closed_at < p_to) as c_won,
      coalesce(sum(f.final_order_value)
        filter (where f.stage = 'won' and f.closed_at >= p_from and f.closed_at < p_to), 0)     as v_won,
      count(*) filter (where f.stage = 'lost' and f.closed_at >= p_from and f.closed_at < p_to) as c_lost,
      count(*) filter (where f.closed_at >= p_from and f.closed_at < p_to
                         and f.stage in ('won','lost')
                         and exists (select 1 from public.opportunity_events e
                                      where e.opportunity_id = f.id and e.to_stage = 'quoted')) as c_quoted_reached,
      count(*) filter (where f.closed_at >= p_from and f.closed_at < p_to
                         and f.stage = 'won'
                         and exists (select 1 from public.opportunity_events e
                                      where e.opportunity_id = f.id and e.to_stage = 'quoted')) as c_quoted_won,
      count(*) filter (where f.is_overdue)                                     as c_overdue
    from public.v_opportunity_flags f
    group by f.outlet_id
  ),
  visits as (
    select acc.outlet_id as visit_outlet, count(*) as c_visits
    from public.activities a
    join public.accounts acc on acc.id = a.account_id
    where a.type = 'SITE_VISIT' and a.occurred_at >= p_from and a.occurred_at < p_to
    group by acc.outlet_id
  )
  select
    scope.sid, scope.scode, scope.sname,
    coalesce(opps.c_new, 0)::bigint,
    coalesce(opps.c_active, 0)::bigint,
    coalesce(opps.v_pipeline, 0)::bigint,
    coalesce(opps.v_quoted, 0)::bigint,
    coalesce(opps.c_won, 0)::bigint,
    coalesce(opps.v_won, 0)::bigint,
    coalesce(opps.c_lost, 0)::bigint,
    coalesce(opps.c_quoted_reached, 0)::bigint,
    coalesce(opps.c_quoted_won, 0)::bigint,
    coalesce(opps.c_overdue, 0)::bigint,
    coalesce(visits.c_visits, 0)::bigint
  from scope
  left join opps   on opps.opp_outlet     = scope.sid
  left join visits on visits.visit_outlet = scope.sid
  order by scope.sname;
end
$$;

-- --------------------------------------------------- lost-reason analysis ----
--
-- Top-level reasons are the existing enum and nothing else (Master Phase 3 §14):
-- no ad-hoc categories, no free-text bucketing. `lost_detail` stays where it is,
-- on the record, for the drill-down to show.
create or replace function public.management_lost_reasons(
  p_from   timestamptz,
  p_to     timestamptz,
  p_outlet uuid default null,
  p_owner  uuid default null
) returns table (
  lost_reason      public.lost_reason,
  lost_count       bigint,
  lost_value_paise bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  select
    f.lost_reason,
    count(*)::bigint,
    coalesce(sum(f.estimated_value), 0)::bigint
  from public.v_opportunity_flags f
  where f.stage = 'lost'
    and f.closed_at >= p_from and f.closed_at < p_to
    and f.lost_reason is not null
    and (p_outlet is null or f.outlet_id = p_outlet)
    and (p_owner  is null or f.owner_id  = p_owner)
  group by f.lost_reason
  order by count(*) desc, f.lost_reason;
end
$$;

-- ---------------------------------------------- quote-to-order conversion ----
--
-- "Won opportunities that were previously quoted ÷ opportunities that reached
-- quoted or later" (Master Phase 3 §11), scoped to deals RESOLVED in the period.
--
-- "Reached quoted" is read from `opportunity_events`, not from the current stage:
-- a deal now in negotiation reached quotation, and a deal that skipped quotation
-- entirely did not, however it ended. The event trail is the only record that can
-- answer that, and it already exists (§5.9) — Master Phase 3 §11 is explicit that
-- this metric must not invent a quotation table or a new event system.
--
-- The division itself is deliberately left to the caller: a zero denominator must
-- render an em dash rather than 0%, and that rule lives in one unit-tested
-- TypeScript function (§13.1).
create or replace function public.management_quote_conversion(
  p_from   timestamptz,
  p_to     timestamptz,
  p_outlet uuid default null,
  p_owner  uuid default null
) returns table (
  reached_quoted_count        bigint,
  won_after_quote_count       bigint,
  lost_after_quote_count      bigint,
  won_after_quote_value_paise bigint,
  never_quoted_won_count      bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  with resolved as (
    select f.id as opp_id, f.stage as opp_stage, f.final_order_value as opp_final,
           exists (select 1 from public.opportunity_events e
                    where e.opportunity_id = f.id and e.to_stage = 'quoted') as ever_quoted
    from public.v_opportunity_flags f
    where f.stage in ('won','lost')
      and f.closed_at >= p_from and f.closed_at < p_to
      and (p_outlet is null or f.outlet_id = p_outlet)
      and (p_owner  is null or f.owner_id  = p_owner)
  )
  select
    count(*) filter (where r.ever_quoted)::bigint,
    count(*) filter (where r.ever_quoted and r.opp_stage = 'won')::bigint,
    count(*) filter (where r.ever_quoted and r.opp_stage = 'lost')::bigint,
    coalesce(sum(r.opp_final) filter (where r.ever_quoted and r.opp_stage = 'won'), 0)::bigint,
    -- Surfaced so the metric is explainable rather than merely correct: a business
    -- that wins a lot without ever quoting has a recording problem, not a
    -- conversion problem, and the tile should be able to say so.
    count(*) filter (where not r.ever_quoted and r.opp_stage = 'won')::bigint
  from resolved r;
end
$$;

-- ------------------------------------------------- quotation turnaround ----
--
-- "How quickly are formal quotations issued after a qualified requirement reaches
-- the quotation process?" (Master Phase 3 §12).
--
-- Measured from the FIRST `qualified` event to the FIRST `quoted` event, both
-- read from the audit trail that already exists. No quotation workflow is added
-- and no timestamp is invented.
--
-- **The limitation is reported rather than papered over.** An opportunity with no
-- recorded `qualified` event — imported history, or one created straight into a
-- later stage — cannot have a turnaround, so it is excluded and counted in
-- `excluded_count`. A caller that shows the average without showing how many rows
-- it could not measure is hiding the shape of its own data.
create or replace function public.management_quotation_turnaround(
  p_from   timestamptz,
  p_to     timestamptz,
  p_outlet uuid default null,
  p_owner  uuid default null
) returns table (
  measured_count  bigint,
  excluded_count  bigint,
  average_days    numeric,
  median_days     numeric,
  slowest_days    integer,
  within_two_days bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  with events as (
    select
      f.id as opp_id,
      (select min(e.created_at) from public.opportunity_events e
        where e.opportunity_id = f.id and e.to_stage = 'quoted')    as first_quoted_at,
      (select min(e.created_at) from public.opportunity_events e
        where e.opportunity_id = f.id and e.to_stage = 'qualified') as first_qualified_at
    from public.v_opportunity_flags f
    where (p_outlet is null or f.outlet_id = p_outlet)
      and (p_owner  is null or f.owner_id  = p_owner)
  ),
  -- The period filter is on the QUOTATION, not on the opportunity: the question
  -- is how fast quotations went out during the period, so a deal qualified in
  -- March and quoted in April belongs to April.
  in_period as (
    select * from events
    where first_quoted_at is not null
      and first_quoted_at >= p_from and first_quoted_at < p_to
  ),
  measured as (
    select ((first_quoted_at at time zone 'Asia/Kolkata')::date
             - (first_qualified_at at time zone 'Asia/Kolkata')::date) as days
    from in_period
    where first_qualified_at is not null
      and first_qualified_at <= first_quoted_at
  )
  select
    (select count(*) from measured)::bigint,
    (select count(*) from in_period
      where first_qualified_at is null or first_qualified_at > first_quoted_at)::bigint,
    (select round(avg(m.days), 1) from measured m),
    -- The cast is required, not cosmetic: `percentile_cont` returns double
    -- precision, and a `returns table (... numeric)` column will not accept it —
    -- the function fails at call time with "structure of query does not match
    -- function result type", not at creation.
    (select percentile_cont(0.5) within group (order by m.days) from measured m)::numeric,
    (select max(m.days) from measured m),
    (select count(*) from measured m where m.days <= 2)::bigint;
end
$$;

-- ---------------------------------------------------- won value by month ----
--
-- The owner's trend block (§13.4) — one series, bucketed at Asia/Kolkata.
-- `generate_series` supplies the empty months so a quiet month renders as a zero
-- rather than vanishing and flattering the trend.
create or replace function public.management_won_by_month(
  p_months integer,
  p_outlet uuid default null
) returns table (
  month_start     date,
  won_count       bigint,
  won_value_paise bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  with months as (
    select (date_trunc('month', (now() at time zone 'Asia/Kolkata'))
             - make_interval(months => offs))::date as m_start
    from generate_series(0, greatest(least(coalesce(p_months, 12), 36), 1) - 1) as offs
  ),
  won as (
    select
      date_trunc('month', (f.closed_at at time zone 'Asia/Kolkata'))::date as w_month,
      count(*) as c_won,
      coalesce(sum(f.final_order_value), 0) as v_won
    from public.v_opportunity_flags f
    where f.stage = 'won'
      and f.closed_at is not null
      and (p_outlet is null or f.outlet_id = p_outlet)
    group by 1
  )
  select
    months.m_start,
    coalesce(won.c_won, 0)::bigint,
    coalesce(won.v_won, 0)::bigint
  from months
  left join won on won.w_month = months.m_start
  order by months.m_start;
end
$$;

-- --------------------------------------------------------------- at risk ----
--
-- The at-risk set, bounded and paginated in SQL (Master Phase 3 §9).
--
-- **The predicate here is the UNION of the risk reasons, not a second copy of
-- them.** Naming which reasons apply to a row is `classifyRisk()` in
-- `lib/metrics.ts`, which is pure and unit-tested; this function only answers
-- "does this row carry at least one reason", which is what a bounded, paginated
-- query needs to know. High-value-at-risk is deliberately absent from the
-- predicate because it is a strict subset of overdue-or-stalled, so including it
-- would change nothing and would put the same rule in two places (CLAUDE.md §8).
create or replace function public.management_at_risk(
  p_stall_days    jsonb,
  p_dormancy_days integer,
  p_outlet        uuid default null,
  p_owner         uuid default null,
  p_limit         integer default 50,
  p_offset        integer default 0
) returns table (
  id                     uuid,
  title                  text,
  account_id             uuid,
  account_name           text,
  project_id             uuid,
  project_name           text,
  owner_id               uuid,
  owner_name             text,
  outlet_id              uuid,
  outlet_name            text,
  stage                  public.opportunity_stage,
  estimated_value        bigint,
  days_in_stage          integer,
  days_since_activity    integer,
  stage_stall_days       integer,
  next_action            public.next_action_type,
  next_action_date       date,
  last_activity_at       timestamptz,
  is_overdue             boolean,
  is_missing_next_action boolean,
  total_count            bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  with candidates as (
    select
      f.*,
      coalesce((p_stall_days ->> f.stage::text)::integer, 2147483647) as row_stall_days
    from public.v_opportunity_flags f
    where f.is_active
      and (p_outlet is null or f.outlet_id = p_outlet)
      and (p_owner  is null or f.owner_id  = p_owner)
  ),
  at_risk as (
    select * from candidates c
    where c.is_overdue
       or c.is_missing_next_action
       or c.days_in_stage > c.row_stall_days
       or c.days_since_activity > p_dormancy_days
  )
  select
    r.id, r.title, r.account_id, acc.name, r.project_id, pr.name,
    r.owner_id, u.full_name, r.outlet_id, o.name,
    r.stage, r.estimated_value, r.days_in_stage, r.days_since_activity, r.row_stall_days,
    r.next_action, r.next_action_date, r.last_activity_at,
    r.is_overdue, r.is_missing_next_action,
    count(*) over ()::bigint
  from at_risk r
  left join public.accounts acc on acc.id = r.account_id
  left join public.projects pr  on pr.id  = r.project_id
  left join public.users u      on u.id   = r.owner_id
  left join public.outlets o    on o.id   = r.outlet_id
  -- Biggest first: a manager working down this list should meet the most
  -- expensive problem before the cheapest one.
  order by r.estimated_value desc, r.days_in_stage desc, r.id
  limit greatest(least(coalesce(p_limit, 50), 1000), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- -------------------------------------------------------- customer sales ----
--
-- "How much has this customer generated in Won Value, and how much active
-- Pipeline Value remains?" (Master Phase 3 §15).
create or replace function public.management_customer_sales(
  p_from   timestamptz,
  p_to     timestamptz,
  p_outlet uuid default null,
  p_owner  uuid default null,
  p_limit  integer default 50,
  p_offset integer default 0
) returns table (
  account_id           uuid,
  account_name         text,
  account_type         public.account_type,
  outlet_id            uuid,
  won_count            bigint,
  won_value_paise      bigint,
  open_count           bigint,
  pipeline_value_paise bigint,
  lost_count           bigint,
  last_activity_at     timestamptz,
  total_count          bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  with rolled as (
    select
      f.account_id as acc_id,
      count(*) filter (where f.stage = 'won' and f.closed_at >= p_from and f.closed_at < p_to) as c_won,
      coalesce(sum(f.final_order_value)
        filter (where f.stage = 'won' and f.closed_at >= p_from and f.closed_at < p_to), 0)    as v_won,
      count(*) filter (where f.in_pipeline)                                                    as c_open,
      coalesce(sum(f.estimated_value) filter (where f.in_pipeline), 0)                         as v_pipeline,
      count(*) filter (where f.stage = 'lost' and f.closed_at >= p_from and f.closed_at < p_to) as c_lost
    from public.v_opportunity_flags f
    where (p_outlet is null or f.outlet_id = p_outlet)
      and (p_owner  is null or f.owner_id  = p_owner)
    group by f.account_id
  )
  select
    acc.id, acc.name, acc.account_type, acc.outlet_id,
    rolled.c_won::bigint, rolled.v_won::bigint,
    rolled.c_open::bigint, rolled.v_pipeline::bigint,
    rolled.c_lost::bigint,
    acc.last_activity_at,
    count(*) over ()::bigint
  from rolled
  join public.accounts acc on acc.id = rolled.acc_id and acc.archived_at is null
  where rolled.c_won > 0 or rolled.c_open > 0 or rolled.c_lost > 0
  order by rolled.v_won desc, rolled.v_pipeline desc, acc.name
  limit greatest(least(coalesce(p_limit, 50), 1000), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- --------------------------------------------------------- project sales ----
--
-- ONE PROJECT HAS MANY OPPORTUNITIES (§4.3, §6). Rolling a project up must never
-- collapse it into one sale — the counts below are what stop that reading, and
-- the drill-down goes to the opportunity list rather than to a single record.
create or replace function public.management_project_sales(
  p_from   timestamptz,
  p_to     timestamptz,
  p_outlet uuid default null,
  p_owner  uuid default null,
  p_limit  integer default 50,
  p_offset integer default 0
) returns table (
  project_id           uuid,
  project_name         text,
  project_type         public.project_type,
  project_status       public.project_status,
  account_id           uuid,
  account_name         text,
  outlet_id            uuid,
  opportunity_count    bigint,
  won_count            bigint,
  won_value_paise      bigint,
  open_count           bigint,
  pipeline_value_paise bigint,
  lost_count           bigint,
  total_count          bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  with rolled as (
    select
      f.project_id as proj_id,
      count(*)                                                                                 as c_all,
      count(*) filter (where f.stage = 'won' and f.closed_at >= p_from and f.closed_at < p_to) as c_won,
      coalesce(sum(f.final_order_value)
        filter (where f.stage = 'won' and f.closed_at >= p_from and f.closed_at < p_to), 0)    as v_won,
      count(*) filter (where f.in_pipeline)                                                    as c_open,
      coalesce(sum(f.estimated_value) filter (where f.in_pipeline), 0)                         as v_pipeline,
      count(*) filter (where f.stage = 'lost' and f.closed_at >= p_from and f.closed_at < p_to) as c_lost
    from public.v_opportunity_flags f
    where f.project_id is not null
      and (p_outlet is null or f.outlet_id = p_outlet)
      and (p_owner  is null or f.owner_id  = p_owner)
    group by f.project_id
  )
  select
    pr.id, pr.name, pr.project_type, pr.status,
    pr.account_id, acc.name, pr.outlet_id,
    rolled.c_all::bigint,
    rolled.c_won::bigint, rolled.v_won::bigint,
    rolled.c_open::bigint, rolled.v_pipeline::bigint,
    rolled.c_lost::bigint,
    count(*) over ()::bigint
  from rolled
  join public.projects pr       on pr.id  = rolled.proj_id and pr.archived_at is null
  left join public.accounts acc on acc.id = pr.account_id
  order by rolled.v_won desc, rolled.v_pipeline desc, pr.name
  limit greatest(least(coalesce(p_limit, 50), 1000), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- ------------------------------------------------------------ site visits ----
--
-- Site visits are `activities.type = 'SITE_VISIT'` and NOTHING ELSE. Master
-- Phase 3 §13 is explicit: do not create a site-visits table. The outlet a visit
-- belongs to comes from the account it was logged against, because an activity
-- has no outlet of its own and inventing one would be a schema change nobody
-- asked for.
create or replace function public.management_site_visits(
  p_from    timestamptz,
  p_to      timestamptz,
  p_outlet  uuid default null,
  p_owner   uuid default null,
  p_project uuid default null,
  p_limit   integer default 50,
  p_offset  integer default 0
) returns table (
  id                uuid,
  occurred_at       timestamptz,
  summary           text,
  outcome           public.activity_outcome,
  purpose           public.activity_purpose,
  measurements      text,
  location_note     text,
  account_id        uuid,
  account_name      text,
  project_id        uuid,
  project_name      text,
  opportunity_id    uuid,
  performed_by      uuid,
  performed_by_name text,
  outlet_id         uuid,
  outlet_name       text,
  total_count       bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.assert_management_access();

  return query
  select
    a.id, a.occurred_at, a.summary, a.outcome, a.purpose, a.measurements, a.location_note,
    a.account_id, acc.name, a.project_id, pr.name, a.opportunity_id,
    a.performed_by, u.full_name, acc.outlet_id, o.name,
    count(*) over ()::bigint
  from public.activities a
  join public.accounts acc     on acc.id = a.account_id
  left join public.projects pr on pr.id  = a.project_id
  left join public.users u     on u.id   = a.performed_by
  left join public.outlets o   on o.id   = acc.outlet_id
  where a.type = 'SITE_VISIT'
    and a.occurred_at >= p_from and a.occurred_at < p_to
    and (p_outlet  is null or acc.outlet_id  = p_outlet)
    and (p_owner   is null or a.performed_by = p_owner)
    and (p_project is null or a.project_id   = p_project)
  order by a.occurred_at desc, a.id
  limit greatest(least(coalesce(p_limit, 50), 1000), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- §15.1 — revoke from anon, grant to authenticated. The gate inside each function
-- is what refuses SALESPERSON and ADMIN; the grant only decides who may attempt
-- the call at all.
--
-- **Granted function by function, NOT with `grant execute on all functions`.**
-- 015 and 018 deliberately left three functions ungranted — the trigger functions
-- `touch_stage_changed_at`, `touch_last_activity_at` and `apply_won_account_status`,
-- which are SECURITY DEFINER and exist only to run as triggers. A blanket grant
-- here would silently re-expose them as callable functions, widening a privilege
-- an earlier migration closed on purpose. `tests/integration/service-contracts.test.ts`
-- asserts exactly that and caught it.
revoke execute on function public.assert_management_access() from public, anon;
revoke execute on function public.scoped_outlet_ids() from public, anon;

grant execute on function public.assert_management_access()      to authenticated, service_role;
grant execute on function public.scoped_outlet_ids()             to authenticated, service_role;
grant execute on function public.management_pipeline_by_stage(jsonb, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.management_exceptions(jsonb, integer, bigint, timestamptz, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.management_period_summary(timestamptz, timestamptz, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.management_team_workload(timestamptz, timestamptz, jsonb, uuid)
  to authenticated, service_role;
grant execute on function public.management_outlet_comparison(timestamptz, timestamptz)
  to authenticated, service_role;
grant execute on function public.management_lost_reasons(timestamptz, timestamptz, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.management_quote_conversion(timestamptz, timestamptz, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.management_quotation_turnaround(timestamptz, timestamptz, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.management_won_by_month(integer, uuid)
  to authenticated, service_role;
grant execute on function public.management_at_risk(jsonb, integer, uuid, uuid, integer, integer)
  to authenticated, service_role;
grant execute on function public.management_customer_sales(timestamptz, timestamptz, uuid, uuid, integer, integer)
  to authenticated, service_role;
grant execute on function public.management_project_sales(timestamptz, timestamptz, uuid, uuid, integer, integer)
  to authenticated, service_role;
grant execute on function public.management_site_visits(timestamptz, timestamptz, uuid, uuid, uuid, integer, integer)
  to authenticated, service_role;
