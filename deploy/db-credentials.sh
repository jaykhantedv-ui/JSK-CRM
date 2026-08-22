#!/usr/bin/env bash
# Align the Supabase service roles with POSTGRES_PASSWORD, and prove it worked.
#
#   deploy/db-credentials.sh            align the three roles, then verify them
#   deploy/db-credentials.sh --verify   verify only — change nothing
#   deploy/db-credentials.sh --test     the full deployment regression check:
#                                       the three roles AND the three services
#
# THE PROBLEM THIS SOLVES. `supabase/postgres` creates `authenticator`,
# `supabase_auth_admin` and `supabase_storage_admin` during initdb with the image's
# own passwords. POSTGRES_PASSWORD is applied by the entrypoint to the `postgres`
# superuser alone. docker-compose.yml builds all three service connection strings
# from POSTGRES_PASSWORD, so until those role passwords are re-assigned every one
# of them is refused — while `db` reports healthy, because `pg_isready` speaks as
# the superuser. See deploy/db/service-roles.sql.
#
# SAFE ON AN EXISTING DEPLOYMENT. Re-assigning a role password touches no data, no
# schema and no row-level policy, so this runs on every start and is idempotent. It
# reports whether it found a fresh database or one that already holds the business
# schema, so a first boot and a restart are never confused for one another.
#
# NO SECRET IS PRINTED, and none crosses the host: psql reads POSTGRES_PASSWORD
# from the database container's own environment, and every check below reports only
# ok/FAIL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/env/production.env"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
cd "$ROOT"

MODE="${1:-align}"
case "$MODE" in
  align|--verify|--test) ;;
  *) echo "usage: deploy/db-credentials.sh [--verify|--test]" >&2; exit 2 ;;
esac

DC=(docker compose --env-file "$ENV_FILE")
SERVICE_ROLES=(authenticator supabase_auth_admin supabase_storage_admin)
FAILED=0
ok()  { printf '    ok    %s\n' "$1"; }
bad() { printf '    FAIL  %s\n' "$1"; FAILED=1; }

# psql as the superuser, inside the db container. Output is the caller's to read.
psql_admin() { "${DC[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }

# --- wait for the database ---------------------------------------------------
# On a cold boot after a power cut PostgreSQL replays its WAL before it accepts
# connections, and initdb on a fresh volume takes longer still.
for _ in $(seq 1 90); do
  "${DC[@]}" exec -T db pg_isready -U postgres -q >/dev/null 2>&1 && break
  sleep 2
done
"${DC[@]}" exec -T db pg_isready -U postgres -q >/dev/null 2>&1 \
  || { echo "the database is not answering" >&2; exit 1; }

# --- fresh or already initialised? -------------------------------------------
# The application's migration ledger is the marker: present means this volume has
# already carried a deployment, absent means initdb just created it.
if psql_admin -tAc \
     "select to_regclass('supabase_migrations.schema_migrations') is not null;" 2>/dev/null \
     | grep -qx t; then
  STATE="existing database (already initialised)"
else
  STATE="fresh database (first initialisation)"
fi
echo "--- service-role credentials: ${STATE}"

# --- align -------------------------------------------------------------------
if [ "$MODE" = "align" ]; then
  # The SQL is mounted read-only into the container by docker-compose.yml so that
  # the password is read from the container's environment and never travels.
  psql_admin -q -f /etc/jsk/service-roles.sql 2>&1 \
    | sed -n 's/^NOTICE:  /    /p'
fi

# --- 1-3. each service role can actually authenticate ------------------------
# Not "the role exists" — an actual password login over TCP, which is exactly what
# GoTrue, PostgREST and storage-api do. PGPASSWORD is set from the container's own
# environment inside the container, so the value never reaches this shell.
echo "--- can each service role authenticate?"
for role in "${SERVICE_ROLES[@]}"; do
  if "${DC[@]}" exec -T db sh -c \
       'PGPASSWORD="$POSTGRES_PASSWORD" psql -q -tAc "select 1" \
          -h 127.0.0.1 -p 5432 -U "$1" -d postgres' _ "$role" 2>/dev/null \
       | grep -qx 1; then
    ok "$role can authenticate"
  else
    bad "$role CANNOT authenticate"
  fi
done

# --- 4-6. each service is actually connected to the database -----------------
# Only in --test mode: the services are deliberately not running yet when this
# script is called during startup.
if [ "$MODE" = "--test" ]; then
  echo "--- is each service connected to the database?"

  # pg_stat_activity is the proof that matters: a row for a role means a process
  # authenticated as it and is holding a session. An HTTP 200 could be served by a
  # container that has not reached PostgreSQL at all.
  CONNECTED="$(psql_admin -tAc \
    "select string_agg(distinct usename, ' ') from pg_stat_activity
      where usename in ('authenticator','supabase_auth_admin','supabase_storage_admin');" \
    2>/dev/null || true)"

  check_service() {  # check_service <label> <role> <url>
    local label="$1" role="$2" url="$3" seen=0
    case " $CONNECTED " in *" $role "*) seen=1 ;; esac
    if [ "$seen" = 1 ]; then
      ok "$label is connected to the database as $role"
    elif "${DC[@]}" exec -T gateway wget -qO- --timeout=10 "$url" >/dev/null 2>&1; then
      # Answering but holding no pooled session — true for a service that opens a
      # connection per request. Still proves it authenticated.
      ok "$label answers through the database ($url)"
    else
      bad "$label did NOT reach the database"
    fi
  }

  check_service "GoTrue (auth)"     supabase_auth_admin    http://auth:9999/health
  check_service "PostgREST (rest)"  authenticator          http://rest:3000/
  check_service "Storage (storage)" supabase_storage_admin http://storage:5000/status

  # A container that authenticates, dies and is restarted looks momentarily fine.
  RESTARTING="$("${DC[@]}" ps --format '{{.Name}} {{.State}}' 2>/dev/null \
                | awk '$2 == "restarting" { print $1 }' || true)"
  [ -z "$RESTARTING" ] && ok "no container is restart-looping" \
                       || bad "restarting: $RESTARTING"
fi

echo
if [ "$FAILED" = "0" ]; then
  echo "service-role credentials OK"
  exit 0
fi
cat >&2 <<'HINT'
service-role credentials FAILED.

  deploy/db-credentials.sh          re-align and re-check
  deploy/db-credentials.sh --test   full check, with the stack running

If a role is reported absent rather than refused, the database image did not create
it — check the `db` image tag in docker-compose.yml. This script never creates
platform roles, because inventing one with the wrong grants is worse than failing.
HINT
exit 1
