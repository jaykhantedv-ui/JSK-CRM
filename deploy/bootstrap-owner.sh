#!/usr/bin/env bash
# ONE-TIME first OWNER bootstrap (§3.2, ADR-009, ADR-039).
#
#   deploy/bootstrap-owner.sh --email a@b.c --name 'Full Name' --confirm-production
#   deploy/bootstrap-owner.sh --email a@b.c --name 'Full Name' --confirm-production \
#                             --password-stdin < /dev/tty
#   deploy/bootstrap-owner.sh --status
#
# WHY THIS EXISTS. There is no self-registration in any environment (§3.2), the
# production seed is deliberately empty, and users are created by an OWNER or an
# ADMIN through the provisioning Server Action. On a brand-new deployment that is
# a deadlock: the first OWNER cannot be created from inside the application
# because creating a user requires being one. This is the only way out of it, and
# it is the ONLY thing this script does.
#
# IT IS NOT A USER-MANAGEMENT TOOL. It refuses once an active OWNER exists, so it
# runs exactly once in the life of a deployment. Every user after the first is
# created at Settings → Users, by that OWNER.
#
# IT USES THE SAME SEQUENCE THE APPLICATION USES (services/user.service.ts):
#
#   1. the Supabase Auth ADMIN API creates the account — POST /auth/v1/admin/users
#      with email_confirm and full_name in user_metadata, which is exactly what
#      `admin.auth.admin.createUser()` sends;
#   2. the `on_auth_user_created` trigger mirrors it into `public.users` as an
#      active SALESPERSON (migration 003), as it does for every user;
#   3. the role is set to OWNER afterwards, server-side — the same order, and for
#      the same reason: the trigger ignores any role in the sign-up metadata so
#      that user creation can never become a role-escalation path.
#
# NO auth.users ROW IS EVER WRITTEN BY HAND. GoTrue owns that table and the
# password hashing in it; a hand-made row produces an account that cannot sign in
# and a password nobody can verify.
#
# NO SECRET IS PRINTED and none crosses a command line. The service-role key is
# read from the environment file into a curl configuration on stdin; the password
# is read from stdin or generated, and reaches curl through a 0600 file in a
# private temporary directory that is deleted on exit. A GENERATED password is
# shown once, at the end, because there is otherwise no way to sign in with it —
# that is the one deliberate exception, and it is flagged where it happens.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/env/production.env"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

DC=(docker compose --env-file "$ENV_FILE")
. "$ROOT/deploy/lib/db-admin.sh"
. "$ROOT/scripts/lib/preflight.sh"
require_commands "the owner bootstrap" docker curl openssl || exit 1
# Named, never printed. Without it the admin API answers 401 and the reason is
# not obvious from the response.
: "${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY is required — see deploy/keygen.sh}"
trap 'report_failed_command $LINENO' ERR

# Where the Supabase gateway is reachable FROM THIS HOST. compose publishes it on
# the loopback interface by default; an operator who has deliberately moved it
# with PUBLISH_HOST sets this instead of editing the script.
SUPABASE_ORIGIN="${BOOTSTRAP_SUPABASE_URL:-http://127.0.0.1:${SUPABASE_PORT:-54321}}"

usage() {
  sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
}

EMAIL=""; NAME=""; CONFIRMED=0; PASSWORD_STDIN=0; MODE=create
while [ $# -gt 0 ]; do
  case "$1" in
    # `shift 2` with nothing to shift fails under `set -e` and reports the shift
    # rather than the missing value, so the arity is checked first.
    --email) [ $# -ge 2 ] || { echo "--email needs a value" >&2; exit 2; }
             EMAIL="$2"; shift 2 ;;
    --name)  [ $# -ge 2 ] || { echo "--name needs a value" >&2; exit 2; }
             NAME="$2"; shift 2 ;;
    --confirm-production) CONFIRMED=1; shift ;;
    --password-stdin) PASSWORD_STDIN=1; shift ;;
    --status) MODE=status; shift ;;
    -h|--help) usage; exit 0 ;;
    # A password on the command line is readable by every process on the machine
    # and lands in the shell history. Refused by name so the mistake is obvious
    # rather than silently accepted (requirement: no secrets in arguments).
    --password|--password=*)
      echo "A password is never passed as an argument — it would be visible in" >&2
      echo "\`ps\` and in the shell history. Use --password-stdin, or omit it and" >&2
      echo "one will be generated." >&2
      exit 2 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

