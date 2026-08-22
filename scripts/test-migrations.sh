#!/usr/bin/env bash
# Production migration regression test.
#
#   scripts/test-migrations.sh
#
# WHAT IT CATCHES. deploy/migrate.sh applied the CRM's migrations as `postgres`.
# In the Supabase image `postgres` is an ordinary role and `supabase_admin` is the
# bootstrap superuser, so on the office server the migrations never ran: a healthy
# database, healthy Auth and Storage, an empty supabase_migrations ledger and not
# one CRM table. Nothing reported an error, because nothing was checked.
#
# The cluster here is initdb'd with supabase_admin as the BOOTSTRAP superuser and
# `postgres` created afterwards as an ordinary role — PostgreSQL refuses to remove
# SUPERUSER from a cluster's own bootstrap user, so this is the only faithful way
# to model it. supabase/platform/000_supabase_platform.sql stands in for the
# objects GoTrue and Storage create on the server (auth.users, storage.buckets),
# which the migrations reference.
#
# Only the TRANSPORT is substituted: the real deploy/migrate.sh runs, with
# `docker compose exec` mapped to this local cluster.
#
# Nothing outside its own temporary cluster is touched, and the temporary env file
# it needs is removed on exit including on failure.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${DATA:-/var/lib/jsk-migrate-test}
PORT=${PORT:-54393}
PROD_ENV="$ROOT/deploy/env/production.env"
WORK="$(mktemp -d)"

