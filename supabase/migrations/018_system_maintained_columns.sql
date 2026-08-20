-- 018 — system-maintained denormalised columns (Master Phase 2)
--
-- Three columns the specification stores rather than derives — `stage_changed_at`
-- (§5.7), `last_activity_at` (§5.3, §5.7) and the `won` side effect on
-- `accounts.status` (§8.7) — are moved from "the service remembers to write it"
-- to "the database maintains it". ADR-020 records why.
--
-- The defect this closes is real and was found while building the activity flow:
-- a salesperson may log an activity against an account they do NOT own, on the
-- strength of owning an opportunity there (§3.2 work context). The
-- `activities_insert` policy allows exactly that. But `accounts_update` requires
-- ownership or outlet management, so a service-layer
-- `update accounts set last_activity_at = …` from that same salesperson silently
-- affects ZERO rows. Recency on the Customer 360 header would quietly stop
-- moving, and nothing would fail loudly. The same reasoning applies to
-- `accounts.status = 'ACTIVE'` on a win.
--
-- These triggers are SECURITY DEFINER for the same reason `log_opportunity_event()`
-- is: they are a system consequence of a write the caller was ALREADY authorized
-- to make, not a new privilege. They add no callable surface — there is no
-- function here a user can invoke directly to move somebody else's data.

-- `stage_changed_at` is what `days_in_stage` counts from (§10.3). Leaving it to
-- the service means a manager editing the row through PostgREST — which the
-- `opportunities_update` policy permits — moves the stage and leaves the clock
-- reading the old value, so a stalled opportunity looks fresh.
create or replace function public.touch_stage_changed_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at = now();
  end if;
  return new;
end
$$;

comment on function public.touch_stage_changed_at() is
  'Keeps opportunities.stage_changed_at truthful, so days_in_stage cannot drift (ADR-020).';

create trigger opportunities_touch_stage_changed_at
  before update on public.opportunities
  for each row execute function public.touch_stage_changed_at();

-- Recency for the Customer 360 header and the dormancy queries (§13.1).
--
-- `greatest` rather than plain assignment: an activity may be back-dated —
-- `occurred_at` is a user-supplied field — and back-dating yesterday's call must
-- never make an account look staler than it is.
create or replace function public.touch_last_activity_at() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.accounts
     set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
   where id = new.account_id;

  if new.opportunity_id is not null then
    update public.opportunities
       set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
     where id = new.opportunity_id;
  end if;

  return new;
end
$$;

comment on function public.touch_last_activity_at() is
  'Maintains accounts/opportunities.last_activity_at from activities. SECURITY DEFINER because '
  'a work-context salesperson may log the activity without being able to update the parent (ADR-020).';

create trigger activities_touch_last_activity_at
  after insert on public.activities
  for each row execute function public.touch_last_activity_at();

-- §8.7: "won sets accounts.status = 'ACTIVE'".
--
-- Deliberately one-directional. Reopening a won opportunity (ADR-007) does NOT
-- put the account back to PROSPECT: the account may hold other won opportunities,
-- and a customer who has bought once has bought.
--
-- `DORMANT` and `DO_NOT_CONTACT` are left alone as well. A win does not overrule
-- an explicit instruction not to contact somebody, and dormancy is recomputed by
-- the maintenance job rather than by a sale.
create or replace function public.apply_won_account_status() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.stage = 'won' and old.stage is distinct from 'won' then
    update public.accounts
       set status = 'ACTIVE'
     where id = new.account_id
       and status = 'PROSPECT';
  end if;
  return new;
end
$$;

comment on function public.apply_won_account_status() is
  'A won opportunity promotes its account from PROSPECT to ACTIVE (§8.7). One-directional (ADR-020).';

create trigger opportunities_apply_won_account_status
  after update on public.opportunities
  for each row execute function public.apply_won_account_status();

revoke execute on function public.touch_stage_changed_at() from public, anon;
revoke execute on function public.touch_last_activity_at() from public, anon;
revoke execute on function public.apply_won_account_status() from public, anon;
