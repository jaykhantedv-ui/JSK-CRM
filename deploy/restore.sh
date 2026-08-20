#!/usr/bin/env bash
# Restore the CRM from an encrypted backup (§10).
#
#   deploy/restore.sh --scratch  <file.dump.enc>   restore into a throwaway
#                                                  database and verify it
#   deploy/restore.sh --live     <file.dump.enc>   REPLACE the live database
#
# --scratch is the one to run regularly. It restores into a separate database on
# the same server, runs the verification queries, then drops it — proving the
# backup is readable WITHOUT touching anything anyone is using. A backup that has
# never been restored is a guess, and this is the whole point of §10.
#
# --live is for the day the server is rebuilt or the data is lost. It overwrites
# the live database and asks for confirmation in words that cannot be typed by
# accident.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/env/production.env"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

MODE="${1:-}"
ARCHIVE="${2:-}"
case "$MODE" in
  --scratch|--live) ;;
  *) echo "usage: deploy/restore.sh --scratch|--live <file.dump.enc>" >&2; exit 2 ;;
esac
[ -f "$ARCHIVE" ] || { echo "no such backup: $ARCHIVE" >&2; exit 1; }
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"

DC=(docker compose --env-file "$ENV_FILE")
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# Check the sidecar first when it is there: a truncated copy off a failing drive
# decrypts to nothing useful, and finding that out after dropping the target is
# too late.
if [ -f "${ARCHIVE}.sha256" ]; then
  echo "--- checking sha256"
  actual=$(sha256sum "$ARCHIVE" | awk '{print $1}')
  expected=$(cat "${ARCHIVE}.sha256")
  [ "$actual" = "$expected" ] || { echo "checksum mismatch — this file is damaged" >&2; exit 1; }
  echo "--- checksum ok"
fi

echo "--- decrypting"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in "$ARCHIVE" -out "$WORK/restore.dump" -pass env:BACKUP_PASSPHRASE \
  || { echo "could not decrypt — wrong BACKUP_PASSPHRASE?" >&2; exit 1; }

if [ "$MODE" = "--live" ]; then
  cat >&2 <<'EOF'

  This REPLACES the live CRM database with the contents of the backup.
  Everything entered since that backup was taken will be gone.

EOF
  read -r -p 'Type RESTORE-LIVE to continue: ' confirm
  [ "$confirm" = "RESTORE-LIVE" ] || { echo "cancelled"; exit 1; }
  TARGET=postgres
  echo "--- stopping the application so nothing writes mid-restore"
  "${DC[@]}" stop app >/dev/null
else
  TARGET="jsk_restore_check_$(date +%s)"
  echo "--- creating scratch database ${TARGET}"
  "${DC[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "create database ${TARGET};" >/dev/null
fi

# Prepare the target before restoring.
#
# The dump is schema-filtered (public, auth, storage), so it carries the *uses*
# of pg_trgm and pgcrypto without the CREATE EXTENSION statements that define
# them — pg_dump only emits those for a whole-database dump. Restoring into a
# target that lacks them silently drops the three trigram indexes and leaves
# search raising `schema "extensions" does not exist` on every call. Verified:
# skip this and scripts/verify-restore.sql fails on the missing indexes, which is
# exactly what it is there to catch.
echo "--- preparing ${TARGET} (extensions)"
"${DC[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d "$TARGET" -q \
  -c 'create schema if not exists extensions;' \
  -c 'create extension if not exists pg_trgm with schema extensions;' \
  -c 'create extension if not exists pgcrypto with schema extensions;'

echo "--- pg_restore into ${TARGET}"
# pg_restore exits non-zero for harmless diagnostics (an owner that does not
# exist, an extension already present), so the exit code is inspected rather
# than trusted — the verification below is what actually decides.
set +e
"${DC[@]}" exec -T db pg_restore -U postgres --dbname "$TARGET" \
  --no-owner --no-privileges --clean --if-exists < "$WORK/restore.dump" 2> "$WORK/restore.log"
STATUS=$?
set -e
ERRORS=$(grep -c 'pg_restore: error' "$WORK/restore.log" || true)
echo "--- pg_restore exit=${STATUS}, ${ERRORS} error line(s)"
[ "$ERRORS" -gt 0 ] && grep 'pg_restore: error' "$WORK/restore.log" | head -10

echo "--- verifying the restored data"
"${DC[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d "$TARGET" \
  < "$ROOT/scripts/verify-restore.sql"

if [ "$MODE" = "--scratch" ]; then
  echo "--- dropping scratch database"
  "${DC[@]}" exec -T db psql -U postgres -d postgres -c "drop database ${TARGET};" >/dev/null
  echo
  echo "RESTORE VERIFIED — this backup is readable and complete."
else
  echo "--- restarting the application"
  "${DC[@]}" start app >/dev/null
  echo
  echo "RESTORE COMPLETE."
fi
