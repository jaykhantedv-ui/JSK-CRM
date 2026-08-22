# Reaching the database as the Supabase platform superuser. Sourced, not run.
#
# Two scripts need this — deploy/db-credentials.sh and deploy/restore.sh — and both
# need it for the same reason: creating or altering platform roles is superuser
# work. It lives here so there is one answer to "how do we administer this
# database", and so a fix to it cannot reach one caller and miss the other.
#
# WHY `postgres` IS NOT THE ANSWER. In the Supabase image `postgres` is an ordinary
# role — rolsuper is false — and the bootstrap superuser is `supabase_admin`. The
# service roles are additionally reserved, so altering them as `postgres` fails with
# `"authenticator" is a reserved role, only superusers can modify it`.
#
# WHY THE SOCKET IS NOT THE ANSWER EITHER. `psql -U supabase_admin` with no host
# uses the UNIX SOCKET, and the image authenticates local connections by `peer` —
# the operating-system user must have the same name as the role. `docker compose
# exec` runs as the container's `postgres` user, so `-U postgres` matches and
# succeeds while `-U supabase_admin` is refused. The role is fine; the path is
# wrong.
#
# The image provides the path itself: `host all all 127.0.0.1/32 trust`, inside the
# container. That is the platform's convention for post-startup administration, and
# why supabase_admin ships with no password — there is no credential to invent,
# expose or store. Both paths are tried, socket first, so a different image tag that
# authenticates local connections differently still works.
#
# THIS IS AN ADMINISTRATIVE PATH ONLY. Loopback trust is never used as evidence that
# a password works: the credential test in deploy/db-credentials.sh runs from a
# separate container over the compose network and fails closed on a loopback address.
#
# Requires the caller to have defined DC=(docker compose --env-file "$ENV_FILE").

ADMIN_ROLE="${DB_ADMIN_ROLE:-supabase_admin}"
ADMIN_ARGS=()
ADMIN_PATH=""
LOOPBACK_ARGS=(-h 127.0.0.1 -p 5432)

try_conn() { # try_conn <role> [psql args...]
  local role="$1"; shift
  "${DC[@]}" exec -T db psql -tAq -U "$role" -d postgres "$@" -c 'select 1' 2>/dev/null \
    | tr -d '[:space:]' | grep -qx 1
}

resolve_admin_path() {
  if try_conn "$ADMIN_ROLE"; then
    ADMIN_ARGS=(); ADMIN_PATH="unix socket"; return 0
  fi
  if try_conn "$ADMIN_ROLE" "${LOOPBACK_ARGS[@]}"; then
    ADMIN_ARGS=("${LOOPBACK_ARGS[@]}"); ADMIN_PATH="loopback inside the db container"; return 0
  fi
  return 1
}

# psql as the platform superuser, against `postgres` unless -d says otherwise.
psql_admin() {
  "${DC[@]}" exec -T db psql -v ON_ERROR_STOP=1 \
    ${ADMIN_ARGS[@]+"${ADMIN_ARGS[@]}"} -U "$ADMIN_ROLE" -d postgres "$@"
}

# The same, against a named database — the restore drill works on a scratch one.
psql_admin_db() { # psql_admin_db <database> [psql args...]
  local db="$1"; shift
  "${DC[@]}" exec -T db psql -v ON_ERROR_STOP=1 \
    ${ADMIN_ARGS[@]+"${ADMIN_ARGS[@]}"} -U "$ADMIN_ROLE" -d "$db" "$@"
}

# pg_restore over the same administrative path. The scratch database is owned by
# the admin role, so restoring as anything else would lack CREATE on it.
pg_restore_admin() { # pg_restore_admin <database> [pg_restore args...]
  local db="$1"; shift
  "${DC[@]}" exec -T db pg_restore \
    ${ADMIN_ARGS[@]+"${ADMIN_ARGS[@]}"} -U "$ADMIN_ROLE" --dbname "$db" "$@"
}

# A neutral probe for questions asked BEFORE the admin path is known. `pg_roles` is
# world-readable, so any role that can connect can answer them; the same two paths
# are tried so a peer-authenticated socket is not assumed either.
psql_probe() {
  "${DC[@]}" exec -T db psql -tAq -U postgres -d postgres "$@" 2>/dev/null \
    || "${DC[@]}" exec -T db psql -tAq "${LOOPBACK_ARGS[@]}" -U postgres -d postgres "$@" 2>/dev/null
}

# Resolve, or explain why not and stop. Callers that administer anything must call
# this before their first psql_admin.
require_admin_path() {
  if resolve_admin_path; then return 0; fi
  cat >&2 <<HINT
cannot reach the database as '$ADMIN_ROLE'

Tried, inside the db container:
  * the unix socket        — refused if pg_hba authenticates local connections by
                             \`peer\`, because docker exec runs as the OS user
                             'postgres', which does not match this role
  * 127.0.0.1:5432         — the image's own administrative rule

No password is expected for either: '$ADMIN_ROLE' is the platform superuser and is
reached over a local path, never over the network. If both were refused, inspect
pg_hba.conf inside the container. Do not add a trust rule and do not substitute
'postgres' — it is not a superuser here and may not create or alter platform roles.
HINT
  return 1
}
