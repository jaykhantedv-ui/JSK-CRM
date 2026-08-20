#!/usr/bin/env bash
# Start the JSK CRM stack on the office server (ADR-033).
#
#   deploy/start.sh              start everything on the LAN
#   deploy/start.sh --tunnel     also start the Cloudflare tunnel
#   deploy/start.sh --build      rebuild the application image first
#
# Safe to run repeatedly: Compose brings up only what is not already running.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/env/production.env"
cd "$ROOT"

if [ ! -f "$ENV_FILE" ]; then
  cat >&2 <<EOF
No deploy/env/production.env.

  cp deploy/env/production.env.example deploy/env/production.env
  deploy/keygen.sh >> deploy/env/production.env
  \$EDITOR deploy/env/production.env      # set PUBLIC_URL and PUBLIC_SUPABASE_URL

EOF
  exit 1
fi

PROFILES=()
BUILD=()
for arg in "$@"; do
  case "$arg" in
    --tunnel) PROFILES+=(--profile tunnel) ;;
    --build)  BUILD+=(--build) ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

COMPOSE=(docker compose --env-file "$ENV_FILE" "${PROFILES[@]}")

echo "--- starting database, auth and storage"
# The application migrations reference auth.users and storage.buckets, so GoTrue
# and Storage must have run their own migrations BEFORE ours are applied. Waiting
# on their health checks is what guarantees that ordering; starting everything at
# once would race and fail on a first boot roughly half the time.
"${COMPOSE[@]}" up -d --wait db auth storage rest

echo "--- applying migrations"
"$ROOT/deploy/migrate.sh"

echo "--- starting the gateway and the application"
"${COMPOSE[@]}" up -d "${BUILD[@]}" gateway app
if [ ${#PROFILES[@]} -gt 0 ]; then
  "${COMPOSE[@]}" up -d tunnel
fi

echo
"${COMPOSE[@]}" ps
echo
echo "--- health"
"$ROOT/deploy/health.sh" || true
