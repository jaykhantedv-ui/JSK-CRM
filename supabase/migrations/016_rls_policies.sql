-- 016 — row-level security (§15)
--
-- RLS IS THE AUTHORIZATION BOUNDARY. Frontend filtering is not a control and a
-- hidden button is not a control: every rule here must hold against a direct
-- PostgREST call carrying a salesperson's JWT.
--
-- Shape, for every table: SELECT, INSERT, UPDATE.
-- NO DELETE POLICY ANYWHERE, with exactly one approved exception —
-- `project_stakeholders` (ADR-004). A reviewer grepping this file for `for delete`
-- must find one policy. A second one means the flow is wrong.
--
-- The permission model (ADR-016, ADR-017):
--   SALESPERSON  own records, plus work context — an account or project they do
--                not own, but on which they own an opportunity
--   MANAGER      the outlets in their scope, which may be zero, one or many
--   OWNER        company-wide
--   ADMIN        users, outlets, settings and imports. NO automatic business data.

-- ---------------------------------------------------------------- grants ----
-- PostgREST reaches tables as `authenticated`; RLS is what constrains it. New
-- tables are not auto-exposed, so the grants are explicit.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
-- The single approved hard delete (ADR-004).
grant delete on public.project_stakeholders to authenticated;

-- RLS is already enabled in each table's own migration (SPEC_AUDIT H-04). This
-- block re-asserts it so that a table added later without it fails the audit
-- here rather than silently shipping unprotected.
do $$
declare
  t text;
  unprotected text[] := '{}';
begin
  foreach t in array array[
    'users','outlets','user_outlets','accounts','contacts','projects',
    'project_stakeholders','opportunities','activities','opportunity_events',
    'system_settings','import_batches','import_rows'
  ] loop
    if not (select c.relrowsecurity from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = t) then
      unprotected := unprotected || t;
    end if;
  end loop;

  if array_length(unprotected, 1) is not null then
    raise exception 'Row-level security is not enabled on: %', array_to_string(unprotected, ', ');
  end if;
end $$;

-- ----------------------------------------------------------------- users ----
create policy users_select on public.users for select to authenticated
  using (
    id = (select public.current_user_id())
    or public.manages_user(id)
    or (select public.is_owner_or_admin())
  );

-- The `role = user_role()` clause is what stops self-escalation: a salesperson
-- editing their own profile cannot change their own role. `user_role()` returns
-- null for a deactivated user, so the comparison is null and the update is
-- refused — a deactivated user cannot reactivate themselves either.
create policy users_update_self on public.users for update to authenticated
  using (id = (select public.current_user_id()))
  with check (id = (select public.current_user_id()) and role = (select public.user_role()));

-- §15.3 specified these as one `for all` policy. `for all` includes DELETE, which
-- would put a second delete grant in the schema and contradict §15.2. Split into
-- explicit INSERT and UPDATE; SELECT is already covered above.
create policy users_admin_insert on public.users for insert to authenticated
  with check ((select public.is_owner_or_admin()));
create policy users_admin_update on public.users for update to authenticated
  using ((select public.is_owner_or_admin()))
  with check ((select public.is_owner_or_admin()));

-- --------------------------------------------------------------- outlets ----
-- Every authenticated user reads the outlet list: a record shows the outlet it
-- belongs to, and an outlet name is not confidential. Only OWNER/ADMIN maintain it.
create policy outlets_select on public.outlets for select to authenticated
  using ((select public.current_user_id()) is not null);
create policy outlets_insert on public.outlets for insert to authenticated
  with check ((select public.is_owner_or_admin()));
create policy outlets_update on public.outlets for update to authenticated
  using ((select public.is_owner_or_admin()))
  with check ((select public.is_owner_or_admin()));

-- ---------------------------------------------------------- user_outlets ----
create policy user_outlets_select on public.user_outlets for select to authenticated
  using (
    user_id = (select public.current_user_id())
    or public.manages_outlet(outlet_id)
    or (select public.is_owner_or_admin())
  );
create policy user_outlets_insert on public.user_outlets for insert to authenticated
  with check ((select public.is_owner_or_admin()));
-- Moving a user between outlets sets `revoked_at`; there is no delete.
create policy user_outlets_update on public.user_outlets for update to authenticated
  using ((select public.is_owner_or_admin()))
  with check ((select public.is_owner_or_admin()));

-- -------------------------------------------------------------- accounts ----
create policy accounts_select on public.accounts for select to authenticated
  using (
    owner_id = (select public.current_user_id())
    or public.manages_outlet(outlet_id)
    or public.owns_opportunity_on_account(id)
  );

create policy accounts_insert on public.accounts for insert to authenticated
  with check (
    owner_id = (select public.current_user_id())
    or public.manages_outlet(outlet_id)
  );

-- A salesperson cannot reassign: after changing `owner_id` to somebody else the
-- row no longer satisfies `owner_id = current_user_id()`, so the check fails.
-- Moving the record to another outlet, and archiving it, are blocked by
-- `guard_record_scope()` below.
create policy accounts_update on public.accounts for update to authenticated
  using (
    owner_id = (select public.current_user_id())
    or public.manages_outlet(outlet_id)
  )
  with check (
    owner_id = (select public.current_user_id())
    or public.manages_outlet(outlet_id)
  );

create trigger accounts_guard_scope
  before update on public.accounts
  for each row execute function public.guard_record_scope();

-- -------------------------------------------------------------- contacts ----
-- A contact has no outlet of its own: it is reachable through the account it
-- belongs to, or through the person who owns it.
create policy contacts_select on public.contacts for select to authenticated
  using (
    owner_id = (select public.current_user_id())
    or (account_id is not null and public.can_read_account(account_id))
    or (linked_account_id is not null and public.can_read_account(linked_account_id))
    or public.manages_user(owner_id)
  );

