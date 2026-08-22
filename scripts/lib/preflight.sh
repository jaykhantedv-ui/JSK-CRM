# Naming the command that is missing. Sourced, not run.
#
# `command not found` is exit 127, and a bare 127 says nothing about WHICH command.
# The office server spent two rounds on one: the backup stopped straight after the
# dump with EXIT=127 and no name attached, and every candidate had to be excluded
# by reading the source. A script that depends on external commands should say
# which one it could not find.

# require_commands <what-for> <command>...
# Reports every missing command by name, not just the first.
require_commands() {
  local label="$1"; shift
  local missing="" c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || missing="$missing $c"
  done
  if [ -n "$missing" ]; then
    echo "missing on this host, needed for ${label}:${missing}" >&2
    echo "Install them, or run the operation where they exist. Note that the" >&2
    echo "self-hosted backup deliberately needs NO PostgreSQL client tools here —" >&2
    echo "if pg_restore or psql is named above, something is using the wrong path." >&2
    return 1
  fi
}

# report_failed_command <line>
# An ERR trap that names the command, its exit status and where it was.
# Install with:  trap 'report_failed_command $LINENO' ERR
report_failed_command() {
  local status=$? line="${1:-?}"
  echo >&2
  echo "FAILED: \`${BASH_COMMAND}\` exited ${status} (line ${line})" >&2
  if [ "$status" = "127" ]; then
    echo "Exit 127 is 'command not found' — the missing command is named above." >&2
  fi
  exit "$status"
}
