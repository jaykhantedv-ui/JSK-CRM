#!/usr/bin/env bash
# Local database lifecycle for JSK CRM (ADR-018).
#
# `supabase start` is unavailable wherever the Supabase container images cannot be
# pulled, so the local runtime is a plain PostgreSQL 16 server plus the platform
# bootstrap in supabase/platform/. Migrations are still applied by the Supabase
# CLI, so migration ordering and the supabase_migrations ledger are exercised for
# real rather than simulated.
#
#   scripts/db.sh start    start the PostgreSQL server
#   scripts/db.sh stop     stop it
#   scripts/db.sh reset    drop the database, recreate it, bootstrap, migrate, seed
#   scripts/db.sh migrate  apply pending migrations only
#   scripts/db.sh psql     open a shell on the database
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/var/lib/pgdata}
PGPORT=${PGPORT:-54322}
PGHOST=${PGHOST:-127.0.0.1}
PGUSER=${PGUSER:-postgres}
DB=${DB:-postgres}

# PG_EXTERNAL=1 means "a server is already listening and this script does not own
# its lifecycle" — CI, where PostgreSQL is a service container. Everything after
# `start` is identical, so CI exercises the same bootstrap, the same migration
# ordering and the same seed as a developer's machine rather than a parallel path
# that can drift away from it.
PG_EXTERNAL=${PG_EXTERNAL:-0}

CRED="$PGUSER"
[ -n "${PGPASSWORD:-}" ] && CRED="${PGUSER}:${PGPASSWORD}"
ADMIN_URL="postgresql://${CRED}@${PGHOST}:${PGPORT}/template1"
DB_URL="postgresql://${CRED}@${PGHOST}:${PGPORT}/${DB}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

start() {
  if [ "$PG_EXTERNAL" = "1" ]; then
    echo "using the external postgres at ${PGHOST}:${PGPORT} (PG_EXTERNAL=1)"
    for _ in $(seq 1 30); do
      pg_isready -h "$PGHOST" -p "$PGPORT" -q && return
      sleep 1
    done
    echo "no postgres answering on ${PGHOST}:${PGPORT}" >&2
    exit 1
  fi
  if "$PGBIN/pg_isready" -h "$PGHOST" -p "$PGPORT" -q; then
    echo "postgres already running on ${PGHOST}:${PGPORT}"
    return
  fi
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$PGDATA"
    chown postgres:postgres "$PGDATA"
    su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth-local=trust --auth-host=trust -E UTF8 --locale=C" >/dev/null
  fi
  mkdir -p /var/log/pg && chown postgres:postgres /var/log/pg
  # timezone=UTC mirrors Supabase: every date expression in the schema must be
  # explicit about Asia/Kolkata rather than inheriting it (CLAUDE.md §10).
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l /var/log/pg/pg.log -o '-p $PGPORT -c listen_addresses=$PGHOST -c timezone=UTC' -w start"
}

stop() {
  [ "$PG_EXTERNAL" = "1" ] && { echo "external postgres — not stopping it"; return; }
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -w stop" || true
}

reset() {
  start
  echo "--- dropping and recreating ${DB}"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
    -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '${DB}' and pid <> pg_backend_pid();" \
    -c "drop database if exists ${DB};" \
    -c "create database ${DB};"
  echo "--- platform bootstrap (not a migration — see ADR-018)"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/platform/000_supabase_platform.sql"
  migrate
  if [ "${SEED:-1}" = "1" ]; then
    echo "--- seed (all environments)"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed/seed.sql"
  fi
  if [ "${FIXTURES:-0}" = "1" ]; then
    echo "--- dev fixtures (development only — never staging or production)"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed/dev-fixtures.sql"
  fi
  echo "--- ready: $DB_URL"
}

migrate() {
  echo "--- migrations"
  (cd "$ROOT" && npx --no-install supabase migration up --db-url "$DB_URL")
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  reset) reset ;;
  migrate) migrate ;;
  psql) shift; psql "$DB_URL" "$@" ;;
  url) echo "$DB_URL" ;;
  *) echo "usage: scripts/db.sh {start|stop|reset|migrate|psql|url}" >&2; exit 2 ;;
esac
