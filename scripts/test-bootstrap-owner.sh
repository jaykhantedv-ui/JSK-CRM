#!/usr/bin/env bash
# First-OWNER bootstrap regression test.
#
#   scripts/test-bootstrap-owner.sh
#
# WHAT IT EXISTS TO CATCH. A production deployment that cannot be signed into.
# There is no self-registration (§3.2), the production seed is deliberately empty,
# and users are created by an OWNER through the provisioning Server Action — so
# with no OWNER the deployment is deadlocked. `deploy/bootstrap-owner.sh` is the
# one way out, it runs ONCE on a real business's live database, and it therefore
# has to be right the first time.
#
# WHAT IS REAL HERE AND WHAT IS SUBSTITUTED. The cluster is shaped like the image
# (supabase_admin as the bootstrap superuser), the real migrations are applied by
# the real deploy/migrate.sh, and the real deploy/bootstrap-owner.sh runs against
# them — so the `on_auth_user_created` trigger, the `user_role` enum, the unique
# email and the foreign key to auth.users are all genuine. Two things are stood
# in for, because their container images cannot be pulled here:
#
#   * `docker compose exec db` -> a local psql (scripts/lib/compose-shim.sh)
#   * GoTrue                   -> scripts/lib/gotrue-stub.mjs, which inserts the
#                                 auth.users row with a bcrypt password exactly
#                                 as GoTrue does, and REQUIRES the service-role
#                                 key on its admin routes
#
# NO PASSWORD, KEY OR SECRET IS PRINTED. The test reads a generated password to
# prove it actually works, and never echoes it.
#
# Nothing outside its own temporary cluster is touched, and the temporary env
# file is restored on exit including on failure.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${DATA:-/var/lib/jsk-bootstrap-test}
PORT=${PORT:-54391}
STUB_PORT=${STUB_PORT:-54390}
PROD_ENV="$ROOT/deploy/env/production.env"
WORK="$(mktemp -d)"

