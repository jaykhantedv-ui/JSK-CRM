#!/usr/bin/env bash
# Stop the JSK CRM stack.
#
#   deploy/stop.sh           stop the containers, KEEP the data
#   deploy/stop.sh --wipe    stop and DELETE the database and uploaded files
#
# The plain form is what you want. Containers stop, the named volumes stay, and
# deploy/start.sh brings everything back exactly as it was.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/env/production.env"
cd "$ROOT"

if [ "${1:-}" = "--wipe" ]; then
  cat >&2 <<'EOF'
This DELETES the database and every uploaded file. There is no undo.
Restore afterwards needs a backup — check you have one that restores (deploy/restore.sh --verify).

EOF
  read -r -p 'Type ERASE to continue: ' confirm
  [ "$confirm" = "ERASE" ] || { echo "cancelled"; exit 1; }
  docker compose --env-file "$ENV_FILE" --profile tunnel down --volumes
  echo "stopped; volumes removed"
else
  docker compose --env-file "$ENV_FILE" --profile tunnel down
  echo "stopped; data volumes kept"
fi