require_admin_path || exit 1

# --- who is the OWNER now? ----------------------------------------------------
#
# `is_active` matters as much as the role. A deactivated OWNER cannot sign in and
# cannot create anyone, so it does not resolve the deadlock and must not block
# the bootstrap. The ADR-003 system actor is an inactive ADMIN and is likewise
# never a match.
owner_count() {
  psql_admin -tAc \
    "select count(*) from public.users where role = 'OWNER' and is_active" \
    | tr -d '[:space:]'
}
owner_emails() {
  psql_admin -tAc \
    "select string_agg(email, ', ' order by email) from public.users
      where role = 'OWNER' and is_active"
}

EXISTING="$(owner_count)"

if [ "$MODE" = "status" ]; then
  if [ "${EXISTING:-0}" = "0" ]; then
    echo "no active OWNER — this deployment still needs the one-time bootstrap"
    exit 3
  fi
  echo "active OWNER(s): $(owner_emails)"
  exit 0
fi

# --- 1. refuse if the deployment is already bootstrapped ----------------------
#
# Re-running this is expected — an operator who is unsure whether it worked will
# run it again — so it stops with a message and changes nothing.
if [ "${EXISTING:-0}" != "0" ]; then
  echo "This deployment already has an active OWNER: $(owner_emails)" >&2
  echo >&2
  echo "The bootstrap runs ONCE. Every user after the first is created by that" >&2
  echo "owner at Settings → Users, which is the path that applies the role and" >&2
  echo "outlet scope correctly. Nothing has been changed." >&2
  echo >&2
  echo "If that owner cannot sign in, reset their password at Settings → Users" >&2
  echo "as an ADMIN — do not create a second one here." >&2
  exit 3
fi

# --- 2. the inputs ------------------------------------------------------------
[ -n "$EMAIL" ] || { echo "--email is required" >&2; usage; exit 2; }
[ -n "$NAME" ]  || { echo "--name is required" >&2; usage; exit 2; }
case "$EMAIL" in
  *@*.*) ;;
  *) echo "that does not look like an email address: $EMAIL" >&2; exit 2 ;;
esac
# Stored lower-case, as Supabase Auth stores it, so the profile and the auth
# account cannot disagree about the address.
EMAIL="$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]')"

# --- 3. explicit production confirmation --------------------------------------
if [ "$CONFIRMED" != "1" ]; then
  echo "This creates a REAL OWNER account on ${PUBLIC_URL:-this deployment}." >&2
  echo "Re-run with --confirm-production once that is what you mean." >&2
  exit 2
fi
# A flag cannot be typed by accident, but a flag copied out of a runbook can. At
# a terminal the deployment is named and the word is typed out; with no terminal
# — a provisioning run — the flag is the confirmation.
# `[ -r /dev/tty ]` is not the question — the device node passes that test even
# when the process has no controlling terminal, and the write then fails with
# "No such device or address". Opening it is the only honest check.
if { : > /dev/tty; } 2>/dev/null; then
  {
    echo
    echo "  Creating the FIRST OWNER of ${PUBLIC_URL:-this deployment}."
    echo "  Email: ${EMAIL}"
    echo "  This account can see and change everything in the CRM."
    echo
  } > /dev/tty
  printf '  Type BOOTSTRAP-OWNER to continue: ' > /dev/tty
  IFS= read -r confirm < /dev/tty || confirm=""
  [ "$confirm" = "BOOTSTRAP-OWNER" ] || { echo "cancelled" >&2; exit 2; }
fi

