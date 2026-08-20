#!/usr/bin/env bash
# Is the CRM actually working? (§11)
#
#   deploy/health.sh          human-readable summary, exit 0 when healthy
#   deploy/health.sh --quiet  exit code only, for cron and systemd
#
# Checks the four things that make the difference between "containers are
# running" and "a salesperson can use it": the app answers, the database answers
# through PostgREST, there is disk space left, and a backup ran recently.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/env/production.env"
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }

APP_PORT="${APP_PORT:-3000}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/jsk-crm}"
DISK_WARN_PCT="${DISK_WARN_PCT:-85}"
QUIET=0; [ "${1:-}" = "--quiet" ] && QUIET=1
FAILED=0

say() { [ "$QUIET" = "1" ] || printf '%s\n' "$*"; }
ok()   { say "  ok    $*"; }
warn() { say "  WARN  $*"; }
bad()  { say "  FAIL  $*"; FAILED=1; }

say "JSK CRM health — $(date '+%Y-%m-%d %H:%M:%S %Z')"

# 1. The application, which in turn probes PostgREST and PostgreSQL.
body=$(curl -fsS --max-time 10 "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null) \
  && case "$body" in
       *'"status":"ok"'*) ok "application and database" ;;
       *) bad "application answered but reports a problem: $body" ;;
     esac \
  || bad "application is not answering on port ${APP_PORT}"

# 2. Containers that keep restarting look "up" to Docker but serve nothing.
if command -v docker >/dev/null 2>&1; then
  restarting=$(docker compose --env-file "$ENV_FILE" ps --format '{{.Name}} {{.State}}' 2>/dev/null \
               | awk '$2 == "restarting" { print $1 }' || true)
  [ -z "$restarting" ] && ok "no container is restart-looping" \
                       || bad "restarting: $restarting"
fi

# 3. Disk. A full disk stops PostgreSQL writing and the failure looks unrelated.
used=$(df --output=pcent "$ROOT" 2>/dev/null | tail -1 | tr -dc '0-9')
if [ -n "$used" ]; then
  [ "$used" -lt "$DISK_WARN_PCT" ] && ok "disk ${used}% used" \
                                   || warn "disk ${used}% used — free space or backups will start failing"
fi

# 4. A backup that silently stopped running is only discovered when it is needed.
if [ -d "$BACKUP_DIR" ]; then
  newest=$(find "$BACKUP_DIR" -name '*.dump.enc' -mtime -2 2>/dev/null | head -1)
  [ -n "$newest" ] && ok "a backup was written in the last 48 hours" \
                   || warn "no backup in the last 48 hours — check the timer: systemctl status jsk-crm-backup.timer"
else
  warn "no backup directory at $BACKUP_DIR yet"
fi

say ""
[ "$FAILED" = "0" ] && { say "HEALTHY"; exit 0; } || { say "UNHEALTHY"; exit 1; }
