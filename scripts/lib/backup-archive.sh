# Is this archive actually restorable? Sourced by both backup scripts, not run.
#
# There are two backup entry points — scripts/backup.sh for the independent
# off-site copy and deploy/backup.sh for the office server — and this check has to
# be identical in both. Keeping the list of business tables in one file is the
# point: the last defect in this area was two copies of a list where only one got
# fixed.

# The fourteen tables §4.1 defines. An archive without data for every one of them
# is not a backup of this business.
BACKUP_BUSINESS_TABLES=(
  users outlets user_outlets accounts contacts projects project_stakeholders
  opportunities activities opportunity_events system_settings sales_targets
  import_batches import_rows
)

# assert_archive_complete <path-to-custom-format-dump>
#
# pg_dump can fail PART WAY and still leave a listable file behind. The way it
# happens here is specific and worth naming: a role that is neither the table's
# owner nor exempt from row-level security cannot COPY an RLS-protected table —
# `query would be affected by row-level security policy for table "objects"` — and
# pg_dump exits 1 with the file already partly written. `set -e` stops the script,
# but a backup is the one place to check the artifact rather than trust the exit
# code, because the cost of being wrong is discovered months later.
#
# Reading the table of contents is cheap and touches no data.
assert_archive_complete() {
  local dump="$1" missing="" t

  # 1. The index names every business table.
  for t in "${BACKUP_BUSINESS_TABLES[@]}"; do
    pg_restore -l "$dump" 2>/dev/null | grep -q "TABLE DATA public $t " || missing="$missing $t"
  done
  if [ -n "$missing" ]; then
    echo "The dump is incomplete — no TABLE DATA for:$missing" >&2
    echo "Refusing to publish it. A disaster-recovery backup must be taken by an" >&2
    echo "administrative role that can read the whole database — see deploy/lib/db-admin.sh." >&2
    return 1
  fi

  # 2. The archive actually DECODES, end to end.
  #
  # The index alone is not evidence. pg_dump writes the complete table of contents
  # BEFORE it copies any rows, so an archive whose data blocks are missing still
  # lists all fourteen tables — `pg_restore -l` reports them and this check used to
  # pass. Measured: a dump killed by a row-level security error on its first table
  # listed 14 TABLE DATA entries and contained none of the rows.
  #
  # Decoding the whole archive to nowhere costs a second, needs no database, and
  # fails with `could not read from input file: end of file` on exactly that
  # truncation.
  if ! pg_restore -f /dev/null "$dump" >/dev/null 2>"$dump.decode.err"; then
    echo "The dump does not decode — it is truncated or corrupt:" >&2
    head -2 "$dump.decode.err" >&2
    rm -f "$dump.decode.err"
    echo "Refusing to publish it." >&2
    return 1
  fi
  rm -f "$dump.decode.err"

  echo "--- archive contains all ${#BACKUP_BUSINESS_TABLES[@]} business tables and decodes cleanly"
}
