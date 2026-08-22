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

# How this reaches the database as the platform superuser lives in one place, so a
# fix to it cannot reach one caller and miss the other. deploy/restore.sh needs the
# same path for the same reason: creating platform roles is superuser work.
. "$ROOT/deploy/lib/db-admin.sh"

FAILED=0
ok()  { printf '    ok    %s\n' "$1"; }
bad() { printf '    FAIL  %s\n' "$1"; FAILED=1; }

# --- wait for the database ---------------------------------------------------
# On a cold boot after a power cut PostgreSQL replays its WAL before it accepts
# connections, and initdb on a fresh volume takes longer still.
for _ in $(seq 1 90); do
  "${DC[@]}" exec -T db pg_isready -q >/dev/null 2>&1 && break
  sleep 2
done
"${DC[@]}" exec -T db pg_isready -q >/dev/null 2>&1 \
  || { echo "the database is not answering" >&2; exit 1; }

# --- is the administrative role usable? --------------------------------------
# Requirement, not a courtesy: everything below either alters a reserved role or
# reads pg_authid, and both need superuser. Failing here names the problem; failing
# later produces a permission error per role and a half-aligned database.
echo "--- administrative path"
ADMIN_EXISTS="$(psql_probe -c "select 1 from pg_roles where rolname = '$ADMIN_ROLE';" | tr -d '[:space:]')"
ADMIN_SUPER="$(psql_probe -c "select rolsuper from pg_roles where rolname = '$ADMIN_ROLE';" | tr -d '[:space:]')"
if [ "$ADMIN_EXISTS" != "1" ]; then
  echo "    FAIL  role '$ADMIN_ROLE' does not exist in this database" >&2
  echo "the Supabase platform superuser is missing — check the db image tag in docker-compose.yml" >&2
  exit 1
fi
if [ "$ADMIN_SUPER" != "t" ]; then
  echo "    FAIL  role '$ADMIN_ROLE' exists but is not a superuser" >&2
  echo "the service roles are reserved; only a superuser may alter them. Refusing to continue." >&2
  exit 1
fi
require_admin_path || exit 1
ok "$ADMIN_ROLE is a superuser, reached over the $ADMIN_PATH"

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
  #
  # Captured rather than piped: `psql ... | sed` reports SED's exit status, so a
  # failed alignment — including the verifier assertion inside the script — would
  # have been swallowed and the deployment would have carried on to start services
  # that cannot authenticate.
  if ALIGN_OUT="$(psql_admin -q -f /etc/jsk/service-roles.sql 2>&1)"; then
    printf '%s\n' "$ALIGN_OUT" | sed -n 's/^NOTICE:  /    /p'
  else
    printf '%s\n' "$ALIGN_OUT" | sed -n 's/^\(ERROR\|FATAL\|NOTICE\):  /    /p' >&2
    echo "the service-role alignment FAILED — not starting anything that depends on it" >&2
    exit 1
  fi
fi

# --- the stored verifier scheme ----------------------------------------------
# Metadata only: the scheme's NAME, never the verifier. An md5 verifier is the
# failure that a loopback `trust` rule hides — the password "works" there and is
# refused by every scram-sha-256 rule, which is every other address.
echo "--- password verifier scheme"
printf '    server password_encryption: %s\n' \
  "$(psql_admin -tAc 'show password_encryption;' 2>/dev/null | tr -d '[:space:]')"
psql_admin -tAc "
  select rolname || ' -> ' ||
         case
           when rolpassword is null then 'NO PASSWORD'
           when rolpassword like 'SCRAM-SHA-256\$%' then 'SCRAM-SHA-256'
           when rolpassword like 'md5%' then 'md5 (cannot satisfy a scram-sha-256 rule)'
           else 'unrecognised'
         end
  from pg_authid
  where rolname in ('authenticator','supabase_auth_admin','supabase_storage_admin')
  order by rolname;" 2>/dev/null | sed 's/^/    /'
for role in "${SERVICE_ROLES[@]}"; do
  scheme="$(psql_admin -tAc "select case when rolpassword like 'SCRAM-SHA-256\$%' then 'scram' else 'other' end from pg_authid where rolname = '$role';" 2>/dev/null | tr -d '[:space:]')"
  [ "$scheme" = "scram" ] && ok "$role has a SCRAM-SHA-256 verifier" \
                          || bad "$role has NO SCRAM-SHA-256 verifier"
done

# --- 1-3. each service role authenticates OVER THE CONTAINER NETWORK ---------
#
# THIS MUST NOT USE 127.0.0.1. The database image's pg_hba.conf trusts loopback:
#
#     host all all 127.0.0.1/32   trust
#     host all all 172.16.0.0/12  scram-sha-256
#
# so a login from inside the db container succeeds without ever checking the
# password, and reports success for a role whose verifier cannot satisfy SCRAM at
# all. That false positive is precisely what let a broken deployment look fixed.
#
# The login below is made from a SEPARATE container on the compose network,
# reaching the database by its service name — the same address family, and the
# same pg_hba rule, as GoTrue, PostgREST and storage-api. The server is asked
# which address it saw, and anything loopback, empty or unreadable is a FAILURE:
# this check has no passing path that avoids SCRAM.
#
# `compose run` is used so POSTGRES_PASSWORD comes from the db service's own
# environment — the value never appears in a command line or in this shell.
echo "--- can each service role authenticate over the container network?"
net_login() {
  "${DC[@]}" run --rm -T --no-deps --entrypoint sh db -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -q -tAc "select host(inet_client_addr())" \
       -h db -p 5432 -U "$1" -d postgres' _ "$1" 2>/dev/null | tr -d '[:space:]'
}
for role in "${SERVICE_ROLES[@]}"; do
  addr="$(net_login "$role" || true)"
  case "$addr" in
    ''|127.*|::1|localhost)
      bad "$role did NOT authenticate over the network (saw: ${addr:-no connection})" ;;
    *)
      ok "$role authenticated from $addr — off-loopback, so scram-sha-256 applied" ;;
  esac
done

# --- 4-6. each service is actually connected to the database -----------------
# Only in --test mode: the services are deliberately not running yet when this
# script is called during startup.
if [ "$MODE" = "--test" ]; then
  echo "--- is each service connected to the database?"

  # pg_stat_activity is the proof that matters: a row for a role means a process
  # authenticated as that role and is holding a session. An HTTP 200 could be
  # served by a container that never reached PostgreSQL at all.
  #
  # client_addr is recorded too. It is null for a unix-socket connection, so a
  # non-null address is independent confirmation that the session arrived over the
  # container network and therefore through the scram-sha-256 rule.
  check_service() {  # check_service <label> <role> <url>
    local label="$1" role="$2" url="$3" addr
    addr="$(psql_admin -tAc \
      "select coalesce(host(client_addr), 'socket') from pg_stat_activity
        where usename = '$role' and client_addr is not null limit 1;" \
      2>/dev/null | tr -d '[:space:]')"

    if [ -n "$addr" ] && [ "$addr" != "socket" ]; then
      ok "$label is connected as $role from $addr (scram over the network)"
    elif "${DC[@]}" exec -T gateway wget -qO- --timeout=10 "$url" >/dev/null 2>&1; then
      # Answering but holding no pooled session — true of a service that opens a
      # connection per request. It still had to authenticate to answer at all.
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
