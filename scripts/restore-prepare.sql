-- Everything the archive needs to exist BEFORE pg_restore runs (§18).
--
-- The point of this backup is that it restores WITHOUT SUPABASE — onto a bare
-- PostgreSQL server, in a recovery where the platform is not available. A
-- schema-filtered `pg_dump` carries the *uses* of platform objects without the
-- statements that define them, and pg_dump never dumps roles at all. Three
-- separate things are therefore missing from the archive, and each one fails
-- differently:
--
--   1. EXTENSIONS. pg_trgm and pgcrypto live in an `extensions` schema. Without
--      them the three trigram indexes vanish and `search_crm()` raises on every
--      call — the defect the first restore drill found.
--
--   2. PLATFORM SCHEMAS. If the archive lacks `CREATE SCHEMA storage` — which is
--      what happens when the dumping role cannot see into a schema owned by
--      `supabase_storage_admin` — every storage object fails with
--      `schema "storage" does not exist`, and with `--clean --if-exists` so do the
--      DROPs, because IF EXISTS tolerates a missing table but not a missing schema.
--
--   3. PLATFORM ROLES. Every RLS policy names a grantee: `to authenticated`,
--      `to anon`, `to service_role`. pg_dump does not dump roles, so on a server
--      that has never run Supabase every `CREATE POLICY` fails with
--      `role "authenticated" does not exist` — 45 of them for this schema. The
--      tables come back, the rows come back, and NOT ONE POLICY DOES. That restore
--      reports 14 tables present and is a security failure, which is why
--      verify-restore.sql now counts policies rather than trusting the RLS flag.
--
-- Creating these first is not error suppression: pg_restore still runs with every
-- error visible, and `--clean --if-exists` drops and recreates anything the archive
-- does define, so a complete archive is unaffected by this file.
--
-- Roles are created NOLOGIN and with no password. They exist so that policies can
-- name them; nothing authenticates as them here. On a real Supabase target they
-- already exist and every statement below is a no-op.

\set ON_ERROR_STOP on

-- 1. Platform roles the policies name ----------------------------------------
do $$
declare
  r text;
begin
  foreach r in array array[
    'anon', 'authenticated', 'service_role',
    'authenticator', 'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin'
  ]
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
end $$;

-- 2. Platform schemas the archive expects to already exist --------------------
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

-- 3. Extensions the indexes and functions depend on ---------------------------
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- A restore that cannot create objects produces a database that looks empty for
-- reasons pg_restore reports one line at a time. Say it once, here.
do $$
begin
  if not has_database_privilege(current_database(), 'CREATE') then
    raise exception
      'the restoring role has no CREATE privilege on database % — pg_restore would fail to create every schema',
      current_database();
  end if;
end $$;
