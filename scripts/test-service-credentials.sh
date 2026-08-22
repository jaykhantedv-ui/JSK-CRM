#!/usr/bin/env bash
# Deployment regression test for the self-hosted Supabase service credentials.
#
#   scripts/test-service-credentials.sh
#
# It builds a THROWAWAY PostgreSQL cluster that reproduces the Supabase image's
# privilege layout and pg_hba shape, and proves the alignment works there. Three
# separate faults hid behind one another on the office server, and each needs a
# different property of that cluster to be visible at all:
#
#   1. WRONG ADMINISTRATIVE ROLE. In the image `postgres` is an ordinary role and
#      `supabase_admin` is the superuser, and the three service roles are reserved:
#          "authenticator" is a reserved role, only superusers can modify it
#      So the cluster here is initdb'd with supabase_admin as the BOOTSTRAP
#      superuser and `postgres` created afterwards as an ordinary role. PostgreSQL
#      refuses to remove SUPERUSER from a cluster's own bootstrap user, so this is
#      the only faithful way to model it.
#
#   2. WRONG VERIFIER SCHEME. `alter role ... password` stores whatever
#      `password_encryption` names at that moment. An md5 verifier cannot satisfy a
#      `scram-sha-256` rule, so the role gets a password that works from one
#      address and is refused from every other.
#
#   3. A TEST THAT COULD NOT FAIL. The image trusts loopback:
#          host all all 127.0.0.1/32   trust
#          host all all 172.16.0.0/12  scram-sha-256
#      so a login from inside the db container never checks the password. Both
#      rules exist here, on loopback and on a real off-loopback address, and the
#      md5 verifier is shown passing over the first and failing over the second.
#
# Needs no container images, and touches no other cluster: everything happens in a
# temporary data directory that is removed on exit, including on failure.
#
# NO PASSWORD OR VERIFIER IS PRINTED. Only the scheme's name is ever reported.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
TESTDATA=${TESTDATA:-/var/lib/jsk-cred-test}
TESTPORT=${TESTPORT:-54399}
ADMIN_ROLE=supabase_admin
ROLES=(authenticator supabase_auth_admin supabase_storage_admin)

NETHOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$NETHOST" ] || { echo "no non-loopback address on this host — cannot test the network path" >&2; exit 1; }
NETCIDR="$(echo "$NETHOST" | awk -F. '{print $1"."$2"."$3".0/24"}')"

