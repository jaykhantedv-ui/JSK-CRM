#!/usr/bin/env bash
# Deployment regression test: the Supabase service roles must be able to
# authenticate with POSTGRES_PASSWORD.
#
#   scripts/test-service-credentials.sh
#
# WHAT IT REPRODUCES. On the office server the stack built cleanly and `db`
# reported healthy, while GoTrue, PostgREST and storage-api all failed with
#
#     FATAL: password authentication failed for user "supabase_auth_admin"
#     FATAL: password authentication failed for user "authenticator"
#     FATAL: password authentication failed for user "supabase_storage_admin"
#
# because `supabase/postgres` gives those roles its own passwords at initdb while
# POSTGRES_PASSWORD reaches only the `postgres` superuser — and nothing re-assigned
# them. This test recreates that exact starting state on a real PostgreSQL server,
# proves the three roles are refused, applies deploy/db/service-roles.sql, and
# proves they are then accepted.
#
# It runs without Docker, so the fix is provable wherever the Supabase images
# cannot be pulled. It temporarily switches host authentication to scram-sha-256 —
# matching POSTGRES_HOST_AUTH_METHOD in docker-compose.yml — because the local
# development cluster trusts loopback connections, and under `trust` a password
# test proves nothing. Both the original pg_hba.conf and every role it touched are
# restored on exit, including on failure.
#
# NO PASSWORD IS PRINTED. The two used here are generated per run and never shown.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA=${PGDATA:-/var/lib/pgdata}
PGPORT=${PGPORT:-54322}
PGHOST=${PGHOST:-127.0.0.1}
HBA="$PGDATA/pg_hba.conf"
ROLES=(authenticator supabase_auth_admin supabase_storage_admin)