PASS=0; FAIL=0
ok()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  \033[31mFAIL\033[0m  %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }

STUB_PID=""
cleanup() {
  [ -n "$STUB_PID" ] && kill "$STUB_PID" >/dev/null 2>&1
  su postgres -c "$PGBIN/pg_ctl -D $DATA -w -s -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$WORK"
  [ -f "$PROD_ENV.bootbak" ] && mv -f "$PROD_ENV.bootbak" "$PROD_ENV" || rm -f "$PROD_ENV"
}
trap cleanup EXIT

echo "First-OWNER bootstrap regression test"
echo

# --- a cluster shaped like the image, carrying the real migrations ------------
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
sq() { psql -X -tAq "$SA" -c "$1" 2>/dev/null | tr -d '[:space:]'; }

psql -X -q -v ON_ERROR_STOP=1 "$SA" -c "create role postgres login nosuperuser createdb;" >/dev/null 2>&1
psql -X -q -v ON_ERROR_STOP=1 "$SA" -f "$ROOT/supabase/platform/000_supabase_platform.sql" >/dev/null 2>&1

. "$ROOT/scripts/lib/compose-shim.sh"
write_compose_shim "$WORK/bin" "$PORT"

# The env file the deploy scripts read. SERVICE_ROLE_KEY is a throwaway value
# generated here; it never leaves this test and is never printed.
[ -f "$PROD_ENV" ] && mv -f "$PROD_ENV" "$PROD_ENV.bootbak"
mkdir -p "$(dirname "$PROD_ENV")"
STUB_KEY="$(openssl rand -hex 32)"
{
  echo "POSTGRES_PASSWORD=bootstrap-test-not-a-real-password"
  echo "SERVICE_ROLE_KEY=$STUB_KEY"
  echo "PUBLIC_URL=http://bootstrap.test"
} > "$PROD_ENV"
chmod 600 "$PROD_ENV"

PATH="$WORK/bin:$PATH" "$ROOT/deploy/migrate.sh" >"$WORK/migrate.log" 2>&1
[ "$(sq "select count(*) from pg_tables where schemaname='public';")" = "14" ] \
  && ok "an empty, freshly migrated database: 14 CRM tables, no users" \
  || bad "the test database is not correctly migrated" "$(tail -2 "$WORK/migrate.log")"
# The ADR-003 system actor is the only row, and it is an INACTIVE ADMIN.
[ "$(sq "select count(*) from public.users where is_active;")" = "0" ] \
  && ok "no active user of any role exists yet — the deadlock this fixes" \
  || bad "the fresh database already has an active user"

# --- the Auth service stand-in ------------------------------------------------
STUB_LOG="$WORK/gotrue.log"; : > "$STUB_LOG"
node "$ROOT/scripts/lib/gotrue-stub.mjs" "$STUB_PORT" "$SA" "$STUB_KEY" "$STUB_LOG" \
  >"$WORK/stub.out" 2>&1 &
STUB_PID=$!
curl -fsS --retry-connrefused --retry 30 --retry-delay 1 --max-time 3 \
     "http://127.0.0.1:$STUB_PORT/auth/v1/health" -o /dev/null 2>/dev/null \
  && ok "the Auth stand-in is answering" \
  || { bad "the Auth stand-in did not start" "$(head -2 "$WORK/stub.out")"; echo; echo "passed $PASS, failed $FAIL"; exit 1; }

# TWO WAYS TO RUN IT, because it behaves differently in each and both are real.
#
#   boot ...      no controlling terminal — a provisioning run. `--confirm-production`
#                 is the whole confirmation. `setsid --wait` is what detaches it;
#                 without that this test inherits a terminal and the script
#                 (correctly) stops to ask for the typed word.
#   boot_tty ...  a real pseudo-terminal, which is how an operator runs it over
#                 SSH: the deployment is named and BOOTSTRAP-OWNER must be typed.
boot() { PATH="$WORK/bin:$PATH" BOOTSTRAP_SUPABASE_URL="http://127.0.0.1:$STUB_PORT" \
           setsid --wait "$ROOT/deploy/bootstrap-owner.sh" "$@"; }

write_tty_runner() { # write_tty_runner <file> <bootstrap args...>
  local file="$1"; shift
  {
    echo '#!/bin/sh'
    echo "export PATH=\"$WORK/bin:\$PATH\""
    echo "export BOOTSTRAP_SUPABASE_URL=\"http://127.0.0.1:$STUB_PORT\""
    printf 'exec %s\n' "$(printf '%q ' "$ROOT/deploy/bootstrap-owner.sh" "$@")"
  } > "$file"
  chmod +x "$file"
}
# `script` allocates the pty; -e returns the child's status. The typed answer
# arrives on stdin and reaches the script through /dev/tty, exactly as a person's
# keystrokes would.
boot_tty() { # boot_tty <answer> <runner-file>
  printf '%s\n' "$1" | script -qec "$2" /dev/null
}
OWNER_EMAIL="owner@jskcrm.online"
echo

# --- 1. it refuses to do anything without explicit confirmation ---------------
echo "Before anything is created"
boot --status >"$WORK/status0.log" 2>&1
[ "$?" = "3" ] && ok "--status reports the deployment is not bootstrapped" \
               || bad "--status did not report a missing owner" "$(head -1 "$WORK/status0.log")"

boot --email "$OWNER_EMAIL" --name "Test Owner" >"$WORK/noconfirm.log" 2>&1
NOCONFIRM=$?
[ "$NOCONFIRM" != "0" ] && ok "without --confirm-production it refuses" \
                        || bad "it created an owner with no confirmation"
grep -q "confirm-production" "$WORK/noconfirm.log" \
  && ok "and names the flag that is missing" || bad "the refusal did not say what to do"

boot --email "$OWNER_EMAIL" --name "Test Owner" --confirm-production \
     --password "hunter2-hunter2" >"$WORK/pwarg.log" 2>&1
[ "$?" != "0" ] && ok "a password in an ARGUMENT is refused outright" \
                || bad "a password was accepted on the command line"
grep -qi "visible in" "$WORK/pwarg.log" \
  && ok "and it says why — ps and shell history" || bad "the refusal did not explain"

[ "$(sq "select count(*) from public.users where is_active;")" = "0" ] \
  && ok "none of those refusals created anything" || bad "a refused run still created a user"
echo

# --- 2. the bootstrap itself --------------------------------------------------
echo "The one-time bootstrap"
TYPED_PASSWORD="$(openssl rand -base64 18)"
printf '%s\n' "$TYPED_PASSWORD" | boot --email "$OWNER_EMAIL" --name "Real Owner" \
  --confirm-production --password-stdin >"$WORK/boot.log" 2>&1
BOOT_STATUS=$?
[ "$BOOT_STATUS" = "0" ] && ok "an empty database: the bootstrap succeeds" \
  || bad "the bootstrap failed" "$(grep -iE 'error|refus|cannot|could not' "$WORK/boot.log" | head -1)"

# The auth account and the profile must be ONE account, not two half-made ones.
CONSISTENT="$(sq "select count(*) from public.users u join auth.users a on a.id = u.id
                   where u.email = '$OWNER_EMAIL' and a.email = u.email")"
[ "$CONSISTENT" = "1" ] \
  && ok "the Auth user and the public.users row share one id and one address" \
  || bad "the auth account and the profile do not match" "joined rows: ${CONSISTENT:-0}"
[ "$(sq "select role::text from public.users where email = '$OWNER_EMAIL';")" = "OWNER" ] \
  && ok "the profile's role is OWNER" || bad "the role is not OWNER"
[ "$(sq "select is_active::text from public.users where email = '$OWNER_EMAIL';")" = "true" ] \
  && ok "and the account is active" || bad "the owner is not active"
[ "$(sq "select full_name from public.users where email = '$OWNER_EMAIL';")" = "RealOwner" ] \
  && ok "the name given on the command line is the name stored" || bad "the full name was not applied"
[ "$(sq "select email_confirmed_at is not null from auth.users where email = '$OWNER_EMAIL';")" = "t" ] \
  && ok "the address is confirmed, so the owner can sign in with no SMTP configured" \
  || bad "the auth account is unconfirmed — it could never sign in"

# The password that was typed is the password that was stored. Compared inside
# the database against the bcrypt verifier; never printed.
# `-f -`, not `-c`: psql expands `:'pw'` only for input it reads as a file or on
# stdin. The same trap the bootstrap itself hit.
VERIFIES="$(psql -X -tAq "$SA" -v pw="$TYPED_PASSWORD" -v em="$OWNER_EMAIL" -f - 2>/dev/null <<'SQL' | tr -d '[:space:]'
select encrypted_password = extensions.crypt(:'pw', encrypted_password)
  from auth.users where email = :'em';
SQL
)"
[ "$VERIFIES" = "t" ] && ok "the password given on stdin is the one that can sign in" \
                      || bad "the stored password does not verify"

