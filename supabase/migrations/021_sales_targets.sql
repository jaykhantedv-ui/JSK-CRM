-- 021 — sales targets (Master Phase 3, ADR-021)
--
-- THE FOURTEENTH TABLE. §4.1 says "eleven tables, no more"; ADR-016 added
-- `outlets` and `user_outlets` as the twelfth and thirteenth. Adding another one
-- requires explicit approval recorded in /docs/DECISIONS.md BEFORE the migration
-- is written (CLAUDE.md §4) — ADR-021 is that record, and it explains why
-- `system_settings` could not carry this.
--
-- The short version: `system_settings_select` deliberately grants EVERY
-- authenticated user read on EVERY settings row, because stage probabilities and
-- the city list are needed to render almost any screen. A monthly sales target is
-- management data. Putting targets in `system_settings` would publish the
-- company's target to every salesperson through a single PostgREST call, and no
-- amount of UI gating would change that (CLAUDE.md §6).
--
-- A target is a PLANNING FIGURE, not an accounting record (§2.2). Nothing here
-- feeds a ledger, and no metric anywhere depends on a target existing.

create table public.sales_targets (
  id           uuid primary key default gen_random_uuid(),
  -- Always the first day of the month, in Asia/Kolkata terms. A `date` rather
  -- than a year/month pair so period comparisons are ordinary date arithmetic.
  period_month date   not null,
  -- The scope ladder. null outlet = company-wide; null user = the whole outlet.
  outlet_id    uuid references public.outlets(id),
  user_id      uuid references public.users(id),
  -- Money is bigint paise (§8.11). Zero is a legitimate value and means "no
  -- target this month"; it is how a target is withdrawn, because nothing in this
  -- schema is ever hard-deleted (§8.8) and this table has no DELETE policy.
  target_paise bigint not null check (target_paise >= 0),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.users(id),
  updated_by   uuid references public.users(id),

  constraint target_period_is_month_start check (period_month = date_trunc('month', period_month)::date),
  -- A person's target is always a target AT an outlet. Without this a user-level
  -- row could carry a null outlet, and the RLS policy below — which reads scope
  -- from `outlet_id` alone — would have to fall back to "is the owner", silently
  -- hiding a salesperson's target from the manager who set it.
  constraint target_user_requires_outlet check (user_id is null or outlet_id is not null)
);

-- One target per scope per month. Three partial indexes rather than one over
-- nullable columns, because in PostgreSQL `null` is distinct from `null` in a
-- unique index and a plain three-column unique constraint would permit unlimited
-- duplicate company rows.
create unique index sales_targets_company_month
  on public.sales_targets (period_month)
  where outlet_id is null and user_id is null;
create unique index sales_targets_outlet_month
  on public.sales_targets (period_month, outlet_id)
  where outlet_id is not null and user_id is null;
create unique index sales_targets_user_month
  on public.sales_targets (period_month, outlet_id, user_id)
  where user_id is not null;

create index sales_targets_period_idx on public.sales_targets (period_month desc);

create trigger sales_targets_touch_updated_at
  before update on public.sales_targets
  for each row execute function public.touch_updated_at();

alter table public.sales_targets enable row level security;

grant select, insert, update on public.sales_targets to authenticated;
grant all on public.sales_targets to service_role;

-- ------------------------------------------------------------------ RLS ----
--
-- Shape as everywhere else: SELECT, INSERT, UPDATE. **No DELETE policy** — the
-- schema still holds exactly one, on `project_stakeholders` (ADR-004).
--
-- Scope reads directly off `outlet_id`:
--   outlet_id is null  → company-wide, OWNER only
--   outlet_id set      → the managers of that outlet, and OWNER by role
--
-- SALESPERSON matches neither branch and sees nothing, including their own
-- target: a target is a management planning figure and §4 of the Master Phase 3
-- brief keeps management data off the salesperson's surface. ADMIN matches
-- neither branch either — ADR-017, system administration is not sales management.
create policy sales_targets_select on public.sales_targets for select to authenticated
  using (
    case when outlet_id is null
      then (select public.is_owner())
      else public.manages_outlet(outlet_id)
    end
  );

create policy sales_targets_insert on public.sales_targets for insert to authenticated
  with check (
    case when outlet_id is null
      then (select public.is_owner())
      else public.manages_outlet(outlet_id)
    end
  );

create policy sales_targets_update on public.sales_targets for update to authenticated
  using (
    case when outlet_id is null
      then (select public.is_owner())
      else public.manages_outlet(outlet_id)
    end
  )
  with check (
    case when outlet_id is null
      then (select public.is_owner())
      else public.manages_outlet(outlet_id)
    end
  );

-- A target must not be moved between outlets by someone who does not manage the
-- outlet it currently belongs to. The WITH CHECK above only proves the caller
-- manages the DESTINATION; without this, a manager of outlet B could re-point
-- outlet A's target at B and, in doing so, quietly erase it from A's reporting.
-- Same reasoning, and the same shape, as `guard_record_scope()` in 015.
create or replace function public.guard_target_scope() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.outlet_id is distinct from old.outlet_id then
    if old.outlet_id is null then
      if not public.is_owner() then
        raise exception 'Only the owner may change a company-wide target.' using errcode = '42501';
      end if;
    elsif not public.manages_outlet(old.outlet_id) then
      raise exception 'Only a manager for this branch may move its target.' using errcode = '42501';
    end if;
  end if;

  return new;
end
$$;

comment on function public.guard_target_scope() is
  'Stops a target being re-pointed out of an outlet the caller does not manage (ADR-021).';

create trigger sales_targets_guard_scope
  before update on public.sales_targets
  for each row execute function public.guard_target_scope();

-- Revoked, and deliberately NOT granted to `authenticated`. It is a SECURITY
-- DEFINER trigger function; it runs as a trigger and nothing may call it
-- directly. The same treatment the 018 trigger functions get, for the same
-- reason (`tests/integration/service-contracts.test.ts`).
revoke execute on function public.guard_target_scope() from public, anon, authenticated;

comment on table public.sales_targets is
  'Monthly sales targets by company, outlet or salesperson. Management planning figures, '
  'never accounting records (ADR-021).';
