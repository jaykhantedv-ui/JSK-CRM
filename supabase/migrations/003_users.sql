-- 003 — users (§5.2), the system actor (ADR-003) and auth mirroring (ADR-009)
--
-- `public.users` mirrors `auth.users`; `id` is the Supabase auth uid.
-- `branch` is NOT present: it is retired and replaced by the `user_outlets` link
-- table in 004 (ADR-016).

create table public.users (
  id            uuid primary key references auth.users(id) on delete restrict,
  full_name     text not null,
  email         text not null unique,
  phone         text,
  role          public.user_role not null default 'SALESPERSON',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index users_role_active_idx on public.users (role) where is_active;

create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public.touch_updated_at();

-- The system actor (ADR-003).
--
-- `opportunity_events.actor_id` is not null and the trigger derives it from
-- `auth.uid()`. Service-role callers — cron routes and the import executor — have
-- no `auth.uid()`, so without this row every automated write touching `stage` or
-- `owner_id` would abort on a not-null violation.
--
-- It is `is_active = false`, so `user_role()` returns null for it, it can never
-- pass an RLS policy, and it can never authenticate. Every user list, digest and
-- workload report filters on `is_active`, which excludes it for free.
create or replace function public.system_user_id() returns uuid
language sql immutable parallel safe
set search_path = ''
as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;

comment on function public.system_user_id() is
  'The dedicated system actor for automated writes (ADR-003). Never a real person.';

insert into auth.users (id, email, aud, role, created_at, updated_at)
values (public.system_user_id(), 'system@jsk-crm.internal', 'authenticated', 'authenticated', now(), now())
on conflict (id) do nothing;

insert into public.users (id, full_name, email, role, is_active)
values (public.system_user_id(), 'JSK CRM System', 'system@jsk-crm.internal', 'ADMIN', false)
on conflict (id) do nothing;

-- Mirror a new auth user into `public.users` (ADR-009).
--
-- The role is ALWAYS 'SALESPERSON' here, never read from user metadata: metadata
-- travels with the sign-up payload, and honouring a role from it would turn user
-- creation into a role-escalation vector. The provisioning Server Action sets the
-- real role afterwards, server-side, and only after its OWNER/ADMIN check.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.users (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- RLS on, from the moment the table exists (SPEC_AUDIT H-04). The policies
-- themselves arrive in 016, where the whole authorization model can be read at
-- once; until then this table denies everything to every role but its owner, so
-- no intermediate state of the migration sequence is readable.
alter table public.users enable row level security;
