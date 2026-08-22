#!/usr/bin/env bash
# Apply the application migrations on the office server (ADR-033).
#
#   deploy/migrate.sh            apply anything not yet applied
#   deploy/migrate.sh --status   list what is applied and what is pending
#
# It talks to the `db` container with psql and needs no Node, no npm and no
# Supabase CLI on the server.
#
# THE LEDGER IS THE SAME ONE THE SUPABASE CLI USES —
# supabase_migrations.schema_migrations, keyed by the leading digits of the
# filename. A migration applied here is therefore seen as applied by
# `supabase migration up` and vice versa, so development and the office server
# can never disagree about what has run.
#
# Each file runs inside ONE transaction together with its ledger row, so a
# migration that fails halfway leaves nothing behind and is retried whole.
# Migrations are never edited once applied; a change is a new file (§21.2).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/env/production.env"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
cd "$ROOT"

DC=(docker compose --env-file "$ENV_FILE")
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# THE MIGRATIONS RUN AS supabase_admin, NOT postgres.
#
# They create extensions, alter platform-adjacent objects and grant to the API
# roles — superuser work. In this image `postgres` is an ordinary role and
# `supabase_admin` is the bootstrap superuser, so `psql -U postgres` could not
# apply them: the office server came up with a healthy database, healthy Auth and
# Storage, an empty supabase_migrations ledger and not one CRM table.
#
# Same resolution as the restore and the credential alignment, from one file, so a
# fix to it cannot reach one caller and miss the others.
. "$ROOT/deploy/lib/db-admin.sh"

# Wait for the database to answer. On a cold boot after a power cut, PostgreSQL
# replays its WAL before it accepts connections and that is not instant.
for _ in $(seq 1 60); do
  "${DC[@]}" exec -T db pg_isready -q >/dev/null 2>&1 && break
  sleep 2
done
"${DC[@]}" exec -T db pg_isready -q >/dev/null 2>&1 \
  || { echo "database is not answering" >&2; exit 1; }

require_admin_path || exit 1
psql_run() { psql_admin "$@"; }

# Applying these needs superuser: they create extensions, install functions the
# API roles execute, and grant across platform schemas. Say so here, by name,
# rather than failing part way through migration 001 with a permission error and
# leaving the ledger half written.
IS_SUPER="$(psql_run -tAq -c "select rolsuper from pg_roles where rolname = current_user;" | tr -d '[:space:]')"
[ "$IS_SUPER" = "t" ] || {
  echo "the migrations must be applied by a SUPERUSER; '$ADMIN_ROLE' is not one" >&2
  echo "In this image the platform superuser is supabase_admin and 'postgres' is an" >&2
  echo "ordinary role. Nothing has been applied and the ledger is unchanged." >&2
  exit 1
}

psql_run -q -c "create schema if not exists supabase_migrations;" \
             -c "create table if not exists supabase_migrations.schema_migrations (
                   version text primary key, statements text[], name text);"

applied() { psql_run -tAq -c "select version from supabase_migrations.schema_migrations order by version;"; }

if [ "${1:-}" = "--status" ]; then
  echo "applied:"; applied | sed 's/^/  /'
  echo "on disk:"; ls -1 "$ROOT"/supabase/migrations/*.sql | xargs -n1 basename | sed 's/^/  /'
  exit 0
fi

APPLIED="$(applied)"
COUNT=0
for file in "$ROOT"/supabase/migrations/*.sql; do
  base="$(basename "$file")"
  version="${base%%_*}"
  name="${base#*_}"; name="${name%.sql}"

  # Matched against the ledger without a pipeline. `printf | grep -q` exits early
  # on a match, printf then takes SIGPIPE, and with `pipefail` the pipeline reports
  # failure although the version WAS found — which would re-apply a migration that
  # had already run.
  case "
$APPLIED
" in
    *"
$version
"*) continue ;;
  esac

  echo "--- applying ${base}"
  # The file and its ledger row commit together or not at all.
  { echo 'begin;'
    cat "$file"
    printf "insert into supabase_migrations.schema_migrations (version, name) values (%s, %s);\n" \
      "$(printf "'%s'" "$version")" "$(printf "'%s'" "$name")"
    echo 'commit;'
  } > "$WORK/apply.sql"

  # Copied in and read from a file rather than piped through the exec stream. A
  # stream cut short can end after a complete statement, leaving psql to exit 0
  # with the transaction never committed — the script would report the migration
  # applied and the ledger would disagree.
  INSIDE="$(file_in "$WORK/apply.sql")"
  psql_run -q -f "$INSIDE"
  file_in_cleanup

  # Prove it landed. The ledger row is inside the same transaction as the
  # migration, so its presence is proof that both committed.
  LANDED="$(psql_run -tAq -c \
    "select 1 from supabase_migrations.schema_migrations where version = '${version}';" \
    | tr -d '[:space:]')"
  [ "$LANDED" = "1" ] || {
    echo "migration ${base} did not commit — the ledger has no row for ${version}" >&2
    exit 1
  }
  COUNT=$((COUNT + 1))
done

if [ "$COUNT" = "0" ]; then
  echo "--- migrations already up to date"
else
  echo "--- applied ${COUNT} migration(s)"
fi
