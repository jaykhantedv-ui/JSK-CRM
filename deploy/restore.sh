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
# Administering the target — creating the scratch database, creating the platform
# roles the archive's policies name — is superuser work, and `postgres` is not one
# in this image. Same resolution as deploy/db-credentials.sh, from one place.
. "$ROOT/deploy/lib/db-admin.sh"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# Resolve the administrative path before anything needs it, so a server this
# cannot administer says so now rather than half way through a restore.
require_admin_path || exit 1

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
  psql_admin -c "create database ${TARGET};" >/dev/null
fi

# Whatever happens from here, put the server back the way it was found.
finish() {
  local code=$?
  if [ "$MODE" = "--scratch" ]; then
    psql_admin -c "drop database if exists ${TARGET};" >/dev/null 2>&1 || true
  else
    "${DC[@]}" start app >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
  exit "$code"
}
trap finish EXIT

# Prepare the target — the SAME file scripts/restore.sh uses, piped in.
#
# This used to be three CREATE statements written out here, and they covered only
# the extensions. The archive is missing three classes of object, not one: the
# extensions, the `auth` and `storage` schemas, and every platform role the RLS
# policies name. Having two copies of that list meant fixing one of them, and the
# production path — which is this one, reached by `deploy/backup.sh --verify` —
# kept the old one and kept failing with `schema "storage" does not exist`.
#
# There is now one list, in one file, tested by scripts/test-restore-drill.sh. It
# is piped rather than mounted so nothing has to change in docker-compose.yml.
echo "--- preparing ${TARGET} (platform roles, schemas, extensions)"
psql_admin_db "$TARGET" -q -f - < "$ROOT/scripts/restore-prepare.sql"

echo "--- pg_restore into ${TARGET}"
# A properly prepared target produces NO diagnostics, so any are a failure rather
# than noise to read past. Nothing is suppressed: pg_restore runs with every error
# reported, and this stops if it reported one.
set +e
pg_restore_admin "$TARGET" \
  --no-owner --no-privileges --clean --if-exists < "$WORK/restore.dump" 2> "$WORK/restore.log"
STATUS=$?
set -e
ERRORS=$(grep -c 'pg_restore: error' "$WORK/restore.log" || true)
echo "--- pg_restore exit=${STATUS}, ${ERRORS} error line(s)"
if [ "$ERRORS" -gt 0 ] || [ "$STATUS" -ne 0 ]; then
  grep 'pg_restore: error' "$WORK/restore.log" | head -10
  echo "the restore reported errors — this backup is NOT verified" >&2
  exit 1
fi

echo "--- verifying the restored data"
psql_admin_db "$TARGET" < "$ROOT/scripts/verify-restore.sql"

# The scratch database is dropped, and the application restarted, by `finish`
# above — on the way out of a failure as well as a success.
if [ "$MODE" = "--scratch" ]; then
  echo
  echo "RESTORE VERIFIED — this backup is readable and complete."
else
  echo
  echo "RESTORE COMPLETE."
fi
