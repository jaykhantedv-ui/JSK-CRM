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
psql_run() { "${DC[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }

# Wait for the database to answer. On a cold boot after a power cut, PostgreSQL
# replays its WAL before it accepts connections and that is not instant.
for _ in $(seq 1 60); do
  "${DC[@]}" exec -T db pg_isready -U postgres -q && break
  sleep 2
done
"${DC[@]}" exec -T db pg_isready -U postgres -q || { echo "database is not answering" >&2; exit 1; }

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

  if printf '%s\n' "$APPLIED" | grep -qx "$version"; then
    continue
  fi

  echo "--- applying ${base}"
  # The file and its ledger row commit together or not at all.
  { echo 'begin;'
    cat "$file"
    printf "insert into supabase_migrations.schema_migrations (version, name) values (%s, %s);\n" \
      "$(printf "'%s'" "$version")" "$(printf "'%s'" "$name")"
    echo 'commit;'
  } | psql_run -q -f -
  COUNT=$((COUNT + 1))
done

if [ "$COUNT" = "0" ]; then
  echo "--- migrations already up to date"
else
  echo "--- applied ${COUNT} migration(s)"
fi