PASS=0; FAIL=0
ok()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  \033[31mFAIL\033[0m  %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }

cleanup() {
  su postgres -c "$PGBIN/pg_ctl -D $DATA -w -s -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$WORK"
  [ -f "$PROD_ENV.migbak" ] && mv -f "$PROD_ENV.migbak" "$PROD_ENV" || rm -f "$PROD_ENV"
}
trap cleanup EXIT

echo "Production migration regression test"
echo

# --- a cluster shaped like the image -----------------------------------------
su postgres -c "$PGBIN/pg_ctl -D $DATA -w -s -m immediate stop" >/dev/null 2>&1 || true
rm -rf "$DATA"; mkdir -p "$DATA"; chown postgres:postgres "$DATA"; chmod 700 "$DATA"
su postgres -c "$PGBIN/initdb -D $DATA -U supabase_admin --auth-local=trust --auth-host=trust -E UTF8 --locale=C" >/dev/null 2>&1 \
  || { echo "initdb failed" >&2; exit 1; }
printf 'local all all trust\nhost all all 127.0.0.1/32 trust\n' > "$DATA/pg_hba.conf"
chown postgres:postgres "$DATA/pg_hba.conf"; chmod 600 "$DATA/pg_hba.conf"
su postgres -c "$PGBIN/pg_ctl -D $DATA -l $DATA/pg.log \
   -o '-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA' -w start" >/dev/null 2>&1 \
  || { echo "could not start the test cluster on $PORT" >&2; tail -5 "$DATA/pg.log" >&2; exit 1; }

SA="postgresql://supabase_admin@127.0.0.1:$PORT/postgres"
sa() { psql -X -q -v ON_ERROR_STOP=1 "$SA" "$@"; }
sq() { psql -X -tAq "$SA" -c "$1" 2>/dev/null | tr -d '[:space:]'; }

sa -c "create role postgres login nosuperuser createdb;" >/dev/null
[ "$(sq "select rolsuper from pg_roles where rolname='postgres';")" = "f" ] \
  && ok "postgres is an ordinary role, as in the image" || bad "postgres is a superuser here"
[ "$(sq "select rolsuper from pg_roles where rolname='supabase_admin';")" = "t" ] \
  && ok "supabase_admin is the superuser" || bad "supabase_admin is not a superuser"

# What GoTrue and Storage provide on the real server.
sa -q -f "$ROOT/supabase/platform/000_supabase_platform.sql" >/dev/null 2>&1 \
  && ok "platform objects present (auth.users, storage.buckets, API roles)" \
  || bad "could not create the platform objects the migrations reference"

# --- the transport stand-in and a temporary env file --------------------------
. "$ROOT/scripts/lib/compose-shim.sh"
write_compose_shim "$WORK/bin" "$PORT"
[ -f "$PROD_ENV" ] && mv -f "$PROD_ENV" "$PROD_ENV.migbak"
mkdir -p "$(dirname "$PROD_ENV")"
printf 'POSTGRES_PASSWORD=migration-test-not-a-real-password\n' > "$PROD_ENV"
chmod 600 "$PROD_ENV"

ON_DISK="$(ls -1 "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ')"
echo "  $ON_DISK migrations on disk"
echo

# --- 1. as postgres: refused, and nothing recorded ----------------------------
echo "Attempted through postgres (what the office server did)"
DB_ADMIN_ROLE=postgres PATH="$WORK/bin:$PATH" "$ROOT/deploy/migrate.sh" >"$WORK/asrole.log" 2>&1
[ "$?" != "0" ] && ok "deploy/migrate.sh refuses to run" || bad "it ran as a non-superuser"
grep -qi "superuser" "$WORK/asrole.log" \
  && ok "and says why, naming the role" || bad "the refusal did not mention superuser" "$(tail -1 "$WORK/asrole.log")"
LEDGER_AFTER_FAIL="$(sq "select count(*) from supabase_migrations.schema_migrations;")"
[ "${LEDGER_AFTER_FAIL:-0}" = "0" ] \
  && ok "the ledger is untouched — nothing was marked applied" \
  || bad "the failed attempt wrote $LEDGER_AFTER_FAIL ledger row(s)"
[ "$(sq "select count(*) from pg_tables where schemaname='public';")" = "0" ] \
  && ok "no CRM table was created" || bad "tables were created by the failed attempt"
echo

# --- 2. through the shared administrative path --------------------------------
echo "Through the shared supabase_admin path"
PATH="$WORK/bin:$PATH" "$ROOT/deploy/migrate.sh" >"$WORK/apply.log" 2>&1
APPLY_STATUS=$?
[ "$APPLY_STATUS" = "0" ] && ok "all migrations applied" \
  || bad "deploy/migrate.sh failed" "$(grep -iE 'error|fatal' "$WORK/apply.log" | head -1)"

LEDGER="$(sq "select count(*) from supabase_migrations.schema_migrations;")"
[ "$LEDGER" = "$ON_DISK" ] && ok "the ledger holds all $ON_DISK versions" \
  || bad "ledger has ${LEDGER:-0}, expected $ON_DISK"
MISSING="$(psql -X -tAq "$SA" -c "
  select coalesce(string_agg(v, ', ' order by v), '')
  from (select to_char(g, 'FM000') v from generate_series(1, $ON_DISK) g) s
  where not exists (select 1 from supabase_migrations.schema_migrations m where m.version = s.v);" 2>/dev/null | tr -d ' ')"
[ -z "$MISSING" ] && ok "versions 001-$(printf '%03d' "$ON_DISK") are all present, none skipped" \
  || bad "missing ledger versions" "$MISSING"

for t in users outlets user_outlets accounts contacts projects project_stakeholders \
         opportunities activities opportunity_events system_settings sales_targets \
         import_batches import_rows; do
  [ "$(sq "select 1 from pg_tables where schemaname='public' and tablename='$t';")" = "1" ] || MISSTAB="${MISSTAB:-} $t"
done
[ -z "${MISSTAB:-}" ] && ok "all 14 CRM tables exist" || bad "missing tables" "${MISSTAB}"

[ "$(sq "select count(*) from pg_namespace where nspname in ('public','auth','storage','extensions');")" = "4" ] \
  && ok "public, auth, storage and extensions all still present" || bad "a platform schema is missing"
POLICIES="$(sq "select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';")"
[ "${POLICIES:-0}" -gt 0 ] && ok "RLS policies created ($POLICIES)" || bad "no RLS policies"
[ "$(sq "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;")" = "0" ] \
  && ok "RLS is enabled on every CRM table" || bad "a CRM table has RLS off"
[ "$(sq "select count(*) from pg_extension where extname in ('pg_trgm','pgcrypto');")" = "2" ] \
  && ok "pg_trgm and pgcrypto installed by the migrations" || bad "an extension is missing"
[ -n "$(sq "select count(*) from public.search_crm('probe');")" ] \
  && ok "search_crm() executes" || bad "search_crm() failed"
echo

# --- 3. idempotent, and --status still works ----------------------------------
echo "Re-running, and --status"
PATH="$WORK/bin:$PATH" "$ROOT/deploy/migrate.sh" >"$WORK/again.log" 2>&1
grep -q "already up to date" "$WORK/again.log" \
  && ok "a second run applies nothing" || bad "a second run did not report up to date"
[ "$(sq "select count(*) from supabase_migrations.schema_migrations;")" = "$ON_DISK" ] \
  && ok "the ledger is unchanged by the second run" || bad "the ledger changed on re-run"
PATH="$WORK/bin:$PATH" "$ROOT/deploy/migrate.sh" --status >"$WORK/status.log" 2>&1
if grep -q "^applied:" "$WORK/status.log" && grep -q "^on disk:" "$WORK/status.log" \
   && [ "$(grep -c '^  0' "$WORK/status.log")" -ge "$ON_DISK" ]; then
  ok "--status lists both applied and on-disk migrations"
else
  bad "--status output is wrong" "$(head -2 "$WORK/status.log")"
fi

echo
echo "──────────────────────────────────────────"
echo "passed $PASS, failed $FAIL"
[ "$FAIL" = 0 ] || exit 1