create policy contacts_insert on public.contacts for insert to authenticated
  with check (
    owner_id = (select public.current_user_id())
    or (select public.is_manager_or_above())
  );

create policy contacts_update on public.contacts for update to authenticated
  using (owner_id = (select public.current_user_id()) or public.manages_user(owner_id))
  with check (owner_id = (select public.current_user_id()) or public.manages_user(owner_id));

-- -------------------------------------------------------------- projects ----
create policy projects_select on public.projects for select to authenticated
  using (
    owner_id = (select public.current_user_id())
    or public.manages_outlet(outlet_id)
    or public.owns_opportunity_on_project(id)
  );

create policy projects_insert on public.projects for insert to authenticated
  with check (
    owner_id = (select public.current_user_id())
    or public.manages_outlet(outlet_id)
  );

create policy projects_update on public.projects for update to authenticated
  using (owner_id = (select public.current_user_id()) or public.manages_outlet(outlet_id))
  with check (owner_id = (select public.current_user_id()) or public.manages_outlet(outlet_id));

create trigger projects_guard_scope
  before update on public.projects
  for each row execute function public.guard_record_scope();

-- -------------------------------------------------- project_stakeholders ----
create policy project_stakeholders_select on public.project_stakeholders for select to authenticated
  using (public.can_read_project(project_id));
create policy project_stakeholders_insert on public.project_stakeholders for insert to authenticated
  with check (public.can_write_project(project_id));
create policy project_stakeholders_update on public.project_stakeholders for update to authenticated
  using (public.can_write_project(project_id))
  with check (public.can_write_project(project_id));

-- THE ONE APPROVED DELETE POLICY IN THE SCHEMA (ADR-004). Scoped identically to
-- UPDATE: whoever may update the parent project may remove a stakeholder from it,
-- and nobody else may.
create policy project_stakeholders_delete on public.project_stakeholders for delete to authenticated
  using (public.can_write_project(project_id));

-- --------------------------------------------------------- opportunities ----
create policy opportunities_select on public.opportunities for select to authenticated
  using (
    owner_id = (select public.current_user_id())
    or public.manages_outlet(outlet_id)
  );

create policy opportunities_insert on public.opportunities for insert to authenticated
  with check (
    owner_id = (select public.current_user_id())
    or public.manages_outlet(outlet_id)
  );

-- §15.5: manager+ may change any field; the owner may change any field EXCEPT
-- `owner_id`. The WITH CHECK expresses the exception directly — reassigning to
-- anyone else, or to nobody, leaves the row failing `owner_id = current_user_id()`.
create policy opportunities_update on public.opportunities for update to authenticated
  using (owner_id = (select public.current_user_id()) or public.manages_outlet(outlet_id))
  with check (owner_id = (select public.current_user_id()) or public.manages_outlet(outlet_id));

create trigger opportunities_guard_scope
  before update on public.opportunities
  for each row execute function public.guard_record_scope();

-- ------------------------------------------------------------ activities ----
create policy activities_select on public.activities for select to authenticated
  using (public.can_read_account(account_id));

create policy activities_insert on public.activities for insert to authenticated
  with check (
    performed_by = (select public.current_user_id())
    and public.can_read_account(account_id)
  );

-- Append-only with a 24-hour edit window for the AUTHOR (§5.8, §8.10). Enforced
-- here, not in the UI. Immutable afterwards; corrections are appended as a new
-- NOTE activity. There is no delete policy — for anybody, ever.
create policy activities_update on public.activities for update to authenticated
  using (
    performed_by = (select public.current_user_id())
    and created_at > now() - interval '24 hours'
  )
  with check (
    performed_by = (select public.current_user_id())
    and created_at > now() - interval '24 hours'
  );

-- ---------------------------------------------------- opportunity_events ----
-- SELECT only. No INSERT policy: the trigger in 013 runs as the table owner and
-- is the single writer, so no caller can forge an event (ADR-001). No UPDATE and
-- no DELETE policy for any role, INCLUDING OWNER — historical stage changes are
-- never deleted or rewritten (§9.2).
create policy opportunity_events_select on public.opportunity_events for select to authenticated
  using (public.can_read_opportunity(opportunity_id));

-- ------------------------------------------------------- system_settings ----
-- Every authenticated user reads settings: stage probabilities and the city list
-- are needed to render almost any screen. Only OWNER/ADMIN write.
create policy system_settings_select on public.system_settings for select to authenticated
  using ((select public.current_user_id()) is not null);
create policy system_settings_insert on public.system_settings for insert to authenticated
  with check ((select public.is_owner_or_admin()));
create policy system_settings_update on public.system_settings for update to authenticated
  using ((select public.is_owner_or_admin()))
  with check ((select public.is_owner_or_admin()));

-- ----------------------------------------------------------------import ----
-- Import is OWNER/ADMIN only (§3.1).
create policy import_batches_select on public.import_batches for select to authenticated
  using ((select public.is_owner_or_admin()));
create policy import_batches_insert on public.import_batches for insert to authenticated
  with check ((select public.is_owner_or_admin()));
create policy import_batches_update on public.import_batches for update to authenticated
  using ((select public.is_owner_or_admin()))
  with check ((select public.is_owner_or_admin()));

create policy import_rows_select on public.import_rows for select to authenticated
  using ((select public.is_owner_or_admin()));
create policy import_rows_insert on public.import_rows for insert to authenticated
  with check ((select public.is_owner_or_admin()));
create policy import_rows_update on public.import_rows for update to authenticated
  using ((select public.is_owner_or_admin()))
  with check ((select public.is_owner_or_admin()));
