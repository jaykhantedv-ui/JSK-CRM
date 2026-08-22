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

# MOVING A DUMP BETWEEN HOST AND CONTAINER — as a file, never as a stream.
#
# `docker compose exec` multiplexes stdout, and a custom-format dump is large and
# binary. On the office server a ~220 KB dump arrived as 95,811 bytes: a custom
# archive keeps its table of contents at the END, so what survived could not be
# read at all — `pg_restore -l` failed and every business table looked absent. The
# dump itself was fine; the pipe was not.
#
# `docker compose cp` copies a file. There is no framing to lose bytes to, and
# pg_dump's own exit status is observed directly instead of a pipeline's.
#
# WHY THE DUMP RUNS AS supabase_admin. pg_dump issues `SET row_security = off`,
# which fails for any role that neither owns the table nor holds BYPASSRLS.
# `postgres` is neither a superuser nor BYPASSRLS in this image, and every CRM
# table has RLS — so once those tables are owned by anything else it can read none
# of them. A superuser reads the whole database by definition, which is what a
# disaster-recovery backup is for. No policy is changed, nothing is disabled, and
# no application role gains a privilege: the services still connect as
# authenticator, supabase_auth_admin and supabase_storage_admin.
CONTAINER_TMP="/tmp/jsk-transfer-$$"

# dump_out <database> <host-destination> [pg_dump args...]
dump_out() {
  local db="$1" dest="$2"; shift 2
  local inside="${CONTAINER_TMP}.dump"
  "${DC[@]}" exec -T db rm -f "$inside" >/dev/null 2>&1 || true
  "${DC[@]}" exec -T db pg_dump ${ADMIN_ARGS[@]+"${ADMIN_ARGS[@]}"} \
    -U "$ADMIN_ROLE" -d "$db" --file="$inside" "$@"
  "${DC[@]}" cp "db:$inside" "$dest"
  "${DC[@]}" exec -T db rm -f "$inside" >/dev/null 2>&1 || true
}

# file_in <host-source> — copies a file into the container, echoes its path there.
file_in() {
  local src="$1" inside="${CONTAINER_TMP}.restore"
  "${DC[@]}" cp "$src" "db:$inside" >/dev/null
  printf '%s' "$inside"
}
file_in_cleanup() {
  "${DC[@]}" exec -T db rm -f "${CONTAINER_TMP}.restore" >/dev/null 2>&1 || true
}

# INSPECTING A BACKUP ARCHIVE WITHOUT CLIENT TOOLS ON THE HOST.
#
# Reading a custom-format archive needs `pg_restore`, and the office server has no
# PostgreSQL client tools installed — nor should it need them, when a container
# with the exact matching version is already running. Calling pg_restore on the
# host exits 127, `command not found`, immediately after the dump: a good archive
# refused because the validator could not open it.
#
# The archive goes in as a FILE and the table of contents comes back as a FILE.
# Nothing binary and nothing large crosses the exec stream in either direction —
# that stream is what truncated a dump once already. Only `sh -c` and its exit
# status do.
#
# scripts/lib/backup-archive.sh owns the three-way diagnosis and the fourteen-table
# check; this provides only the transport, so both backup entry points share one
# validator.
ARCHIVE_INSPECT=container

# require_container_commands <command>...
# Everything the deploy path runs inside the db container. Named individually, so
# an image without one of them says which rather than failing as 127 somewhere.
require_container_commands() {
  local missing="" c
  for c in "$@"; do
    "${DC[@]}" exec -T db sh -c 'command -v "$1" >/dev/null 2>&1' _ "$c" >/dev/null 2>&1 \
      || missing="$missing $c"
  done
  if [ -n "$missing" ]; then
    echo "missing INSIDE the db container:${missing}" >&2
    echo "Check the db image tag in docker-compose.yml — supabase/postgres ships all" >&2
    echo "of these. The host is not expected to have any of them." >&2
    return 1
  fi
}

# archive_inspect_container <archive> <toc-out> <err-out>
#   0 readable and decodes · 1 unreadable · 2 lists but will not decode
#   3 cannot inspect at all
archive_inspect_container() {
  local archive="$1" toc_out="$2" err_out="$3"
  local inside="${CONTAINER_TMP}.archive"
  local toc="${inside}.toc" err="${inside}.err"
  local rc=0

  : > "$toc_out"; : > "$err_out"

  if ! "${DC[@]}" cp "$archive" "db:$inside" >/dev/null 2>&1; then
    echo "could not copy the archive into the db container" > "$err_out"
    return 3
  fi

  if "${DC[@]}" exec -T db sh -c 'pg_restore -l "$1" > "$2" 2> "$3"' _ "$inside" "$toc" "$err"; then
    "${DC[@]}" cp "db:$toc" "$toc_out" >/dev/null 2>&1 || rc=1
    if [ "$rc" = 0 ]; then
      "${DC[@]}" exec -T db sh -c 'pg_restore -f /dev/null "$1" 2> "$2"' _ "$inside" "$err" || rc=2
    fi
  else
    rc=1
  fi

  [ "$rc" = 0 ] || "${DC[@]}" cp "db:$err" "$err_out" >/dev/null 2>&1 || true

  # Whatever happened, leave nothing behind in the container.
  "${DC[@]}" exec -T db rm -f "$inside" "$toc" "$err" >/dev/null 2>&1 || true
  return "$rc"
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
