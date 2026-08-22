#!/usr/bin/env bash
#
# Independent weekly backup (§17).
#
# The point of this script is that it does not need Supabase's cooperation to
# work, and its output does not need Supabase's cooperation to read. Supabase
# takes its own automated backups and those stay switched on; this is the copy
# the business holds, in the business's own AWS account, that survives a lost
# account, a billing dispute, or a vendor outage.
#
# The dump is encrypted BEFORE it leaves this machine. S3 server-side encryption
# is also on (see the workflow), but that protects the object from someone who
# reaches the bucket, not from someone who reaches AWS — and "recover without
# vendor cooperation" has to mean without *any* vendor's cooperation. The
# passphrase lives in GitHub Actions secrets and, on paper, in the business
# safe. Lose it and the backups are unreadable; that is the intended trade.
#
#   DATABASE_URL         required  postgres connection string to dump
#   BACKUP_PASSPHRASE    required  symmetric key; >= 20 chars
#   BACKUP_DEST          required  s3://bucket/prefix  or  file:///abs/path
#   AWS_REGION           required for s3://  and MUST be ap-south-1 (§17)
#
# Usage:  scripts/backup.sh [label]
set -euo pipefail

LABEL="${1:-scheduled}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
: "${BACKUP_DEST:?BACKUP_DEST is required (s3://bucket/prefix or file:///abs/path)}"

if [ "${#BACKUP_PASSPHRASE}" -lt 20 ]; then
  echo "BACKUP_PASSPHRASE must be at least 20 characters." >&2
  exit 2
fi

# Indian data residency is not negotiable (§7, §17). A bucket in the wrong region
# is a compliance failure, so refuse rather than quietly write to it.
if [[ "$BACKUP_DEST" == s3://* ]]; then
  : "${AWS_REGION:?AWS_REGION is required for an s3:// destination}"
  if [ "$AWS_REGION" != "ap-south-1" ]; then
    echo "AWS_REGION is '$AWS_REGION'; backups must stay in ap-south-1 (Mumbai)." >&2
    exit 2
  fi
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="jsk-crm-${STAMP}-${LABEL}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

DUMP="$WORK/$NAME.dump"
ENC="$WORK/$NAME.dump.enc"

echo "--- pg_dump ($STAMP)"
# Custom format: compressed, and pg_restore can rebuild selectively from it.
# public + auth + storage is the whole business record — the CRM rows, the login
# identities that own them, and the Storage object metadata. Dumping public alone
# would restore a database in which nobody can log in.
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage \
  --file="$DUMP"

RAW_BYTES=$(stat -c %s "$DUMP")
echo "--- dumped ${RAW_BYTES} bytes"

# One definition of "complete", shared with deploy/backup.sh.
. "$(dirname "$0")/lib/backup-archive.sh"
assert_archive_complete "$DUMP"

# A dump smaller than this is not a backup, it is an empty database with a
# schema. Failing loudly beats uploading it over last week's good copy.
if [ "$RAW_BYTES" -lt 4096 ]; then
  echo "Dump is only ${RAW_BYTES} bytes — refusing to publish it." >&2
  exit 1
fi

echo "--- encrypting (aes-256-cbc, pbkdf2, 600k iterations)"
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
  -in "$DUMP" -out "$ENC" -pass env:BACKUP_PASSPHRASE

# Proof the ciphertext decrypts, before it is the only copy. An unverified
# backup is a guess.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in "$ENC" -pass env:BACKUP_PASSPHRASE | cmp -s - "$DUMP" \
  || { echo "Encrypted file did not decrypt back to the dump." >&2; exit 1; }
echo "--- decrypt check passed"

sha256sum "$ENC" | awk '{print $1}' > "$ENC.sha256"
ENC_BYTES=$(stat -c %s "$ENC")

echo "--- publishing to $BACKUP_DEST"
case "$BACKUP_DEST" in
  s3://*)
    BASE="${BACKUP_DEST%/}"
    # Versioning and the lifecycle rule live on the bucket, not here (§17).
    # SSE-S3 is belt-and-braces on top of the client-side encryption above.
    aws s3 cp "$ENC" "$BASE/$NAME.dump.enc" \
      --region "$AWS_REGION" --sse AES256 --only-show-errors
    aws s3 cp "$ENC.sha256" "$BASE/$NAME.dump.enc.sha256" \
      --region "$AWS_REGION" --sse AES256 --only-show-errors
    # Read it back: a PUT that returned 200 is not the same as an object that
    # exists at the size we wrote.
    REMOTE=$(aws s3api head-object --bucket "$(echo "$BASE" | sed -E 's#^s3://([^/]+).*#\1#')" \
      --key "$(echo "$BASE/$NAME.dump.enc" | sed -E 's#^s3://[^/]+/##')" \
      --region "$AWS_REGION" --query ContentLength --output text)
    [ "$REMOTE" = "$ENC_BYTES" ] || { echo "Uploaded size $REMOTE != $ENC_BYTES." >&2; exit 1; }
    ;;
  file://*)
    DIR="${BACKUP_DEST#file://}"
    mkdir -p "$DIR"
    cp "$ENC" "$DIR/$NAME.dump.enc"
    cp "$ENC.sha256" "$DIR/$NAME.dump.enc.sha256"
    ;;
  *) echo "BACKUP_DEST must start with s3:// or file://" >&2; exit 2 ;;
esac

echo "--- done"
echo "artifact:  $NAME.dump.enc"
echo "plain:     ${RAW_BYTES} bytes"
echo "encrypted: ${ENC_BYTES} bytes"
echo "sha256:    $(cat "$ENC.sha256")"