# --- 3. it went through the admin API, and never wrote auth.users itself ------
grep -q '"path":"/auth/v1/admin/users","authorized":true' "$STUB_LOG" \
  && ok "the account was created through the Auth ADMIN API, with the service key" \
  || bad "the admin API was not called as expected" "$(tail -1 "$STUB_LOG")"
grep -qE 'insert into auth\.users|insert +into +"?auth"?\.' "$ROOT/deploy/bootstrap-owner.sh" \
  && bad "the script writes auth.users by hand" "GoTrue owns that table and the password hashing" \
  || ok "and the script contains no hand-written auth.users insert"

# --- 4. no secret reached the output -----------------------------------------
grep -qF "$STUB_KEY" "$WORK/boot.log" \
  && bad "the service-role key was printed" || ok "the service-role key never appears in the output"
grep -qF "$TYPED_PASSWORD" "$WORK/boot.log" \
  && bad "the supplied password was printed" || ok "a password supplied on stdin is never echoed"
echo

# --- 5. running it a second time ---------------------------------------------
echo "Running it again"
printf '%s\n' "$TYPED_PASSWORD" | boot --email "second@jskcrm.online" --name "Second Owner" \
  --confirm-production --password-stdin >"$WORK/again.log" 2>&1
AGAIN=$?
[ "$AGAIN" = "3" ] && ok "a second bootstrap is refused" \
                   || bad "a second bootstrap was not refused" "exit $AGAIN"
grep -q "already has an active OWNER" "$WORK/again.log" \
  && ok "and says so in plain words, naming the existing owner" \
  || bad "the refusal message is not clear" "$(head -1 "$WORK/again.log")"
