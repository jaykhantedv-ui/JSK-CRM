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
  for t in "${BACKUP_BUSINESS_TABLES[@]}"; do
    pg_restore -l "$dump" 2>/dev/null | grep -q "TABLE DATA public $t " || missing="$missing $t"
  done
  if [ -n "$missing" ]; then
    echo "The dump is incomplete — no TABLE DATA for:$missing" >&2
    echo "Refusing to publish it. If pg_dump reported a row-level security error, the" >&2
    echo "dumping role owns neither the table nor BYPASSRLS; dump as the owner instead." >&2
    return 1
  fi
  echo "--- archive contains all ${#BACKUP_BUSINESS_TABLES[@]} business tables"
}