PASS=0; FAIL=0
ok()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  \033[31mFAIL\033[0m  %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }

CONFIGURED="$(openssl rand -hex 24)"

cleanup() {
  su postgres -c "$PGBIN/pg_ctl -D $TESTDATA -w -s -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$TESTDATA" "$ROOT/.cred-test.err"
}
trap cleanup EXIT

echo "Service-role credential regression test"
echo "  throwaway cluster on port $TESTPORT; off-loopback address $NETHOST ($NETCIDR)"
echo

# --- a cluster shaped like the Supabase image --------------------------------
rm -rf "$TESTDATA"; mkdir -p "$TESTDATA"; chown postgres:postgres "$TESTDATA"; chmod 700 "$TESTDATA"
su postgres -c "$PGBIN/initdb -D $TESTDATA -U $ADMIN_ROLE --auth-local=trust --auth-host=trust -E UTF8 --locale=C" >/dev/null 2>&1 \
  || { echo "initdb failed" >&2; exit 1; }

# Loopback trusted, the network under scram — exactly the image's shape.
cat > "$TESTDATA/pg_hba.conf" <<HBA
local   all all                  trust
host    all all 127.0.0.1/32     trust
host    all all ${NETCIDR}       scram-sha-256
HBA
chown postgres:postgres "$TESTDATA/pg_hba.conf"; chmod 600 "$TESTDATA/pg_hba.conf"

su postgres -c "$PGBIN/pg_ctl -D $TESTDATA -l $TESTDATA/pg.log \
   -o '-p $TESTPORT -c listen_addresses=* -c timezone=UTC' -w start" >/dev/null 2>&1 \
  || { echo "could not start the test cluster; see $TESTDATA/pg.log" >&2; exit 1; }

sadmin()  { psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$TESTPORT" -U "$ADMIN_ROLE" -d postgres "$@"; }
pgadmin() { psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$TESTPORT" -U postgres      -d postgres "$@"; }

# `postgres` as the image has it: a login role with no superuser attribute.
sadmin -c "create role postgres login nosuperuser nocreaterole;" >/dev/null
for r in "${ROLES[@]}"; do sadmin -c "create role \"$r\" login noinherit;" >/dev/null; done

login() { # login <role> <host>
  PGPASSWORD="$CONFIGURED" psql -X -q -tAc 'select 1' \
    -h "$2" -p "$TESTPORT" -U "$1" -d postgres 2>"$ROOT/.cred-test.err" | grep -qx 1
}
scheme() { # the stored verifier's SCHEME only — never the verifier
  sadmin -tAc "select case
                 when rolpassword is null then 'none'
                 when rolpassword like 'SCRAM-SHA-256\$%' then 'SCRAM-SHA-256'
                 when rolpassword like 'md5%' then 'md5'
                 else 'other' end
               from pg_authid where rolname = '$1';" 2>/dev/null | tr -d '[:space:]'
}
write_md5_verifiers() { # what an image configured for md5 leaves behind
  for r in "${ROLES[@]}"; do
    sadmin -c "set password_encryption='md5'; alter role \"$r\" with password '$CONFIGURED';" >/dev/null
  done
}
align_as() { # align_as <sadmin|pgadmin>
  POSTGRES_PASSWORD="$CONFIGURED" "$1" -f "$ROOT/deploy/db/service-roles.sql" >"$ROOT/.cred-test.err" 2>&1
}

# --- 0. the privilege layout --------------------------------------------------
echo "Supabase privilege layout"
[ "$(sadmin -tAc "select rolsuper from pg_roles where rolname='postgres';" | tr -d '[:space:]')" = "f" ] \
  && ok "postgres is NOT a superuser (as in the Supabase image)" \
  || bad "postgres is a superuser here" "the layout under test is not the server's"
[ "$(sadmin -tAc "select rolsuper from pg_roles where rolname='$ADMIN_ROLE';" | tr -d '[:space:]')" = "t" ] \
  && ok "$ADMIN_ROLE IS the superuser" \
  || bad "$ADMIN_ROLE is not a superuser" "nothing below would be a real test"

# The deployment used to run this as `postgres`. On the server that produced
# `"authenticator" is a reserved role, only superusers can modify it`.
if align_as pgadmin; then
  bad "the alignment succeeded as postgres" "a non-superuser must not be able to alter these roles"
else
  ok "the alignment REFUSES to run as postgres"
fi
grep -qi "superuser" "$ROOT/.cred-test.err" \
  && ok "and it names the reason, before touching any role" \
  || bad "the refusal did not mention superuser" "$(head -1 "$ROOT/.cred-test.err")"
[ "$(scheme authenticator)" = "none" ] \
  && ok "the refused run left every role untouched" \
  || bad "the refused run modified a role" "authenticator scheme: $(scheme authenticator)"
echo

# --- 1. the defect, reproduced ------------------------------------------------
echo "The office-server failure, reproduced (md5 verifier + scram rule)"
write_md5_verifiers
for r in "${ROLES[@]}"; do
  [ "$(scheme "$r")" = "md5" ] && ok "$r stored an md5 verifier" \
                               || bad "$r did not store an md5 verifier" "got: $(scheme "$r")"
done
for r in "${ROLES[@]}"; do
  login "$r" 127.0.0.1 && ok "$r 'passes' over loopback — the false positive, 127.0.0.1 is trust" \
                       || bad "$r did not pass over loopback" "the trust rule is not in effect"
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

# --- 2. the fix, run as the platform superuser --------------------------------
echo "After deploy/db/service-roles.sql, run as $ADMIN_ROLE"
align_as sadmin && ok "the alignment applied cleanly as $ADMIN_ROLE" \
                || bad "the alignment failed as $ADMIN_ROLE" "$(head -2 "$ROOT/.cred-test.err" | tail -1)"
for r in "${ROLES[@]}"; do
  [ "$(scheme "$r")" = "SCRAM-SHA-256" ] && ok "$r now has a SCRAM-SHA-256 verifier" \
                                         || bad "$r has no SCRAM verifier" "scheme: $(scheme "$r")"
done
for r in "${ROLES[@]}"; do
  login "$r" "$NETHOST" && ok "$r authenticates OVER THE NETWORK under scram-sha-256" \
                        || bad "$r still cannot authenticate over the network" "$(head -1 "$ROOT/.cred-test.err")"
done
echo

# --- 3. a server whose own default is md5 -------------------------------------
echo "Guard: a server configured for md5"
write_md5_verifiers
sadmin -c "alter system set password_encryption = 'md5';" >/dev/null 2>&1
sadmin -c "select pg_reload_conf();" >/dev/null 2>&1
align_as sadmin && ok "it still produced SCRAM verifiers on an md5 server" \
                || bad "it failed on an md5 server" "it must override password_encryption for its own session"
allscram=1; for r in "${ROLES[@]}"; do [ "$(scheme "$r")" = "SCRAM-SHA-256" ] || allscram=0; done
[ "$allscram" = 1 ] && ok "the server default did not leak into the stored verifiers" \
                    || bad "an md5 verifier survived the alignment"
netok=1; for r in "${ROLES[@]}"; do login "$r" "$NETHOST" || netok=0; done
[ "$netok" = 1 ] && ok "all three authenticate over the network" || bad "a role fails over the network"
sadmin -c "alter system reset password_encryption;" >/dev/null 2>&1
sadmin -c "select pg_reload_conf();" >/dev/null 2>&1
echo

# --- 4. idempotent ------------------------------------------------------------
echo "Re-running it (an existing deployment restarting)"
align_as sadmin
netok=1; for r in "${ROLES[@]}"; do login "$r" "$NETHOST" || netok=0; done
[ "$netok" = 1 ] && ok "all three still authenticate — idempotent, nothing corrupted" \
                 || bad "a role stopped authenticating after a second run"
echo

# --- 5. a fresh volume --------------------------------------------------------
echo "Fresh initialisation (a volume that has never been aligned)"
for r in "${ROLES[@]}"; do sadmin -c "alter role \"$r\" with password null;" >/dev/null 2>&1; done
align_as sadmin
netok=1; for r in "${ROLES[@]}"; do login "$r" "$NETHOST" || netok=0; done
[ "$netok" = 1 ] && ok "roles with no password at all: aligned and authenticating over the network" \
                 || bad "a never-passworded role still fails over the network"
echo

# --- 6. empty password guard --------------------------------------------------
echo "Guard: an empty POSTGRES_PASSWORD"
if POSTGRES_PASSWORD="" sadmin -f "$ROOT/deploy/db/service-roles.sql" >/dev/null 2>&1; then
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
