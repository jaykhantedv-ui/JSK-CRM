-- 015 — RLS helper functions (§15.1)
--
-- Every helper is SECURITY DEFINER. That is not a convenience: a policy on
-- `public.users` that selects from `public.users` recurses, and the helpers are
-- how §15.1 breaks the cycle. `set search_path = ''` keeps a caller from
-- resolving these names against a schema of their own.
--
-- Policies call the argument-free helpers wrapped as `(select public.fn())` so the
-- planner evaluates them once per query as an InitPlan rather than once per row
-- (M-19). Helpers taking a row column are called directly — wrapping a correlated
-- reference would defeat the point.

-- The caller's id, but ONLY while their account is active.
--
-- Deactivation must take effect at the database boundary, not merely at login: a
-- JWT issued before deactivation stays valid for up to an hour. Because every
-- ownership test in every policy goes through this function rather than
-- `auth.uid()`, a deactivated user loses access immediately and everywhere.
create or replace function public.current_user_id() returns uuid
language sql stable security definer
set search_path = ''
as $$ select u.id from public.users u where u.id = auth.uid() and u.is_active $$;

create or replace function public.user_role() returns public.user_role
language sql stable security definer
set search_path = ''
as $$ select u.role from public.users u where u.id = auth.uid() and u.is_active $$;

create or replace function public.is_owner() returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(public.user_role() = 'OWNER', false) $$;

-- System administration: users, outlets, settings and imports.
create or replace function public.is_owner_or_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(public.user_role() in ('OWNER','ADMIN'), false) $$;

-- The business-data management tier. ADMIN is deliberately NOT a member
-- (ADR-017): it administers users, configuration and imports, and does not carry
-- an automatic right to read the pipeline. Read "or above" as above SALESPERSON
-- in the SALES hierarchy, which ADMIN is not on.
create or replace function public.is_manager_or_above() returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(public.user_role() in ('MANAGER','OWNER'), false) $$;

-- Outlet scope (ADR-016).
--
-- OWNER is company-wide BY ROLE and is deliberately not modelled as membership of
-- every outlet: enumerating them would silently narrow the owner's access the day
-- an outlet is added. A MANAGER with an empty scope sees only their own records,
-- which is the correct reading of "their assigned outlet scope(s)" when the scope
-- is empty, and makes a newly created manager safe by default.
create or replace function public.manages_outlet(p_outlet uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case public.user_role()
    when 'OWNER' then true
    when 'MANAGER' then exists (
      select 1 from public.user_outlets uo
      where uo.user_id = auth.uid()
        and uo.outlet_id = p_outlet
        and uo.revoked_at is null)
    else false
  end
$$;

-- Does the caller manage this person — do they share an outlet?
create or replace function public.manages_user(p_user uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case public.user_role()
    when 'OWNER' then true
    when 'MANAGER' then exists (
      select 1
      from public.user_outlets mine
      join public.user_outlets theirs on theirs.outlet_id = mine.outlet_id
      where mine.user_id = auth.uid()
        and theirs.user_id = p_user
        and mine.revoked_at is null
        and theirs.revoked_at is null)
    else false
  end
$$;

-- Work-context reads (§3.2, §15.4): a salesperson may read an account or project
-- they do not own only if they own an opportunity attached to it. Archived
-- opportunities are included deliberately, so the archive view still resolves.
create or replace function public.owns_opportunity_on_account(a uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.opportunities o
    where o.account_id = a and o.owner_id = public.current_user_id())
$$;

create or replace function public.owns_opportunity_on_project(p uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.opportunities o
    where o.project_id = p and o.owner_id = public.current_user_id())
$$;

-- Parent-entity visibility, for the tables whose access derives from a parent.
-- These mirror the SELECT policies on `accounts`, `projects` and `opportunities`
-- exactly; changing one without the other is a defect.
create or replace function public.can_read_account(a uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.accounts acc
    where acc.id = a
      and (acc.owner_id = public.current_user_id()
           or public.manages_outlet(acc.outlet_id)
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
           or public.manages_outlet(pr.outlet_id)
           or public.owns_opportunity_on_project(pr.id)))
$$;

create or replace function public.can_write_project(p uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects pr
    where pr.id = p
      and (pr.owner_id = public.current_user_id()
           or public.manages_outlet(pr.outlet_id)))
$$;

create or replace function public.can_read_opportunity(o uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.opportunities opp
    where opp.id = o
      and (opp.owner_id = public.current_user_id()
           or public.manages_outlet(opp.outlet_id)))
$$;

-- A record must not be moved out of its outlet, archived or restored by someone
-- who is not a manager for it (ADR-016, §3.1).
--
-- Expressed as a trigger rather than a policy WITH CHECK because the rule compares
-- the OLD row to the NEW one, and a policy that subqueried its own table to read
-- the old value would recurse.
--
-- Reassignment needs no trigger: the WITH CHECK clauses in 016 already reject it,
-- because after a salesperson changes `owner_id` the row no longer satisfies
-- `owner_id = current_user_id()`.
create or replace function public.guard_record_scope() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- Service-role callers — cron routes and the import executor — have no
  -- `auth.uid()` and already bypass row-level security by design (§15.7). The
  -- guard is the column-level half of the same model, so it bypasses for them
  -- too; applying it would make a maintenance job unable to archive a record no
  -- policy was protecting from it anyway.
  if auth.uid() is null then
    return new;
  end if;

  if new.outlet_id is distinct from old.outlet_id
     and not public.manages_outlet(old.outlet_id) then
    raise exception 'Only a manager for this outlet may move a record to another outlet.'
      using errcode = '42501';
  end if;

  if new.archived_at is distinct from old.archived_at
     and not public.is_manager_or_above() then
    raise exception 'Only a manager or the owner may archive or restore a record.'
      using errcode = '42501';
  end if;

  return new;
end
$$;

-- §15.1: revoke from anon, grant to authenticated. Last in the file so it covers
-- every function defined in 001–015.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
