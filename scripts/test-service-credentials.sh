#!/usr/bin/env bash
# Deployment regression test: the Supabase service roles must authenticate under
# scram-sha-256 FROM ANOTHER HOST ON THE NETWORK — not merely over loopback.
#
#   scripts/test-service-credentials.sh
#
# WHAT IT REPRODUCES. On the office server PostgreSQL was healthy, the three roles
# existed, and a psql login inside the db container succeeded — while GoTrue,
# PostgREST and storage-api all restart-looped on `password authentication failed`.
# The database's pg_hba.conf is why:
#
#     host all all 127.0.0.1/32   trust           <- the loopback test, proves nothing
#     host all all 172.16.0.0/12  scram-sha-256   <- what the services actually use
#
# Under `trust` the password is never checked, so a role whose stored verifier
# cannot satisfy SCRAM at all still "passes". `alter role ... password` stores the
# verifier in whatever scheme `password_encryption` names at that moment, and an
# image configured for md5 produces an md5 verifier that no scram-sha-256 rule can
# ever accept.
#
# This test recreates both halves on a real PostgreSQL server: a loopback `trust`
# rule and an off-loopback `scram-sha-256` rule. It proves the md5 verifier passes
# over loopback and FAILS over the network — the exact false positive — then
# applies deploy/db/service-roles.sql and proves the network login succeeds.
#
# It needs no container images, so the fix is provable wherever the Supabase images
# cannot be pulled. postgresql.conf, pg_hba.conf and every role it touches are
# restored on exit, including on failure.
#
# NO PASSWORD OR VERIFIER IS PRINTED. Only the scheme's name is ever reported.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/var/lib/pgdata}
PGPORT=${PGPORT:-54322}
HBA="$PGDATA/pg_hba.conf"
ROLES=(authenticator supabase_auth_admin supabase_storage_admin)

# The off-loopback address standing in for the Docker bridge subnet.
NETHOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$NETHOST" ] || { echo "no non-loopback address on this host — cannot test the network path" >&2; exit 1; }
NETCIDR="$(echo "$NETHOST" | awk -F. '{print $1"."$2"."$3".0/24"}')"

