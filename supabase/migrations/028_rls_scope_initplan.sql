-- 028 — Evaluate outlet scope once per query instead of once per row.
--
-- WHAT WAS WRONG
--
-- Every scoped policy read `manages_outlet(outlet_id)`. That takes a row column,
-- so the planner has to call it for each row it cannot short-circuit, and each
-- call is a SECURITY DEFINER function that re-reads `public.users` for the
-- caller's role and then probes `user_outlets`. Measured on 20,005 opportunities
-- as a salesperson: 792 ms with RLS against 4.8 ms without it — a 165x tax, paid
-- on `/today`, on every list, and on every search, from a phone.
--
-- §15.1 already names the fix and applies it to the argument-free helpers:
-- wrap them as `(select public.fn())` so the planner lifts them into an InitPlan
-- evaluated once. That note also explains why `manages_outlet` was left alone —
-- "wrapping a correlated reference would defeat the point" — which is true of the
-- wrapping, but not of the predicate. The scope test does not need a function
-- call per row; it needs set membership against a set computed once.
--
-- WHAT THIS DOES
--
--   manages_outlet(outlet_id)
--     becomes
--   (select public.is_owner()) or outlet_id in (select public.scoped_outlet_ids())
--
-- Both halves are uncorrelated, so both are evaluated once per query: `is_owner()`
-- as an InitPlan, `scoped_outlet_ids()` as a hashed SubPlan the row test probes.
-- `scoped_outlet_ids()` is not new and this is not a new pattern — migration 022
-- already scopes the management RPCs with `in (select public.scoped_outlet_ids())`.
--
-- WHY IT IS THE SAME RULE, ROLE BY ROLE
--
--   OWNER        `manages_outlet` returned true unconditionally. `is_owner()` is
--                true and short-circuits, so every row still matches — including
--                rows on a DEACTIVATED outlet. This is why the owner test is a
--                separate disjunct rather than leaning on `scoped_outlet_ids()`,
--                whose OWNER branch lists only `is_active` outlets: collapsing the
--                two would have quietly taken a closed outlet's history away from
--                the owner.
--   MANAGER      `exists (user_outlets where user_id = auth.uid() and revoked_at
--                is null)` against membership of the same set, built by the same
--                query inside `scoped_outlet_ids()`. Identical, including the
--                revoked-at rule and the empty-scope case (ADR-016: a manager with
--                no outlets sees only their own records).
--   SALESPERSON  false, then; both disjuncts false, now. Access still comes from
--   / ADMIN      `owner_id`, and ADMIN still gets no business data (ADR-017).
--   deactivated  `user_role()` returns null for an inactive user, so both helpers
--                return false exactly as `manages_outlet` did.
--
-- Nothing about who may see what changes. The whole of tests/integration —
-- crm-permissions, rls-outlet-scope and management-scope — is the proof, and it
-- passes unchanged.

-- accounts ------------------------------------------------------------------
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
  -- Work context (§3.2): a salesperson who owns an opportunity on this account
  -- can see the account. Still correlated, and still cheap next to the scope
  -- test because it is only reached for rows the first three disjuncts reject.
  or public.owns_opportunity_on_account(id)
);

drop policy if exists accounts_insert on public.accounts;
create policy accounts_insert on public.accounts for insert to authenticated
with check (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
);

drop policy if exists accounts_update on public.accounts;
create policy accounts_update on public.accounts for update to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
)
with check (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
);

-- opportunities -------------------------------------------------------------
drop policy if exists opportunities_select on public.opportunities;
create policy opportunities_select on public.opportunities for select to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
);

drop policy if exists opportunities_insert on public.opportunities;
create policy opportunities_insert on public.opportunities for insert to authenticated
with check (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
);

drop policy if exists opportunities_update on public.opportunities;
create policy opportunities_update on public.opportunities for update to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
)
with check (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
);

-- projects ------------------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
  or public.owns_opportunity_on_project(id)
);

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated
with check (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
);

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated
using (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
)
with check (
  owner_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
);

-- sales_targets -------------------------------------------------------------
-- A target with a null outlet is a company-wide target and is the owner's alone
-- (ADR-021); that branch was already an InitPlan and is unchanged.
drop policy if exists sales_targets_select on public.sales_targets;
create policy sales_targets_select on public.sales_targets for select to authenticated
using (
  case when outlet_id is null then (select public.is_owner())
       else (select public.is_owner()) or outlet_id in (select public.scoped_outlet_ids())
  end
);

drop policy if exists sales_targets_insert on public.sales_targets;
create policy sales_targets_insert on public.sales_targets for insert to authenticated
with check (
  case when outlet_id is null then (select public.is_owner())
       else (select public.is_owner()) or outlet_id in (select public.scoped_outlet_ids())
  end
);

drop policy if exists sales_targets_update on public.sales_targets;
create policy sales_targets_update on public.sales_targets for update to authenticated
using (
  case when outlet_id is null then (select public.is_owner())
       else (select public.is_owner()) or outlet_id in (select public.scoped_outlet_ids())
  end
)
with check (
  case when outlet_id is null then (select public.is_owner())
       else (select public.is_owner()) or outlet_id in (select public.scoped_outlet_ids())
  end
);

-- user_outlets --------------------------------------------------------------
drop policy if exists user_outlets_select on public.user_outlets;
create policy user_outlets_select on public.user_outlets for select to authenticated
using (
  user_id = (select public.current_user_id())
  or (select public.is_owner())
  or outlet_id in (select public.scoped_outlet_ids())
  or (select public.is_owner_or_admin())
);

-- `manages_outlet` is deliberately NOT dropped. It is still the readable way to
-- ask the question from application code and from a psql session, and dropping a
-- function that migration 015 created would break anything holding a reference to
-- it. It simply is no longer used inside a row predicate.
comment on function public.manages_outlet(uuid) is
  'Does the caller manage this outlet? OWNER always; MANAGER by non-revoked '
  'user_outlets membership. NOT for use inside an RLS row predicate — it is '
  'evaluated per row. Policies use `(select is_owner()) or x in (select '
  'scoped_outlet_ids())`, which the planner evaluates once per query (028).';