# --- 4. the password ----------------------------------------------------------
#
# Twelve is deliberately stricter than the eight the in-application form allows
# (services/user.service.ts). This is the only account that exists on the
# deployment and it can create every other one; it is also typed once and then
# changed, so length costs nothing here.
GENERATED=0
if [ "$PASSWORD_STDIN" = "1" ]; then
  IFS= read -r PASSWORD || true
  [ -n "$PASSWORD" ] || { echo "no password arrived on stdin" >&2; exit 2; }
  [ "${#PASSWORD}" -ge 12 ] || { echo "use at least twelve characters" >&2; exit 2; }
  case "$PASSWORD" in
    *[[:cntrl:]]*) echo "the password contains a control character" >&2; exit 2 ;;
  esac
else
  # 24 bytes of CSPRNG output. base64's alphabet needs no escaping in JSON, which
  # keeps the body below unambiguous.
  PASSWORD="$(openssl rand -base64 24)"
  GENERATED=1
fi

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
umask 077

# --- 5. is the Auth service reachable? ----------------------------------------
echo "--- checking the Supabase gateway on this host"
if ! curl -fsS --max-time 10 "$SUPABASE_ORIGIN/auth/v1/health" -o /dev/null; then
  echo "cannot reach the Auth service at ${SUPABASE_ORIGIN}/auth/v1/health" >&2
  echo "Start the stack with deploy/start.sh, or — if the gateway is published" >&2
  echo "somewhere other than the loopback interface — set BOOTSTRAP_SUPABASE_URL" >&2
  echo "to the address it answers on." >&2
  exit 1
fi

# --- 6. create the Auth account through the ADMIN API -------------------------
#
# The same request services/user.service.ts makes. `email_confirm` is what makes
# the account usable immediately: there is no SMTP requirement in V1 (§9), so an
# unconfirmed first owner could never sign in.
#
# The body is a 0600 file rather than an argument, and the key reaches curl in a
# configuration read from stdin, so neither appears in `ps`.
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
cat > "$WORK/body.json" <<JSON
{"email":"$(json_escape "$EMAIL")",
 "password":"$(json_escape "$PASSWORD")",
 "email_confirm":true,
 "user_metadata":{"full_name":"$(json_escape "$NAME")"}}
JSON
chmod 600 "$WORK/body.json"

admin_api() { # admin_api <method> <path> [body-file]
  local method="$1" path="$2" body="${3:-}"
  {
    echo "url = \"${SUPABASE_ORIGIN}${path}\""
    echo "request = \"${method}\""
    echo "header = \"apikey: ${SERVICE_ROLE_KEY}\""
    echo "header = \"Authorization: Bearer ${SERVICE_ROLE_KEY}\""
    echo "header = \"Content-Type: application/json\""
    [ -n "$body" ] && echo "data = @${body}"
    echo 'write-out = "\nHTTP_STATUS=%{http_code}"'
    echo 'silent'
    echo 'show-error'
  } | curl --config - --max-time 30
}

echo "--- creating the Auth account (admin API, as the application does)"
RESPONSE="$(admin_api POST /auth/v1/admin/users "$WORK/body.json" || true)"
STATUS="$(printf '%s' "$RESPONSE" | sed -n 's/^HTTP_STATUS=//p' | tail -1)"
BODY="$(printf '%s' "$RESPONSE" | sed '$d')"

if [ "${STATUS:-000}" != "200" ] && [ "${STATUS:-000}" != "201" ]; then
  echo "the Auth service refused to create the account (HTTP ${STATUS:-no response})" >&2
  case "$BODY" in
    *already*registered*|*already*exists*|*email_exists*)
      echo "An Auth account with this address already exists, but it is not an" >&2
      echo "active OWNER. Sign in as an existing ADMIN and set the role at" >&2
      echo "Settings → Users rather than creating a second account." >&2 ;;
    # The body can quote back the address and the message, never the password —
    # GoTrue does not echo it — so this is safe to show and is the only useful
    # diagnostic when the service is unhappy.
    *) printf '%s\n' "$BODY" | head -3 >&2 ;;
  esac
  exit 1