PASS=0; FAIL=0
ok()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  \033[31mFAIL\033[0m  %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }

CONFIGURED="$(openssl rand -hex 24)"

# Loopback stays `trust` for the whole run — exactly as on the server — so
# administration is always possible no matter what state scram is in.
admin() { psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres -d postgres "$@"; }

# Write through the EXISTING file so its inode, owner and mode survive. A
# pg_hba.conf the server cannot read is not an error it reports — the reload
# silently keeps the rules already loaded, and every check below would then pass
# for the wrong reason.
own_write() { # own_write <path>
  local f="$1" o m; o="$(stat -c '%U:%G' "$f" 2>/dev/null || echo postgres:postgres)"
  m="$(stat -c '%a' "$f" 2>/dev/null || echo 600)"
  cat > "$f"; chown "$o" "$f" 2>/dev/null || true; chmod "$m" "$f" 2>/dev/null || true
}
# listen_addresses is passed on the postgres COMMAND LINE by scripts/db.sh, and a
# command-line setting overrides postgresql.conf — so widening it means restarting
# with a different option, not editing a file. `pg_ctl restart` alone would simply
# replay the recorded options.
pg_listen_on() { # pg_listen_on <address>
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -w -s stop" >/dev/null 2>&1 || true
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l /var/log/pg/pg.log \
     -o '-p $PGPORT -c listen_addresses=$1 -c timezone=UTC' -w start" >/dev/null 2>&1
  sleep 1
}

pre_existing=""
restore() {
  [ -f "$HBA.bak" ] && { own_write "$HBA" < "$HBA.bak"; rm -f "$HBA.bak"; }
  pg_listen_on 127.0.0.1
  for r in "${ROLES[@]}"; do
    if [[ " $pre_existing " == *" $r "* ]]; then
      admin -c "alter role \"$r\" with password null;" >/dev/null 2>&1 || true
    else
      admin -c "drop role if exists \"$r\";" >/dev/null 2>&1 || true
    fi
  done
  rm -f "$ROOT/.cred-test.err"
}
trap restore EXIT

pg_isready -h 127.0.0.1 -p "$PGPORT" -q || { echo "no PostgreSQL on 127.0.0.1:$PGPORT — run scripts/db.sh start" >&2; exit 1; }
echo "Service-role credential regression test (network / scram-sha-256)"
echo "  off-loopback address under test: $NETHOST  (rule: $NETCIDR)"
echo

# --- arrange: the server's own pg_hba shape ----------------------------------
cp -f "$HBA" "$HBA.bak"
own_write "$HBA" <<HBA_RULES
local   all all                       trust
host    all all 127.0.0.1/32          trust
host    all all ${NETCIDR}            scram-sha-256
HBA_RULES
pg_listen_on '*'
pg_isready -h "$NETHOST" -p "$PGPORT" -q || { echo "the server is not listening on $NETHOST" >&2; exit 1; }

for r in "${ROLES[@]}"; do
  if admin -tAc "select 1 from pg_roles where rolname = '$r';" | grep -qx 1; then
    pre_existing="$pre_existing $r"
  else
    admin -c "create role \"$r\" login noinherit;" >/dev/null
  fi
done

# Log in as $1 with the configured password. $2 = host.
login() {
  PGPASSWORD="$CONFIGURED" psql -X -q -tAc 'select 1' \
    -h "$2" -p "$PGPORT" -U "$1" -d postgres 2>"$ROOT/.cred-test.err" | grep -qx 1
}
# The stored verifier's SCHEME only — never the verifier.
scheme() {
  admin -tAc "select case
                when rolpassword is null then 'none'
                when rolpassword like 'SCRAM-SHA-256\$%' then 'SCRAM-SHA-256'
                when rolpassword like 'md5%' then 'md5'
                else 'other' end
              from pg_authid where rolname = '$1';" 2>/dev/null | tr -d '[:space:]'
}
# What a database image configured for md5 leaves behind.
write_md5_verifiers() {
  admin -c "set password_encryption = 'md5';" >/dev/null 2>&1
  for r in "${ROLES[@]}"; do
    admin -c "set password_encryption='md5'; alter role \"$r\" with password '$CONFIGURED';" >/dev/null
  done
}

# --- 1. the defect, reproduced ------------------------------------------------
echo "The office-server failure, reproduced (md5 verifier + scram rule)"
write_md5_verifiers
for r in "${ROLES[@]}"; do
  [ "$(scheme "$r")" = "md5" ] && ok "$r stored an md5 verifier" \
                               || bad "$r did not store an md5 verifier" "got: $(scheme "$r")"
done
for r in "${ROLES[@]}"; do
  if login "$r" 127.0.0.1; then
    ok "$r 'passes' over loopback — the false positive, because 127.0.0.1 is trust"
  else
    bad "$r did not pass over loopback" "the trust rule is not in effect; the test proves nothing"
  fi
done
for r in "${ROLES[@]}"; do
  if login "$r" "$NETHOST"; then
    bad "$r authenticated over the network with an md5 verifier" "scram is not being enforced"
  elif grep -q "password authentication failed" "$ROOT/.cred-test.err"; then
    ok "$r is REFUSED over the network: password authentication failed (the VPS symptom)"
  else
    bad "$r failed over the network for the wrong reason" "$(head -1 "$ROOT/.cred-test.err")"
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
  [ "$(scheme "$r")" = "SCRAM-SHA-256" ] && ok "$r now has a SCRAM-SHA-256 verifier" \
                                         || bad "$r has no SCRAM verifier" "scheme: $(scheme "$r")"
done
for r in "${ROLES[@]}"; do
  login "$r" "$NETHOST" && ok "$r authenticates OVER THE NETWORK under scram-sha-256" \
                        || bad "$r still cannot authenticate over the network" "$(head -1 "$ROOT/.cred-test.err")"
done
echo

# --- 3. the alignment refuses to leave a non-SCRAM verifier -------------------
echo "Guard: the alignment asserts the verifier it stored"
write_md5_verifiers
admin -c "alter system set password_encryption = 'md5';" >/dev/null 2>&1
admin -c "select pg_reload_conf();" >/dev/null 2>&1
if POSTGRES_PASSWORD="$CONFIGURED" admin -f "$ROOT/deploy/db/service-roles.sql" >/dev/null 2>&1; then
  ok "it still produced SCRAM verifiers on a server configured for md5"
else
  bad "it failed on a server configured for md5" "it must override password_encryption for its own session"
fi
allscram=1; for r in "${ROLES[@]}"; do [ "$(scheme "$r")" = "SCRAM-SHA-256" ] || allscram=0; done
[ "$allscram" = 1 ] && ok "server default md5 did not leak into the stored verifiers" \
                    || bad "an md5 verifier survived the alignment"
netok=1; for r in "${ROLES[@]}"; do login "$r" "$NETHOST" || netok=0; done
[ "$netok" = 1 ] && ok "all three authenticate over the network" || bad "a role fails over the network"
admin -c "alter system reset password_encryption;" >/dev/null 2>&1
admin -c "select pg_reload_conf();" >/dev/null 2>&1
echo

# --- 4. idempotent ------------------------------------------------------------
echo "Re-running it (an existing deployment restarting)"
POSTGRES_PASSWORD="$CONFIGURED" admin -f "$ROOT/deploy/db/service-roles.sql" >/dev/null 2>&1
netok=1; for r in "${ROLES[@]}"; do login "$r" "$NETHOST" || netok=0; done
[ "$netok" = 1 ] && ok "all three still authenticate — idempotent, nothing corrupted" \
                 || bad "a role stopped authenticating after a second run"
echo

# --- 5. a fresh database ------------------------------------------------------
echo "Fresh initialisation (a volume that has never been aligned)"
# Not a drop-and-recreate: supabase_auth_admin owns the auth schema, so dropping it
# fails on its dependencies. The state that matters is the one a new volume is in —
# the roles exist and carry whatever the image gave them, and no alignment has run.
# Both starting points are covered: never given a password at all, then the image's
# own md5 verifier.
for r in "${ROLES[@]}"; do admin -c "alter role \"$r\" with password null;" >/dev/null 2>&1; done
POSTGRES_PASSWORD="$CONFIGURED" admin -f "$ROOT/deploy/db/service-roles.sql" >/dev/null 2>&1
netok=1; for r in "${ROLES[@]}"; do login "$r" "$NETHOST" || netok=0; done
[ "$netok" = 1 ] && ok "roles with no password at all: aligned and authenticating over the network" \
                 || bad "a never-passworded role still fails over the network"
write_md5_verifiers
POSTGRES_PASSWORD="$CONFIGURED" admin -f "$ROOT/deploy/db/service-roles.sql" >/dev/null 2>&1
netok=1; for r in "${ROLES[@]}"; do login "$r" "$NETHOST" || netok=0; done
[ "$netok" = 1 ] && ok "a fresh database authenticates over the network after one alignment" \
                 || bad "a fresh database still fails over the network"
echo

# --- 6. empty password guard --------------------------------------------------
echo "Guard: an empty POSTGRES_PASSWORD"
if POSTGRES_PASSWORD="" admin -f "$ROOT/deploy/db/service-roles.sql" >/dev/null 2>&1; then
  bad "an empty POSTGRES_PASSWORD was accepted" "it would have blanked the service-role passwords"
else
  ok "an empty POSTGRES_PASSWORD is refused"
fi
netok=1; for r in "${ROLES[@]}"; do login "$r" "$NETHOST" || netok=0; done
[ "$netok" = 1 ] && ok "the refused run left the working credentials intact" \
                 || bad "the refused run damaged the credentials"

echo
echo "──────────────────────────────────────────"
echo "passed $PASS, failed $FAIL"
[ "$FAIL" = 0 ] || exit 1
