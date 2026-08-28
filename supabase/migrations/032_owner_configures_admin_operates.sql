-- 032 — the administrator runs the business; the owner controls the system (ADR-042)
--
-- WHAT THE AUDIT FOUND. ADR-040 gave ADMIN read of every operational record so it
-- could supervise the sales heads. It did not revisit what ADMIN could already
-- WRITE, and two of those turned out to be system control rather than business
-- operation. Both were reproduced against a real database, as ADMIN, through
-- plain SQL — no UI involved, which is the only way that matters (§15):
--
--   1. `update public.system_settings set value = '99999999'
--        where key = 'high_value_threshold_paise'`            SUCCEEDED
--
--      Every threshold the business runs on — the high-value line, the taluk
--      list, the stage probabilities, the dormancy windows, the SLA — was
--      writable by an administrator. Those are the values §24 exists to keep
--      under the Project Owner's control.
--
--   2. `update public.users set role='OWNER', manager_id=null where id=<any>`  SUCCEEDED
--      `update public.users set is_active=false where role='OWNER'`            SUCCEEDED
--
--      **Full privilege escalation.** An administrator could mint a second owner
--      and deactivate the real one in two statements. `current_user_id()` filters
--      on `is_active`, so the deactivated owner instantly loses every policy in
--      the schema — locked out of their own deployment with no way back in
--      short of `deploy/bootstrap-owner.sh`.
--
-- Neither was reachable through the interface. Both were reachable with the
-- caller's own JWT and a PostgREST call, which is the definition of a real one.
--
-- WHAT THIS DOES NOT DO. It does not narrow what ADMIN may READ — ADR-040 stands,
-- and the administrator still sees every operational record. It does not touch
-- the sales hierarchy, outlet scope, or any policy on business data.

-- --------------------------------------------------- global configuration ----
--
-- `system_settings` holds the twelve business decisions of §24 and the two
-- operational counters of ADR-014. Changing one changes how the CRM behaves for
-- everybody, without a deploy — that is the whole point of the table, and the
-- reason it is the OWNER's alone.
--
-- SELECT is unchanged and deliberately open: stage probabilities and the taluk
-- list are needed to render almost any screen.
--
-- The maintenance cron writes its two counters through the SERVICE ROLE, which
-- is `BYPASSRLS` and unaffected (ADR-014).
drop policy if exists system_settings_insert on public.system_settings;
create policy system_settings_insert on public.system_settings for insert to authenticated
  with check ((select public.is_owner()));

drop policy if exists system_settings_update on public.system_settings;
create policy system_settings_update on public.system_settings for update to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

-- ------------------------------------------------------- the owner's row ----
--
-- Only an OWNER may create an owner, or touch one.
--
-- A SEPARATE trigger from `guard_user_hierarchy()`, on purpose: that one keeps
-- the reporting line a legal SHAPE, and this one protects a PRIVILEGE. A reviewer
-- asking "what stops an administrator taking over" should find one function whose
-- name says so, not a clause buried in a shape check.
--
-- It was only ever coincidence that stopped this before: demoting the fixture
-- owner failed because that owner had a direct report, so the hierarchy guard
-- fired first. Clear `manager_id` in the same statement, or pick an owner with no
-- reports, and it went through.
--
-- SERVICE-ROLE CALLERS ARE EXEMPT, as they are from every other guard here:
-- `auth.uid()` is null for `deploy/bootstrap-owner.sh` (which creates the first
-- owner and must) and for the provisioning Server Action's admin client. That
-- carve-out is why `user.service.ts` performs the same check BEFORE it touches
-- the admin client — the ordering ADR-009 already requires.
create or replace function public.guard_owner_role() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- No session, no check: the service role and the bootstrap path are trusted by
  -- construction and are gated in the code that holds the key (§15.7, ADR-009).
  if auth.uid() is null then
    return new;
  end if;

  -- Minting an owner.
  if new.role = 'OWNER' and (tg_op = 'INSERT' or old.role is distinct from 'OWNER') then
    if not public.is_owner() then
      raise exception 'Only the owner can make somebody an owner.' using errcode = '42501';
    end if;
  end if;

  -- Changing an owner: their role, their name, their reporting line, and above
  -- all whether they are still active. An owner editing themselves passes.
  if tg_op = 'UPDATE' and old.role = 'OWNER' and not public.is_owner() then
    raise exception 'Only the owner can change the owner''s account.' using errcode = '42501';
  end if;

  return new;
end
$$;

comment on function public.guard_owner_role() is
  'Only an OWNER may create, alter or deactivate an OWNER. Protects the privilege, '
  'not the shape — guard_user_hierarchy() does the shape (ADR-042).';

-- TRIGGER ORDER IS THE MESSAGE. PostgreSQL fires BEFORE triggers in NAME order,
-- and both guards refuse an administrator demoting the owner — but for different
-- reasons, and only one of them is the true one. Left alone, `users_guard_
-- hierarchy` answered first with "This person still has direct reports. Move
-- their team first", which reads as a solvable ordering problem rather than a
-- refusal of privilege. The numeric prefixes make the order explicit rather than
-- accidental.
drop trigger if exists users_guard_owner_role on public.users;
drop trigger if exists users_guard_hierarchy on public.users;

create trigger users_guard_1_owner_privilege
  before insert or update on public.users
  for each row execute function public.guard_owner_role();

create trigger users_guard_2_hierarchy_shape
  before insert or update on public.users
  for each row execute function public.guard_user_hierarchy();

-- A trigger body and nothing else, like every other guard in this schema.
revoke execute on function public.guard_owner_role() from public, anon, authenticated;
