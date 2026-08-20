-- 027 — the nightly maintenance job's database half (§14.6)
--
-- Three actions, one transaction:
--   1. accounts with no activity beyond the threshold become DORMANT
--   2. quotations past their validity become EXPIRED
--   3. `last_activity_at` is recomputed on accounts and opportunities, and
--      EVERY ROW IT HAD TO CORRECT IS REPORTED
--
-- **A non-zero correction count in step 3 means a write path is buggy. The route
-- logs it and must not suppress it** (§14.6). The count is returned rather than
-- swallowed precisely so it cannot be quietly ignored.
--
-- H-09 — THE IMPORT ROLLBACK WINDOW IS UNTOUCHABLE. Every statement below skips
-- records created by an import whose seven days have not elapsed. The reason is
-- exact: §20.6 decides rollback eligibility by `updated_at > completed_at`, and
-- a maintenance write is indistinguishable from a user's edit under that test. A
-- job that flagged four thousand freshly imported customers DORMANT at 02:00
-- would silently destroy the business's ability to undo the import at 09:00 —
-- the failure H-09 exists to prevent.
--
-- SECURITY INVOKER, called by the cron route through the service-role client
-- (§14.7). It has no role check of its own because it is not reachable by anyone
-- else: `authenticated` is not granted execute at the bottom of this file.

create or replace function public.maintenance_excluded_batches() returns setof uuid
language sql stable
set search_path = ''
as $$
  select id from public.import_batches
   where status = 'COMPLETED'
     and completed_at is not null
     and completed_at >= now() - (public.import_rollback_days() || ' days')::interval
$$;

comment on function public.maintenance_excluded_batches() is
  'Import batches still inside the §20.6 rollback window. Maintenance must not touch their rows (H-09).';

create or replace function public.run_maintenance(p_account_dormancy_days integer)
returns table (
  dormant_accounts    integer,
  expired_quotations  integer,
  corrected_accounts  integer,
  corrected_opportunities integer,
  corrected_ids       jsonb
)
language plpgsql
set search_path = ''
as $$
declare
  v_dormant   integer;
  v_expired   integer;
  v_acc_fixed integer;
  v_opp_fixed integer;
  v_ids       jsonb;
begin
  if p_account_dormancy_days is null or p_account_dormancy_days <= 0 then
    raise exception 'A positive dormancy threshold is required.' using errcode = '22023';
  end if;

  -- 1. Dormancy (§14.6, ADR-010 — the ACCOUNT threshold, not the opportunity one).
  --
  -- THE BUSINESS DAY IS Asia/Kolkata (B-10). A bare `now() - interval` would be
  -- evaluated against a UTC session clock and would be wrong for five and a half
  -- hours of every day; the boundary is taken on the IST calendar date instead.
  --
  -- DO_NOT_CONTACT is left alone: it is an explicit instruction, not a state the
  -- system may recompute.
  with excluded as (select b as id from public.maintenance_excluded_batches() b)
  update public.accounts a
     set status = 'DORMANT'
   where a.status in ('ACTIVE','PROSPECT')
     and a.archived_at is null
     and (coalesce(a.last_activity_at, a.created_at) at time zone 'Asia/Kolkata')::date
         < (now() at time zone 'Asia/Kolkata')::date - p_account_dormancy_days
     and not exists (select 1 from excluded e where e.id = a.import_batch_id);
  get diagnostics v_dormant = row_count;

  -- 2. Quotation expiry (§14.6).
  update public.opportunities o
     set quotation_status = 'EXPIRED'
   where o.quotation_status in ('SENT','UNDER_DISCUSSION')
     and o.quotation_valid_until is not null
     and o.quotation_valid_until < (now() at time zone 'Asia/Kolkata')::date
     and o.archived_at is null;
  get diagnostics v_expired = row_count;

  -- 3. Recompute `last_activity_at` and REPORT every correction.
  --
  -- The truth is `max(activities.occurred_at)`; the stored column is maintained
  -- by a trigger (ADR-020). They should never disagree, and a disagreement is a
  -- bug in a write path rather than something to fix silently — which is why the
  -- ids come back to the caller.
  with excluded as (select b as id from public.maintenance_excluded_batches() b),
  truth as (
    select a.id,
           a.last_activity_at as stored,
           (select max(act.occurred_at) from public.activities act where act.account_id = a.id) as actual
      from public.accounts a
     where a.archived_at is null
       and not exists (select 1 from excluded e where e.id = a.import_batch_id)
  ),
  wrong as (
    select id, actual from truth where stored is distinct from actual
  ),
  fixed as (
    update public.accounts a
       set last_activity_at = w.actual
      from wrong w
     where a.id = w.id
    returning a.id
  )
  select count(*)::integer, coalesce(jsonb_agg(id), '[]'::jsonb) into v_acc_fixed, v_ids from fixed;

  with excluded as (select b as id from public.maintenance_excluded_batches() b),
  truth as (
    select o.id,
           o.last_activity_at as stored,
           (select max(act.occurred_at) from public.activities act where act.opportunity_id = o.id) as actual
      from public.opportunities o
     where o.archived_at is null
       and not exists (select 1 from excluded e where e.id = o.import_batch_id)
  ),
  wrong as (
    select id, actual from truth where stored is distinct from actual
  ),
  fixed as (
    update public.opportunities o
       set last_activity_at = w.actual
      from wrong w
     where o.id = w.id
    returning o.id
  )
  select count(*)::integer, v_ids || coalesce(jsonb_agg(id), '[]'::jsonb)
    into v_opp_fixed, v_ids from fixed;

  return query select v_dormant, v_expired, v_acc_fixed, v_opp_fixed, v_ids;
end
$$;

comment on function public.run_maintenance(integer) is
  'The §14.6 nightly job. Excludes records inside the import rollback window (H-09). '
  'Returns every last_activity_at correction so the route can log it — do not suppress that log.';

revoke execute on function
  public.maintenance_excluded_batches(),
  public.run_maintenance(integer)
from public, anon, authenticated;

-- Cron only, through the service-role client (§14.7, ADR-009). `authenticated` is
-- deliberately absent: nothing a signed-in user does should be able to flag four
-- thousand customers dormant.
grant execute on function
  public.maintenance_excluded_batches(),
  public.run_maintenance(integer)
to service_role;
