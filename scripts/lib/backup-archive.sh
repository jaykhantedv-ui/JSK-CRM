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

# WHERE THE ARCHIVE IS INSPECTED.
#
# Reading a custom-format archive needs `pg_restore`, and the office server does
# not have PostgreSQL client tools installed — nor should it need them, when a
# container with the exact matching version is already running. Calling pg_restore
# on the host there exits 127, `command not found`, immediately after the dump: a
# perfectly good archive, refused because the validator could not open it.
#
#   host       pg_restore on this machine — scripts/backup.sh, CI, a laptop
#   container  pg_restore inside the db container — deploy/backup.sh
#
# deploy/lib/db-admin.sh selects `container` and provides the implementation,
# because it owns the compose transport. Everything else below — the three-way
# diagnosis and the fourteen-table check — is shared and runs identically either
# way, on a table of contents that is a text file by the time it gets here.
: "${ARCHIVE_INSPECT:=host}"

# archive_inspect <archive> <toc-out> <err-out>
#   0  readable and decodes
#   1  unreadable: truncated or corrupt
#   2  lists cleanly but does not decode
#   3  cannot inspect at all: no pg_restore available
archive_inspect() {
  case "$ARCHIVE_INSPECT" in
    container) archive_inspect_container "$@" ;;
    *)         archive_inspect_host "$@" ;;
  esac
}

archive_inspect_host() {
  local archive="$1" toc="$2" err="$3"
  if ! command -v pg_restore >/dev/null 2>&1; then
    echo "pg_restore is not installed on this host" > "$err"
    return 3
  fi
  if ! pg_restore -l "$archive" > "$toc" 2> "$err"; then return 1; fi
  if ! pg_restore -f /dev/null "$archive" >/dev/null 2> "$err"; then return 2; fi
  : > "$err"
  return 0
}

# assert_archive_complete <path-to-custom-format-dump>
#
# pg_dump can fail PART WAY and still leave a listable file behind, and a dump
# taken by a role that cannot read a table produces an archive with no data for it.
# Both publish an archive that restores an empty database, so the artifact is
# checked rather than the exit code trusted.
assert_archive_complete() {
  local dump="$1" missing="" t status rc=0
  local toc="${dump}.toc" err="${dump}.inspect.err"

  archive_inspect "$dump" "$toc" "$err"; status=$?

  if [ "$status" = "3" ]; then
    echo "The archive cannot be inspected — no pg_restore is available:" >&2
    head -2 "$err" >&2
    echo "deploy/backup.sh inspects inside the db container and needs no client" >&2
    echo "tools on the host; scripts/backup.sh needs pg_restore where it runs." >&2
    rc=1
  elif [ "$status" = "1" ]; then
    # A custom archive keeps its table of contents at the END, so a truncated file
    # does not list *fewer* tables — pg_restore fails outright and prints nothing.
    # Diagnosing per-table first blamed the dumping role for what was a stream cut
    # short: truncating a good 222 KB archive to 95 KB produced exactly that,
    # table for table.
    echo "The archive cannot be read — it is truncated or corrupt, not merely empty:" >&2
    head -2 "$err" >&2
    echo "This is a TRANSPORT fault, not a permissions one: pg_dump wrote more than" >&2
    echo "arrived. Check how the dump is moved out of the database container." >&2
    rc=1
  elif [ "$status" = "2" ]; then
    echo "The archive lists cleanly but does not decode:" >&2
    head -2 "$err" >&2
    rc=1
  else
    # Does the index name every business table? This is the one that means the
    # dumping role could not read them.
    #
    # Matched with shell patterns against a file read once. It used to be
    # `pg_restore -l | grep -q` per table, and the callers run with `pipefail`:
    # grep exits the moment it matches, pg_restore then dies of SIGPIPE, and the
    # PIPELINE reports failure although the table was found — the drill failed on
    # `projects`, then on `activities`, then passed, with byte-identical archives.
    local toc_text
    toc_text="$(cat "$toc" 2>/dev/null || true)"
    for t in "${BACKUP_BUSINESS_TABLES[@]}"; do
      case "$toc_text" in
        *"TABLE DATA public $t "*) ;;
        *) missing="$missing $t" ;;
      esac
    done
    if [ -n "$missing" ]; then
      echo "The dump is readable but incomplete — no TABLE DATA for:$missing" >&2
      echo "A disaster-recovery backup must be taken by an administrative role that can" >&2
      echo "read the whole database — see deploy/lib/db-admin.sh." >&2
      rc=1
    else
      echo "--- archive contains all ${#BACKUP_BUSINESS_TABLES[@]} business tables and decodes cleanly"
    fi
  fi

  # One exit path, so the temporary files go on success and on every failure.
  rm -f "$toc" "$err"
  return "$rc"
}
