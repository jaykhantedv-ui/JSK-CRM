#!/usr/bin/env bash
# Daily encrypted backup on the office server (§10).
#
#   deploy/backup.sh              take a backup, copy it to the external drive,
#                                 prune old ones
#   deploy/backup.sh --verify     also restore it into a scratch database and
#                                 check the result — run this weekly
#
# Reuses scripts/backup.sh's format exactly (custom-format pg_dump, aes-256-cbc,
# pbkdf2, 600k iterations, sha256 sidecar) so scripts/restore.sh reads these
# files without knowing where they came from. WHAT IS DIFFERENT HERE is only
# where it runs: pg_dump executes INSIDE the db container, so the dump is taken
# by the matching PostgreSQL version and the office server needs no postgres
# client installed at all.
#
# NO CLOUD ACCOUNT IS REQUIRED. Backups are written to a local directory and
# copied to a plugged-in external drive. An off-site copy is a documented human
# step — see docs/DEPLOYMENT.md, "Backups" (§10).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/env/production.env"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required — see deploy/keygen.sh}"
if [ "${#BACKUP_PASSPHRASE}" -lt 20 ]; then
  echo "BACKUP_PASSPHRASE must be at least 20 characters." >&2; exit 2
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/jsk-crm}"
EXTERNAL_DIR="${BACKUP_EXTERNAL_DIR:-}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="jsk-crm-${STAMP}-daily"

DC=(docker compose --env-file "$ENV_FILE")
# Reading the whole database is administrative work. Same resolution the restore
# and the credential alignment use, from one place.
. "$ROOT/deploy/lib/db-admin.sh"
require_admin_path || exit 1
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$BACKUP_DIR"

echo "--- pg_dump (inside the db container, as $ADMIN_ROLE)"
# public + auth + storage is the whole business record: the CRM rows, the login
# identities that own them, and the Storage object metadata. Dumping public alone
# restores a database nobody can sign in to.
#
# As $ADMIN_ROLE, not `postgres`. pg_dump sets `row_security = off`, which fails on
# any table carrying a policy unless the reading role owns it or has BYPASSRLS, and
# `postgres` is neither a superuser nor BYPASSRLS here. Every CRM table has RLS, so
# the moment they are not owned by `postgres` it can read none of them: fourteen
# tables, no data, an archive that restores an empty database. No policy is changed
# and no application role gains anything — see deploy/lib/db-admin.sh.
#
# A failure here must never reach the encryption step: `set -e` stops the script,
# and the completeness check below reads the artifact rather than trusting that.
pg_dump_admin postgres \
  --format=custom --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage > "$WORK/$NAME.dump"

RAW=$(stat -c %s "$WORK/$NAME.dump")
echo "--- dumped ${RAW} bytes"

# The same completeness check the off-site backup runs. This path never had it,
# and this is the path the office server actually uses every night.
. "$ROOT/scripts/lib/backup-archive.sh"
assert_archive_complete "$WORK/$NAME.dump"
# A dump this small is an empty database, not a backup. Refusing beats writing
# it over a good copy from last night.
[ "$RAW" -ge 4096 ] || { echo "dump is only ${RAW} bytes — refusing" >&2; exit 1; }

echo "--- encrypting"
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
  -in "$WORK/$NAME.dump" -out "$WORK/$NAME.dump.enc" -pass env:BACKUP_PASSPHRASE

# Prove the ciphertext decrypts before it becomes the only copy. An unverified
# backup is a guess.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in "$WORK/$NAME.dump.enc" -pass env:BACKUP_PASSPHRASE | cmp -s - "$WORK/$NAME.dump" \
  || { echo "encrypted file did not decrypt back to the dump" >&2; exit 1; }
echo "--- decrypt check passed"

sha256sum "$WORK/$NAME.dump.enc" | awk '{print $1}' > "$WORK/$NAME.dump.enc.sha256"
cp "$WORK/$NAME.dump.enc" "$WORK/$NAME.dump.enc.sha256" "$BACKUP_DIR/"
echo "--- written to $BACKUP_DIR/$NAME.dump.enc"

# The external drive. A backup on the same disk as the database is not a backup
# of the disk failing, so this is the copy that matters most.
if [ -n "$EXTERNAL_DIR" ]; then
  if mountpoint -q "$(dirname "$EXTERNAL_DIR")" 2>/dev/null || [ -d "$EXTERNAL_DIR" ]; then
    mkdir -p "$EXTERNAL_DIR"
    cp "$BACKUP_DIR/$NAME.dump.enc" "$BACKUP_DIR/$NAME.dump.enc.sha256" "$EXTERNAL_DIR/" \
      && echo "--- copied to $EXTERNAL_DIR"
  else
    # A warning, not a failure: the local backup succeeded and losing it because
    # somebody unplugged a drive would be the wrong trade.
    echo "WARNING: external drive not mounted at $EXTERNAL_DIR — local copy only" >&2
  fi
fi

echo "--- pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name 'jsk-crm-*.dump.enc*' -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
[ -n "$EXTERNAL_DIR" ] && [ -d "$EXTERNAL_DIR" ] && \
  find "$EXTERNAL_DIR" -name 'jsk-crm-*.dump.enc*' -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true

if [ "${1:-}" = "--verify" ]; then
  echo "--- verifying by restoring into a scratch database"
  "$ROOT/deploy/restore.sh" --scratch "$BACKUP_DIR/$NAME.dump.enc"
fi

echo "--- done"
ls -lh "$BACKUP_DIR" | tail -5
