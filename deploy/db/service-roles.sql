-- Align the Supabase service roles' passwords with POSTGRES_PASSWORD.
--
-- WHY THIS EXISTS. The `supabase/postgres` image creates `authenticator`,
-- `supabase_auth_admin` and `supabase_storage_admin` itself, during initdb, with
-- the image's own built-in passwords. `POSTGRES_PASSWORD` is applied by the
-- entrypoint to the `postgres` SUPERUSER and to nothing else. docker-compose.yml
-- hands PostgREST, GoTrue and Storage a connection string built from
-- POSTGRES_PASSWORD, so without this step all three are handed a password the
-- database never assigned to their role:
--
--     FATAL: password authentication failed for user "supabase_auth_admin"
--     FATAL: password authentication failed for user "authenticator"
--     FATAL: password authentication failed for user "supabase_storage_admin"
--
-- while `db` itself looks perfectly healthy, because `pg_isready` and every
-- `psql -U postgres` check use the superuser whose password IS set. Upstream
-- Supabase's own self-hosting compose solves this the same way, with a `roles.sql`
-- that re-assigns these passwords after initdb.
--
-- SAFETY. `alter role ... password` is idempotent and touches no data, so this is
-- safe to run on every start — on a fresh volume and on one that already holds the
-- business database alike. It only ever ALTERs: the roles are the platform's to
-- create, and a role this file does not find is skipped rather than invented, so a
-- genuinely broken image fails the verification step loudly instead of being
-- papered over here.
--
-- The password is read from the DATABASE CONTAINER'S OWN ENVIRONMENT by psql, so
-- it never appears in a command line, in this file, or in any output. Nothing here
-- prints it: the generated `alter role` statements are executed inside a DO block
-- rather than returned as rows.
--
-- Run as the `postgres` superuser:
--     psql -v ON_ERROR_STOP=1 -f deploy/db/service-roles.sql
-- deploy/db-credentials.sh does exactly that, inside the db container.

\set ON_ERROR_STOP on
\set pgpass `echo "$POSTGRES_PASSWORD"`

-- `select set_config(...)` returns the value it set, so its output is discarded.
\o /dev/null
select set_config('jsk.bootstrap_password', :'pgpass', false);
\o

do $$
declare
  role_name text;
  aligned   int := 0;
  missing   text[] := '{}';
begin
  if coalesce(current_setting('jsk.bootstrap_password', true), '') = '' then
    raise exception
      'POSTGRES_PASSWORD is empty in the database container environment; refusing to set blank service-role passwords';
  end if;

  foreach role_name in array array[
    'authenticator',          -- PostgREST connects as this and switches role per request
    'supabase_auth_admin',    -- GoTrue owns the auth schema
    'supabase_storage_admin'  -- storage-api owns the storage schema
  ]
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('alter role %I with password %L', role_name,
                     current_setting('jsk.bootstrap_password'));
      aligned := aligned + 1;
    else
      missing := missing || role_name;
    end if;
  end loop;

  raise notice 'service roles aligned: %', aligned;
  if array_length(missing, 1) is not null then
    raise notice 'service roles absent from this image (not created here): %',
      array_to_string(missing, ', ');
  end if;
end $$;

-- Do not leave it readable for the rest of the session.
\o /dev/null
select set_config('jsk.bootstrap_password', '', false);
\o
