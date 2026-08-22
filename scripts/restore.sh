#!/usr/bin/env bash
#
# Restore from an independent backup (§18).
#
# This is the half of the backup story that is usually skipped, and skipping it
# is how businesses discover at the worst possible moment that their backups
# were never readable. §18 makes an actual restore mandatory, and this is the
# script that performs it.
#
# It refuses to write to production. Not as a warning — as an exit code. A
# restore is a destructive overwrite of whatever is already in the target, and
# the target is supplied on a command line, usually by someone having a bad day.
#
#   BACKUP_PASSPHRASE    required  the key the archive was written with
#   RESTORE_DATABASE_URL required  target — must NOT be the production database
#   ALLOW_PRODUCTION_RESTORE=I-UNDERSTAND   the only way past the guard
#
# Usage:
#   scripts/restore.sh s3://bucket/prefix/jsk-crm-....dump.enc
#   scripts/restore.sh /path/to/jsk-crm-....dump.enc
set -euo pipefail

SOURCE="${1:?usage: scripts/restore.sh <s3://... | /path/to/file.dump.enc>}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"

# The guard. Anything that looks like the production project is refused unless
# the operator says so in words that cannot be typed by accident.
if [ "${ALLOW_PRODUCTION_RESTORE:-}" != "I-UNDERSTAND" ]; then
  case "$RESTORE_DATABASE_URL" in
    *prod*|*production*)
      echo "RESTORE_DATABASE_URL looks like production. Refusing." >&2
      echo "Set ALLOW_PRODUCTION_RESTORE=I-UNDERSTAND only during a real recovery." >&2
      exit 2 ;;
  esac
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ENC="$WORK/archive.dump.enc"
DUMP="$WORK/archive.dump"

echo "--- fetching $SOURCE"
case "$SOURCE" in
  s3://*)
    : "${AWS_REGION:=ap-south-1}"
    aws s3 cp "$SOURCE" "$ENC" --region "$AWS_REGION" --only-show-errors
    if aws s3 cp "$SOURCE.sha256" "$ENC.sha256" --region "$AWS_REGION" --only-show-errors 2>/dev/null; then
      echo "$(cat "$ENC.sha256")  $ENC" | sha256sum -c - >/dev/null \
        && echo "--- checksum verified" \
        || { echo "Checksum mismatch — the archive is damaged." >&2; exit 1; }
    fi ;;
  *)
    cp "$SOURCE" "$ENC"
    [ -f "$SOURCE.sha256" ] && { echo "$(cat "$SOURCE.sha256")  $ENC" | sha256sum -c - >/dev/null \
      && echo "--- checksum verified"; } ;;
esac

echo "--- decrypting"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in "$ENC" -out "$DUMP" -pass env:BACKUP_PASSPHRASE \
  || { echo "Decryption failed — wrong passphrase, or a corrupt archive." >&2; exit 1; }

# Prepare the target before restoring.
#
# Supabase installs pg_trgm and pgcrypto into an `extensions` schema, and the
# schema-filtered dump above carries the *uses* of those extensions without the
# CREATE EXTENSION statements that define them — pg_dump only emits those for a
# whole-database dump. Restoring into a target that lacks them silently drops the
# three trigram indexes and leaves `search_crm` and `find_account_duplicates`
# raising `schema "extensions" does not exist` on every call.
#
# A real Supabase project already has all of this, so these statements are no-ops
# there. On a bare PostgreSQL server they are what makes the archive restorable
# without Supabase at all, which is the entire point of holding it (§17).
echo "--- preparing target (platform roles, schemas, extensions)"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$(dirname "$0")/restore-prepare.sql"

echo "--- restoring into the target"
# --clean --if-exists so a re-run is repeatable rather than a pile of conflicts.
#
# Exit status is inspected rather than trusted to `set -e`. pg_restore's default
# is to continue past an error and exit non-zero at the end, and a healthy
# restore routinely trips that: it will not recreate a cluster-wide role, and it
# reports an extension that is already installed. Those are noise. What is NOT
# noise is a failure to create a table, which is why verify-restore.sql below is
# the actual pass/fail — the diagnostics here are for a human reading the log.
set +e
pg_restore --dbname "$RESTORE_DATABASE_URL" \
  --clean --if-exists --no-owner --no-privileges \
  "$DUMP" 2> "$WORK/restore.log"
STATUS=$?
set -e
DIAGS=$(grep -c 'pg_restore: error' "$WORK/restore.log" || true)
echo "--- pg_restore exit=$STATUS, ${DIAGS} diagnostic line(s)"
if [ "$DIAGS" -gt 0 ]; then grep 'pg_restore: error' "$WORK/restore.log" | head -20; fi

echo "--- verifying the restored database"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/verify-restore.sql"
