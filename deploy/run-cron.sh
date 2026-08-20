#!/usr/bin/env bash
# Invoke one scheduled job (§8, §14.7).
#
#   deploy/run-cron.sh maintenance
#
# This is what replaces Vercel Cron on the office server. The jobs themselves are
# unchanged — they are still the same /api/cron/* routes, still authenticated by
# the same bearer token. Only the thing that calls them is different, and it is a
# systemd timer rather than a queue (§3).
#
# The request goes to 127.0.0.1, so CRON_SECRET never crosses a network.
set -euo pipefail

JOB="${1:?usage: deploy/run-cron.sh <daily-digest|manager-digest|owner-summary|new-opportunity-sla|maintenance>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/env/production.env"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

: "${CRON_SECRET:?CRON_SECRET is required}"
APP_PORT="${APP_PORT:-3000}"

# The heaviest job rewrites dormancy across every account; 300s matches the
# route's own maxDuration so the client never gives up before the server does.
BODY=$(curl -fsS --max-time 300 \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "http://127.0.0.1:${APP_PORT}/api/cron/${JOB}") || {
  echo "[cron:${JOB}] FAILED to reach the application" >&2
  exit 1
}

# One line to the journal. `journalctl -u jsk-crm-cron@maintenance` is the whole
# job-status story — no dashboard, no metrics database (§11).
echo "[cron:${JOB}] ${BODY}"