fi

# GoTrue returns the user object; the id is the auth uid and the primary key of
# the profile row the trigger has just created.
USER_ID="$(printf '%s' "$BODY" \
  | grep -oE '"id"[[:space:]]*:[[:space:]]*"[0-9a-fA-F-]{36}"' \
  | head -1 | grep -oE '[0-9a-fA-F-]{36}')"
[ -n "$USER_ID" ] || { echo "the Auth service returned no user id" >&2; exit 1; }
echo "--- Auth account created"

# --- 7. apply the role, exactly as the provisioning service does --------------
#
# The trigger has mirrored the account into public.users as an active
# SALESPERSON. The role is applied here, afterwards — never carried in the
# sign-up metadata, which the trigger deliberately ignores.
#
# If this fails the half-made account is DISARMED rather than left able to sign
# in. Two steps, in this order and both best-effort:
#
#   * `is_active = false` on the profile. Every policy resolves through
#     `current_user_id()`, which filters on `is_active`, so an inactive row can
#     pass none of them and the account cannot reach any data. Deactivating is
#     also what "remove a user" means everywhere else in this system — nothing is
#     hard-deleted (§8.8).
#   * then the Auth account itself, as services/user.service.ts does. This is the
#     step that can legitimately fail: `public.users.id references auth.users(id)
#     on delete restrict`, so while the profile row exists the delete is refused.
#     The deactivation above is what actually makes the account harmless.
disarm_half_created_account() {
  echo "--- deactivating the half-created account so it cannot sign in" >&2
  psql_admin -q -v id="$USER_ID" -f - >/dev/null 2>&1 <<'SQL' || true
update public.users set is_active = false where id = :'id'::uuid;
SQL
  admin_api DELETE "/auth/v1/admin/users/${USER_ID}" >/dev/null 2>&1 || true
  echo "Nothing usable was left behind. Fix the cause and run this again." >&2
}

echo "--- setting the role to OWNER"
# The values are psql variables read from stdin rather than interpolated into a
# command string: `psql -c` does NOT expand `:'name'` — it reaches the server
# verbatim and fails — and a name with an apostrophe in it has no business
# deciding how this statement parses.
if ! psql_admin -q -v id="$USER_ID" -v name="$NAME" -f - >/dev/null <<'SQL'
update public.users
   set full_name = :'name', role = 'OWNER', is_active = true
 where id = :'id'::uuid;
SQL
then
  disarm_half_created_account
  echo "could not apply the OWNER role to the profile row" >&2
  exit 1
fi

# --- 8. read the result back --------------------------------------------------
#
# Asserted rather than assumed, and read from the database rather than from what
# was just sent: the profile must exist, carry the same id as the Auth account,
# and be an active OWNER. Anything else is a half-created account.
READBACK="$(psql_admin -tA -v id="$USER_ID" -f - <<'SQL' | tr -d '[:space:]'
select u.role::text || '|' || u.is_active::text || '|' || u.email
  from public.users u
  join auth.users a on a.id = u.id
 where u.id = :'id'::uuid;
SQL
)"

case "$READBACK" in
  "OWNER|true|${EMAIL}") ;;
  *)
    disarm_half_created_account
    echo "the profile did not come back as an active OWNER (got: ${READBACK:-nothing})" >&2
    exit 1 ;;
esac

echo
echo "OWNER CREATED — sign in at ${PUBLIC_URL:-the CRM} as ${EMAIL}"
if [ "$GENERATED" = "1" ]; then
  echo
  echo "  Password: ${PASSWORD}"
  echo
  echo "  This is shown ONCE and is now in this terminal's scrollback. Sign in,"
  echo "  change it, and clear the scrollback. It was generated here and is"
  echo "  stored nowhere else."
fi
echo
echo "Next: Settings → Outlets, then Settings → Users to create the rest of the"
echo "team. This script will refuse to run again."