PASS=0; FAIL=0
ok()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  \033[31mFAIL\033[0m  %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }

# The configured POSTGRES_PASSWORD, and the value standing in for the one the
# image bakes in. Generated per run so nothing is hard-coded and nothing is reused.
CONFIGURED="$(openssl rand -hex 24)"
IMAGE_DEFAULT="$(openssl rand -hex 24)"

# Administration goes over TCP as the superuser. PGPASSWORD is supplied so the
# same call works both before the switch to scram (where trust ignores it) and
# after (where it is required) — the superuser's password is set to the same
# configured value below, exactly as POSTGRES_PASSWORD is on the server.
admin() {
  PGPASSWORD="$CONFIGURED" psql -X -q -v ON_ERROR_STOP=1 \
    -h "$PGHOST" -p "$PGPORT" -U postgres -d postgres "$@"
}

# pg_hba.conf must stay readable BY THE SERVER. Truncating the existing file keeps
# its inode, owner and mode; ownership is re-asserted anyway in case it was already
# wrong. A file postgres cannot open is not an error it reports — the reload simply
# keeps the previous rules, which is how a test like this silently runs under
# `trust` and proves nothing.
HBA_OWNER="$(stat -c '%U:%G' "$HBA" 2>/dev/null || echo postgres:postgres)"
HBA_MODE="$(stat -c '%a'    "$HBA" 2>/dev/null || echo 600)"
write_hba() {
  cat > "$HBA"
  chown "$HBA_OWNER" "$HBA" 2>/dev/null || true
  chmod "$HBA_MODE"  "$HBA" 2>/dev/null || true
}

pre_existing=""
restore() {
  # pg_hba first, and only then the passwords: resetting the superuser's password
  # while scram is still in force would lock this function out of the server.
  if [ -f "$HBA.jsktest" ]; then
    # Written back through the EXISTING file, never moved over it: a replacement
    # would be owned by whoever ran this script, and a pg_hba.conf the server
    # cannot read is ignored in silence — it keeps the rules already loaded.
    write_hba < "$HBA.jsktest"
    rm -f "$HBA.jsktest"
    admin -c "select pg_reload_conf();" >/dev/null 2>&1 || true
    sleep 1
  fi
  for r in "${ROLES[@]}"; do
    if [[ " $pre_existing " == *" $r "* ]]; then
      admin -c "alter role \"$r\" with password null;" >/dev/null 2>&1 || true
    else
      admin -c "drop role if exists \"$r\";" >/dev/null 2>&1 || true
    fi
  done
  admin -c "alter role postgres with password null;" >/dev/null 2>&1 || true
}
trap restore EXIT

pg_isready -h "$PGHOST" -p "$PGPORT" -q || { echo "no PostgreSQL on $PGHOST:$PGPORT — run scripts/db.sh start" >&2; exit 1; }
echo "Service-role credential regression test"
echo

# --- arrange: the state a fresh `supabase/postgres` volume is in --------------
admin -c "alter role postgres with password '$CONFIGURED';" >/dev/null
for r in "${ROLES[@]}"; do
  if admin -tAc "select 1 from pg_roles where rolname = '$r';" | grep -qx 1; then
    pre_existing="$pre_existing $r"
  else
    admin -c "create role \"$r\" login noinherit;" >/dev/null
  fi
done
for r in "${ROLES[@]}"; do
  # The image's own password — deliberately NOT the configured one.
  admin -c "alter role \"$r\" with password '$IMAGE_DEFAULT';" >/dev/null
done

# Require a real password over TCP, as the deployment does.
cp -f "$HBA" "$HBA.jsktest"
write_hba <<'HBA_RULES'
local   all all                  trust
host    all all 127.0.0.1/32     scram-sha-256
host    all all ::1/128          scram-sha-256
HBA_RULES
admin -c "select pg_reload_conf();" >/dev/null
sleep 1

# Prove scram is actually in force before asserting anything about passwords. If
# the server were still trusting loopback, every check below would pass for the
# wrong reason and the test would certify a bug as fixed.
if PGPASSWORD="not-the-password" psql -X -q -tAc 'select 1' \
     -h "$PGHOST" -p "$PGPORT" -U postgres -d postgres >/dev/null 2>&1; then
  echo "cannot run: the server still accepts any password on 127.0.0.1." >&2
  echo "pg_hba.conf was rewritten but not adopted — check that ${HBA} is readable by the server." >&2
  exit 1
fi

# Does a login as $1 with the CONFIGURED password succeed?
login() {
  PGPASSWORD="$CONFIGURED" psql -X -q -tAc 'select 1' \
    -h "$PGHOST" -p "$PGPORT" -U "$1" -d postgres 2>"$ROOT/.cred-test.err" | grep -qx 1
}

# --- 1. the bug reproduces ----------------------------------------------------
echo "The reported failure, reproduced"
for r in "${ROLES[@]}"; do
  if login "$r"; then
    bad "$r should be refused before the fix" "it authenticated — the test proves nothing"
  elif grep -q "password authentication failed" "$ROOT/.cred-test.err"; then
    ok "$r is refused: password authentication failed (the VPS symptom)"
  else
    bad "$r failed for the wrong reason" "$(head -1 "$ROOT/.cred-test.err")"
  fi
done
echo

# --- 2. the fix ---------------------------------------------------------------
echo "After deploy/db/service-roles.sql"
if POSTGRES_PASSWORD="$CONFIGURED" admin -f "$ROOT/deploy/db/service-roles.sql" >/dev/null 2>&1; then
  ok "the alignment script applied cleanly"
else
  bad "the alignment script failed to apply"
fi
for r in "${ROLES[@]}"; do
  login "$r" && ok "$r can authenticate" || bad "$r still cannot authenticate" "$(head -1 "$ROOT/.cred-test.err")"
done
echo

# --- 3. idempotent: safe to run on every start --------------------------------
echo "Re-running it (an existing deployment restarting)"
POSTGRES_PASSWORD="$CONFIGURED" admin -f "$ROOT/deploy/db/service-roles.sql" >/dev/null 2>&1
allgood=1
for r in "${ROLES[@]}"; do login "$r" || allgood=0; done
[ "$allgood" = 1 ] && ok "all three still authenticate — idempotent, nothing corrupted" \
                   || bad "a role stopped authenticating after a second run"
echo

# --- 4. it refuses to set a blank password ------------------------------------
echo "Guard: an empty POSTGRES_PASSWORD"
if POSTGRES_PASSWORD="" admin -f "$ROOT/deploy/db/service-roles.sql" >/dev/null 2>&1; then
  bad "an empty POSTGRES_PASSWORD was accepted" "it would have blanked the service-role passwords"
else
  ok "an empty POSTGRES_PASSWORD is refused"
fi
allgood=1
for r in "${ROLES[@]}"; do login "$r" || allgood=0; done
[ "$allgood" = 1 ] && ok "the refused run left the working passwords intact" \
                   || bad "the refused run damaged the passwords"

rm -f "$ROOT/.cred-test.err"
echo
echo "──────────────────────────────────────────"
echo "passed $PASS, failed $FAIL"
[ "$FAIL" = 0 ] || exit 1
