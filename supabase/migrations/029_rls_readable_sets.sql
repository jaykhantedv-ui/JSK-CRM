-- 029 — The rest of the per-row policy calls become per-query sets.
--
-- 028 fixed the outlet-scope predicate. Three correlated calls were left, and at
-- 20,005 opportunities / 8,004 accounts, measured as a salesperson, they cost:
--
--   accounts           owns_opportunity_on_account(id)   3,754 ms
--   opportunity_events can_read_opportunity(opp_id)      3,277 ms
--   activities         can_read_account(account_id)      (same shape)
--
-- Each is a SECURITY DEFINER function taking a row column, so it runs once per
-- row, and `can_read_*` internally calls `manages_outlet` — the per-row helper
-- 028 just took out of the policies. These are the accounts list, the Customer
-- 360 timeline and the audit history: the screens the business actually opens.
--
-- THE RULE IS NOT RESTATED ANYWHERE
--
-- The obvious fix — inline "owner or outlet scope" into a set-returning function —
-- would copy the authorization rule into a second place, and CLAUDE.md §8 is
-- explicit that a rule lives in one place. So the two `readable_*` helpers below
-- are SECURITY **INVOKER**: they simply select ids from the parent table and let
-- that table's own RLS policy filter them. The policy stays the single definition
-- of who may read a row; these functions only make the planner ask it once per
-- query instead of once per row.
--
-- No recursion is introduced. `opportunity_events` reads `opportunities`, and
-- `activities` reads `accounts`; neither of those tables' policies refers back.

-- The accounts a salesperson reaches through work context (§3.2) — they own an
-- opportunity sitting on someone else's account. SECURITY DEFINER, because this
-- is an ownership lookup rather than a readability test, and it must not be
-- filtered by the very policy it feeds. Same predicate as
-- `owns_opportunity_on_account`, asked once.
create or replace function public.my_opportunity_account_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select distinct o.account_id
    from public.opportunities o
   where o.owner_id = public.current_user_id()
     and o.account_id is not null
$$;

create or replace function public.my_opportunity_project_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select distinct o.project_id
    from public.opportunities o
   where o.owner_id = public.current_user_id()
     and o.project_id is not null
$$;

-- SECURITY INVOKER, deliberately: the row filter is `opportunities`' own SELECT
-- policy, not a copy of it.
create or replace function public.readable_opportunity_ids() returns setof uuid
language sql stable security invoker
set search_path = ''
as $$ select o.id from public.opportunities o $$;

create or replace function public.readable_account_ids() returns setof uuid
language sql stable security invoker
set search_path = ''
as $$ select a.id from public.accounts a $$;

revoke execute on function public.my_opportunity_account_ids() from public, anon;
revoke execute on function public.my_opportunity_project_ids() from public, anon;
revoke execute on function public.readable_opportunity_ids()   from public, anon;
revoke execute on function public.readable_account_ids()       from public, anon;
grant execute on function public.my_opportunity_account_ids() to authenticated, service_role;
grant execute on function public.my_opportunity_project_ids() to authenticated, service_role;
grant execute on function public.readable_opportunity_ids()   to authenticated, service_role;
grant execute on function public.readable_account_ids()       to authenticated, service_role;

-- accounts: work context becomes set membership ------------------------------
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
  or id in (select public.my_opportunity_account_ids())
);

-- projects: the same -----------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
  or id in (select public.my_opportunity_project_ids())
);

-- opportunity_events: readable exactly when its opportunity is ----------------
-- Still append-only, still no UPDATE and no DELETE policy for any role (§9.2).
drop policy if exists opportunity_events_select on public.opportunity_events;
create policy opportunity_events_select on public.opportunity_events for select to authenticated
using (opportunity_id in (select public.readable_opportunity_ids()));

-- activities: readable exactly when its account is ----------------------------
-- The 24-hour author edit window (§5.8) lives in the UPDATE policy and is
-- untouched; only the SELECT predicate changes shape.
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated
using (account_id in (select public.readable_account_ids()));

comment on function public.readable_opportunity_ids() is
  'Opportunity ids the caller may read. SECURITY INVOKER on purpose: the filter '
  'is opportunities'' own RLS policy, so the rule is not restated here (029).';
comment on function public.readable_account_ids() is
  'Account ids the caller may read. SECURITY INVOKER on purpose: the filter is '
  'accounts'' own RLS policy, so the rule is not restated here (029).';
