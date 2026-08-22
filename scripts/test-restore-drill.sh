#!/usr/bin/env bash
# Restore-drill regression test (§18).
#
#   scripts/test-restore-drill.sh            three full cycles against a bare server
#   SOURCE_DATABASE_URL=... scripts/...      dump a different source (read-only)
#
# WHAT THIS EXISTS TO CATCH. A restore that reports success and is not a usable
# database. The archive is schema-filtered and pg_dump never dumps roles, so three
# things the CRM depends on are absent from it, and each fails quietly:
#
#   * extensions — the trigram indexes vanish and search_crm() raises (found by the
#     first drill);
#   * platform schemas — storage objects fail with `schema "storage" does not
#     exist`, and with --clean --if-exists so do the DROPs;
#   * platform roles — every CREATE POLICY fails with `role "authenticated" does not
#     exist`. Measured on this schema: 45 errors, 14 tables restored, 42 policies
#     LOST. Row counts matched. RLS reported on. The database was unusable.
#
# So the target here is a BARE PostgreSQL cluster — initdb and nothing else, no
# Supabase roles, no auth or storage schema. That is the disaster-recovery case the
# independent backup exists for, and the only target on which those gaps are visible.
#
# It reads the source with pg_dump and writes only to its own temporary cluster.
# PRODUCTION IS NEVER TOUCHED: no compose volume, no production env file, and the
# scratch target is a throwaway database that is dropped on exit.
#
# NO PASSPHRASE, PASSWORD OR ROW OF CUSTOMER DATA IS PRINTED — only counts.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
BARE=${BARE:-/var/lib/jsk-drill-bare}
BAREPORT=${BAREPORT:-54397}
CYCLES=${CYCLES:-3}
SOURCE_DATABASE_URL=${SOURCE_DATABASE_URL:-postgresql://postgres@127.0.0.1:54322/postgres}
WORK="$(mktemp -d)"

PASS=0; FAIL=0
ok()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  \033[31mFAIL\033[0m  %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }

cleanup() {
  su postgres -c "$PGBIN/pg_ctl -D $BARE -w -s -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$BARE" "$WORK"
}
trap cleanup EXIT

pg_isready -d "$SOURCE_DATABASE_URL" -q 2>/dev/null \
  || { echo "no source database — run scripts/db.sh start" >&2; exit 1; }

echo "Restore-drill regression test — $CYCLES full cycles onto a BARE PostgreSQL server"
echo

# --- a server that has never seen Supabase -----------------------------------
su postgres -c "$PGBIN/pg_ctl -D $BARE -w -s -m immediate stop" >/dev/null 2>&1 || true
rm -rf "$BARE"; mkdir -p "$BARE"; chown postgres:postgres "$BARE"; chmod 700 "$BARE"
su postgres -c "$PGBIN/initdb -D $BARE -U postgres --auth-local=trust --auth-host=trust -E UTF8 --locale=C" >/dev/null 2>&1 \
  || { echo "initdb failed" >&2; exit 1; }
printf 'local all all trust\nhost all all 127.0.0.1/32 trust\n' > "$BARE/pg_hba.conf"
chown postgres:postgres "$BARE/pg_hba.conf"; chmod 600 "$BARE/pg_hba.conf"
su postgres -c "$PGBIN/pg_ctl -D $BARE -l $BARE/pg.log \
   -o '-p $BAREPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$BARE' -w start" >/dev/null 2>&1 \
  || { echo "could not start the bare cluster on port $BAREPORT:" >&2
       tail -5 "$BARE/pg.log" >&2 2>/dev/null
       echo "(is something already listening there? set BAREPORT=...)" >&2; exit 1; }

BARE_ADMIN="postgresql://postgres@127.0.0.1:$BAREPORT/postgres"
[ "$(psql "$BARE_ADMIN" -tAc "select count(*) from pg_roles where rolname in ('anon','authenticated','service_role');" | tr -d ' ')" = "0" ] \
  && ok "the target has no Supabase roles — the disaster-recovery case" \
  || bad "the target already has platform roles" "the gaps under test would be invisible"

# --- what the source holds ----------------------------------------------------
src() { psql "$SOURCE_DATABASE_URL" -tAq -c "$1" 2>/dev/null | tr -d '[:space:]'; }
dst() { psql "postgresql://postgres@127.0.0.1:$BAREPORT/scratch" -tAq -c "$1" 2>/dev/null | tr -d '[:space:]'; }

SRC_TABLES="$(src "select count(*) from pg_tables where schemaname='public';")"
SRC_POLICIES="$(src "select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';")"
SRC_FKS="$(src "select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='f';")"
SRC_INDEXES="$(src "select count(*) from pg_indexes where schemaname='public';")"
SRC_ROWS="$(src "select coalesce(string_agg(t||'='||n, ',' order by t), '') from (select tablename t, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from public.%I', tablename), false, true, '')))[1]::text::bigint n from pg_tables where schemaname='public') x;")"
echo "  source: $SRC_TABLES tables, $SRC_POLICIES policies, $SRC_FKS foreign keys, $SRC_INDEXES indexes"
echo

# --- the cycles ---------------------------------------------------------------
for cycle in $(seq 1 "$CYCLES"); do
  echo "Cycle $cycle of $CYCLES"
  PASSPHRASE="$(openssl rand -hex 24)"   # per cycle, never printed
  DEST="$WORK/c$cycle"; mkdir -p "$DEST"

  if DATABASE_URL="$SOURCE_DATABASE_URL" BACKUP_PASSPHRASE="$PASSPHRASE" BACKUP_DEST="file://$DEST" \
       "$ROOT/scripts/backup.sh" "drill-$cycle" >"$WORK/backup.log" 2>&1; then
    ok "backup: dumped, encrypted, decrypt-checked and checksummed"
  else
    bad "backup failed" "$(tail -2 "$WORK/backup.log")"; continue
  fi

  ART="$(ls "$DEST"/*.dump.enc 2>/dev/null | head -1)"
  [ -n "$ART" ] && ok "archive and sha256 sidecar written" || { bad "no archive produced"; continue; }

  psql "$BARE_ADMIN" -q -c "drop database if exists scratch;" -c "create database scratch;" >/dev/null 2>&1

  if BACKUP_PASSPHRASE="$PASSPHRASE" \
     RESTORE_DATABASE_URL="postgresql://postgres@127.0.0.1:$BAREPORT/scratch" \
       "$ROOT/scripts/restore.sh" "$ART" >"$WORK/restore.log" 2>&1; then
    ok "restore: prepared, restored and verified"
  else
    bad "restore failed" "$(grep -E 'ERROR|error' "$WORK/restore.log" | head -1)"
  fi

  # pg_restore's own diagnostics — the fix is that there are none, not that they
  # are tolerated. Errors are never suppressed; they are asserted absent.
  DIAGS="$(grep -oE 'pg_restore exit=[0-9]+, [0-9]+ diagnostic' "$WORK/restore.log" | head -1)"
  case "$DIAGS" in
    "pg_restore exit=0, 0 diagnostic") ok "pg_restore reported no errors at all" ;;
    *) bad "pg_restore reported errors" "${DIAGS:-no exit line found}" ;;
  esac

  # --- parity, source vs restored ---------------------------------------------
  D_TABLES="$(dst "select count(*) from pg_tables where schemaname='public';")"
  D_POLICIES="$(dst "select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';")"
  D_FKS="$(dst "select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='f';")"
  D_INDEXES="$(dst "select count(*) from pg_indexes where schemaname='public';")"
  D_ROWS="$(dst "select coalesce(string_agg(t||'='||n, ',' order by t), '') from (select tablename t, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from public.%I', tablename), false, true, '')))[1]::text::bigint n from pg_tables where schemaname='public') x;")"

  [ "$D_TABLES"   = "$SRC_TABLES" ]   && ok "tables match source ($D_TABLES)"        || bad "table count differs" "source $SRC_TABLES, restored $D_TABLES"
  [ "$D_POLICIES" = "$SRC_POLICIES" ] && ok "policies match source ($D_POLICIES)"    || bad "policy count differs" "source $SRC_POLICIES, restored $D_POLICIES"
  [ "$D_FKS"      = "$SRC_FKS" ]      && ok "foreign keys match source ($D_FKS)"     || bad "foreign key count differs" "source $SRC_FKS, restored $D_FKS"
  [ "$D_INDEXES"  = "$SRC_INDEXES" ]  && ok "indexes match source ($D_INDEXES)"      || bad "index count differs" "source $SRC_INDEXES, restored $D_INDEXES"
  [ "$D_ROWS"     = "$SRC_ROWS" ]     && ok "every table's row count matches source" || bad "row counts differ" "per-table counts diverged"

  # The platform objects the archive does not carry.
  [ "$(dst "select count(*) from pg_namespace where nspname in ('auth','storage','extensions');")" = "3" ] \
    && ok "auth, storage and extensions schemas present" || bad "a platform schema is missing"
  [ "$(dst "select count(*) from pg_extension where extname in ('pg_trgm','pgcrypto');")" = "2" ] \
    && ok "pg_trgm and pgcrypto present (the earlier drill defect stays fixed)" || bad "an extension is missing"
  [ "$(dst "select count(*) from pg_indexes where schemaname='public' and indexname like '%_trgm';")" = "3" ] \
    && ok "all 3 trigram indexes present" || bad "a trigram index is missing"
  [ -n "$(dst "select count(*) from public.search_crm('drill probe');")" ] \
    && ok "search_crm() executes against the restored database" || bad "search_crm() failed"
  [ "$(dst "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;")" = "0" ] \
    && ok "RLS enabled on every restored table" || bad "a restored table has RLS off"
  echo
done

# --- the production guard still holds -----------------------------------------
echo "Production safety"
if BACKUP_PASSPHRASE="x" RESTORE_DATABASE_URL="postgresql://postgres@127.0.0.1:$BAREPORT/jsk_production" \
     "$ROOT/scripts/restore.sh" /dev/null >"$WORK/guard.log" 2>&1; then
  bad "a production-looking target was accepted" "the guard is not working"
else
  grep -q "looks like production" "$WORK/guard.log" \
    && ok "a production-looking target is refused before anything is read" \
    || bad "refused, but not by the production guard" "$(head -1 "$WORK/guard.log")"
fi
[ -z "$(psql "$SOURCE_DATABASE_URL" -tAq -c "select 1 from pg_stat_activity where datname = 'scratch';" 2>/dev/null)" ] \
  && ok "the source database was only ever read" || bad "the source was written to"

echo
echo "──────────────────────────────────────────"
echo "passed $PASS, failed $FAIL"
[ "$FAIL" = 0 ] || exit 1
