#!/usr/bin/env bash
# Load the DEMO / TRAINING dataset (§6, §7, §17).
#
#   scripts/demo.sh            rebuild the database and load demo data
#   scripts/demo.sh --keep-db  load demo data onto the current database
#
# The default path RESETS THE DATABASE FIRST. That is deliberate: re-seeding is a
# rebuild rather than a mutation, so the demo data never needs delete statements
# and the no-hard-delete rule stays intact (CLAUDE.md §11).
#
# The demo password comes from DEMO_PASSWORD, never from source (§7). It applies
# only to @demo.jsk.local logins, which exist only in a demo database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_PASSWORD="${DEMO_PASSWORD:-demo1234}"

# Refuse to touch anything that looks like production. The demo dataset invents
# customers and users; loading it over real data would be unrecoverable.
if [ "${NODE_ENV:-}" = "production" ] && [ "${DEMO_FORCE:-0}" != "1" ]; then
  echo "refusing to load demo data with NODE_ENV=production" >&2
  echo "this dataset is for demonstration and training only" >&2
  exit 1
fi

DB_URL="$("$ROOT/scripts/db.sh" url)"
case "$DB_URL" in
  *supabase.co*|*supabase.in*)
    echo "refusing to load demo data into a hosted Supabase project" >&2
    exit 1 ;;
esac

if [ "${1:-}" != "--keep-db" ]; then
  echo "--- rebuilding the database (drop, migrate, seed)"
  SEED=1 FIXTURES=0 "$ROOT/scripts/db.sh" reset
fi

echo "--- loading DEMO / TRAINING data"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q \
  -c "select set_config('demo.i_understand', 'yes', false), set_config('demo.password', '${DEMO_PASSWORD}', false);" \
  -f "$ROOT/supabase/seed/demo-data.sql"

cat <<EOF

  DEMO / TRAINING DATA is loaded.

  Sign in at /login with any of:

    owner@demo.jsk.local       Owner      — everything, company-wide
    admin@demo.jsk.local       Admin      — users and settings, no customer data
    manager.a@demo.jsk.local   Manager    — Showroom A only
    manager.b@demo.jsk.local   Manager    — Showroom B only
    sales01@demo.jsk.local     Salesperson — Showroom A  (a busy one)
    sales04@demo.jsk.local     Salesperson — Showroom A  (a quieter one)
    sales09@demo.jsk.local     Salesperson — Showroom B  (a busy one)
    ... through sales16@demo.jsk.local

  Password for every demo user:  ${DEMO_PASSWORD}
  Change it with:  DEMO_PASSWORD=... scripts/demo.sh

  Run the app with NEXT_PUBLIC_DEMO_MODE=1 so the DEMO banner is visible.
  Reset at any time by running this script again.

EOF
