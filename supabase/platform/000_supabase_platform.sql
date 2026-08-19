-- Supabase platform bootstrap — LOCAL DEVELOPMENT AND CI ONLY.
--
-- On a real Supabase project every object in this file already exists: it is
-- created by the platform, not by the application. It is reproduced here so the
-- application migrations can be applied, exercised and type-generated against a
-- plain PostgreSQL 16 server when the Supabase Docker images are unreachable
-- (see /docs/SETUP.md, "Running without Docker").
--
-- THIS FILE IS NOT A MIGRATION. It never runs against a Supabase project, and
-- nothing in supabase/migrations may depend on anything defined here beyond the
-- objects Supabase itself guarantees:
--   * roles      anon, authenticated, service_role, authenticator, supabase_admin
--   * schemas    auth, extensions, graphql_public
--   * table      auth.users
--   * functions  auth.uid(), auth.jwt(), auth.role(), auth.email()
--
-- The auth.* function bodies are the platform's own definitions: they read the
-- request's JWT claims from the `request.jwt.claims` GUC. Tests impersonate a
-- user by setting that GUC and `set role authenticated`, which is exactly how
-- PostgREST executes a request. That makes an RLS test here a genuine test of
-- the policy, not of a mock.

-- Roles ----------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin login createrole createdb replication bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

-- Schemas --------------------------------------------------------------------
create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists extensions;
create schema if not exists graphql_public;

grant usage on schema auth to anon, authenticated, service_role, postgres;
grant usage on schema extensions to anon, authenticated, service_role, postgres;

-- auth.users -----------------------------------------------------------------
-- The subset of columns the application depends on. Supabase's own table has
-- many more; adding them here would be inventing platform behaviour.
create table if not exists auth.users (
  id                          uuid primary key default gen_random_uuid(),
  instance_id                 uuid,
  aud                         varchar(255),
  role                        varchar(255),
  email                       varchar(255) unique,
  encrypted_password          varchar(255),
  email_confirmed_at          timestamptz,
  invited_at                  timestamptz,
  confirmation_token          varchar(255),
  confirmation_sent_at        timestamptz,
  recovery_token              varchar(255),
  recovery_sent_at            timestamptz,
  last_sign_in_at             timestamptz,
  raw_app_meta_data           jsonb,
  raw_user_meta_data          jsonb,
  is_super_admin              boolean,
  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now(),
  phone                       text unique,
  phone_confirmed_at          timestamptz,
  banned_until                timestamptz,
  deleted_at                  timestamptz
);

alter table auth.users owner to supabase_auth_admin;
grant select on auth.users to postgres, service_role;

-- auth helper functions ------------------------------------------------------
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    (auth.jwt() ->> 'sub')
  ), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.role', true),
    (auth.jwt() ->> 'role')
  ), '')::text
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.email', true),
    (auth.jwt() ->> 'email')
  ), '')::text
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role(), auth.email()
  to anon, authenticated, service_role, postgres;

-- Default privileges ---------------------------------------------------------
-- Supabase grants the API roles table access and relies on RLS for control. The
-- application migrations issue their own grants; this mirrors the platform's
-- baseline so a missing grant fails the same way it would in production.
alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant all on functions to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