grep -q "Settings" "$WORK/again.log" \
  && ok "and points at the path that creates every other user" || bad "no next step was offered"
[ "$(sq "select count(*) from public.users where role='OWNER' and is_active;")" = "1" ] \
  && ok "still exactly one active OWNER — nothing was changed" \
  || bad "the refused run changed the owner set"
[ "$(sq "select count(*) from auth.users where email = 'second@jskcrm.online';")" = "0" ] \
  && ok "and no second Auth account was created" || bad "a second auth account exists"

boot --status >"$WORK/status1.log" 2>&1
[ "$?" = "0" ] && grep -q "$OWNER_EMAIL" "$WORK/status1.log" \
  && ok "--status now names the active owner" || bad "--status did not report the owner"
echo

# --- 6. a DEACTIVATED owner does not count -----------------------------------
#
# The guard is on an owner who can actually sign in. A deactivated one resolves
# to no role at all — `current_user_id()` filters on is_active — so it leaves the
# deployment just as deadlocked and must not block the bootstrap. This also
# covers the generated-password path.
echo "A deactivated owner, at a terminal, with a generated password"
psql -X -q "$SA" -c "update public.users set is_active = false where email = '$OWNER_EMAIL';" >/dev/null 2>&1

# At a terminal the flag is not enough on its own: a runbook can be copied and
# pasted into the wrong server, and the typed word is what stops that.
write_tty_runner "$WORK/rescue.sh" --email "rescue@jskcrm.online" --name "Rescue Owner" \
  --confirm-production
boot_tty "no thanks" "$WORK/rescue.sh" >"$WORK/wrongword.log" 2>&1
WRONG=$?
[ "$WRONG" != "0" ] && ok "at a terminal, the wrong word cancels it" \
                    || bad "it proceeded without the typed confirmation"
grep -qi "cancelled" "$WORK/wrongword.log" \
  && ok "and says it was cancelled" || bad "no cancellation message" "$(tail -1 "$WORK/wrongword.log")"
[ "$(sq "select count(*) from auth.users where email = 'rescue@jskcrm.online';")" = "0" ] \
  && ok "and nothing was created by the cancelled run" || bad "the cancelled run created an account"

boot_tty "BOOTSTRAP-OWNER" "$WORK/rescue.sh" >"$WORK/gen.log" 2>&1
GEN=$?
tr -d '\r' < "$WORK/gen.log" > "$WORK/gen.clean" && mv "$WORK/gen.clean" "$WORK/gen.log"
[ "$GEN" = "0" ] && ok "a DEACTIVATED owner does not block the bootstrap" \
                 || bad "a deactivated owner blocked it" "$(grep -iE 'error|refus' "$WORK/gen.log" | head -1)"
[ "$(sq "select role::text from public.users where email = 'rescue@jskcrm.online';")" = "OWNER" ] \
  && ok "the generated-password path also produces an active OWNER" || bad "the second owner is not OWNER"

# The generated password is read out of the script's own output and checked
# against the stored hash — it is the only copy that exists, so it has to work.
GENERATED="$(sed -n 's/^  Password: //p' "$WORK/gen.log" | head -1)"
[ -n "$GENERATED" ] && ok "a generated password is shown once, so the owner can sign in" \
                    || bad "no generated password was reported"
GENVERIFIES="$(psql -X -tAq "$SA" -v pw="${GENERATED:-none}" -f - 2>/dev/null <<'SQL' | tr -d '[:space:]'
select encrypted_password = extensions.crypt(:'pw', encrypted_password)
  from auth.users where email = 'rescue@jskcrm.online';
SQL
)"
[ "$GENVERIFIES" = "t" ] && ok "and it is genuinely the password that was stored" \
                         || bad "the generated password does not verify"
[ "${#GENERATED}" -ge 24 ] && ok "it is long enough to be worth generating (${#GENERATED} characters)" \
                           || bad "the generated password is too short" "${#GENERATED} characters"
grep -q "change it" "$WORK/gen.log" \
  && ok "and the operator is told to change it" || bad "no instruction to change the password"

echo
echo "──────────────────────────────────────────"
echo "passed $PASS, failed $FAIL"
[ "$FAIL" = 0 ] || exit 1
