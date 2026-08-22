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
  local dump="$1" missing="" t err

  # 1. IS THE ARCHIVE READABLE AT ALL? This has to come first.
  #
  # A custom-format archive keeps its table of contents at the END, so a truncated
  # file does not list *fewer* tables — `pg_restore -l` fails outright and prints
  # nothing. Checking per-table entries first therefore reported "no TABLE DATA
  # for" all fourteen tables and blamed the dumping role, when the real fault was a
  # stream cut short. Measured: truncating a good 222 KB archive to 95 KB produced
  # that exact message, table for table.
  err="$(pg_restore -l "$dump" 2>&1 >/dev/null)"
  if [ -n "$err" ]; then
    echo "The archive cannot be read — it is truncated or corrupt, not merely empty:" >&2
    printf '  %s\n' "$err" | head -2 >&2
    echo "This is a TRANSPORT fault, not a permissions one: pg_dump wrote more than" >&2
    echo "arrived. Check how the dump is moved out of the database container." >&2
    return 1
  fi

  # 2. Does it decode end to end? Catches a file that lists cleanly and still has
  # data blocks missing.
  if ! pg_restore -f /dev/null "$dump" >/dev/null 2>"$dump.decode.err"; then
    echo "The archive lists cleanly but does not decode:" >&2
    head -2 "$dump.decode.err" >&2
    rm -f "$dump.decode.err"
    return 1
  fi
  rm -f "$dump.decode.err"

  # 3. Does the index name every business table? This is the one that means the
  # dumping role could not read them.
  #
  # The table of contents is read ONCE, into a variable, and matched with shell
  # pattern tests. It used to be `pg_restore -l | grep -q` per table, and the
  # callers run with `set -o pipefail`: `grep -q` exits the moment it matches,
  # pg_restore then dies of SIGPIPE, and the PIPELINE reports failure even though
  # the table was found. That made this check fail intermittently on whichever
  # table the timing happened to land on — two runs of the drill failed on
  # `projects` and on `activities`, and a third passed, with byte-identical
  # archives. No pipeline, no race.
  local toc
  toc="$(pg_restore -l "$dump" 2>/dev/null)"
  for t in "${BACKUP_BUSINESS_TABLES[@]}"; do
    case "$toc" in
      *"TABLE DATA public $t "*) ;;
      *) missing="$missing $t" ;;
    esac
  done
  if [ -n "$missing" ]; then
    echo "The dump is readable but incomplete — no TABLE DATA for:$missing" >&2
    echo "A disaster-recovery backup must be taken by an administrative role that can" >&2
    echo "read the whole database — see deploy/lib/db-admin.sh." >&2
    return 1
  fi

  echo "--- archive contains all ${#BACKUP_BUSINESS_TABLES[@]} business tables and decodes cleanly"
}
