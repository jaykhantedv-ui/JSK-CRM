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

SHAPED=${SHAPED:-/var/lib/jsk-drill-shaped}
SHAPEDPORT=${SHAPEDPORT:-54396}
PROD_ENV="$ROOT/deploy/env/production.env"
cleanup() {
  su postgres -c "$PGBIN/pg_ctl -D $BARE   -w -s -m immediate stop" >/dev/null 2>&1 || true
  su postgres -c "$PGBIN/pg_ctl -D $SHAPED -w -s -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$BARE" "$SHAPED" "$WORK"
  # The temporary env file this test writes is never left behind.
  [ -f "$PROD_ENV.drillbak" ] && mv -f "$PROD_ENV.drillbak" "$PROD_ENV" || rm -f "$PROD_ENV"
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

# --- the production path: deploy/backup.sh --verify ---------------------------
#
# scripts/restore.sh and deploy/restore.sh are two different wrappers around the
# same job, and the office server uses the SECOND one. It kept its own copy of the
# preparation — extensions only — so every fix to the first missed it entirely.
# This runs the production wrapper for real.
#
# Containers cannot be started here (the registry is unreachable), so only the
# TRANSPORT is substituted: a shim on PATH turns `docker compose exec -T db <cmd>`
# into that command against a local cluster. Everything else — deploy/backup.sh,
# deploy/restore.sh, the shared preparation, the verification — is the real script.
echo "The production path: deploy/backup.sh --verify"

# A cluster shaped like the image: supabase_admin is the bootstrap superuser and
# `postgres` is an ordinary role, so the administrative path is exercised too.
su postgres -c "$PGBIN/pg_ctl -D $SHAPED -w -s -m immediate stop" >/dev/null 2>&1 || true
rm -rf "$SHAPED"; mkdir -p "$SHAPED"; chown postgres:postgres "$SHAPED"; chmod 700 "$SHAPED"
su postgres -c "$PGBIN/initdb -D $SHAPED -U supabase_admin --auth-local=trust --auth-host=trust -E UTF8 --locale=C" >/dev/null 2>&1
printf 'local all all trust\nhost all all 127.0.0.1/32 trust\n' > "$SHAPED/pg_hba.conf"
chown postgres:postgres "$SHAPED/pg_hba.conf"; chmod 600 "$SHAPED/pg_hba.conf"
su postgres -c "$PGBIN/pg_ctl -D $SHAPED -l $SHAPED/pg.log \
   -o '-p $SHAPEDPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$SHAPED' -w start" >/dev/null 2>&1 \
  || { bad "could not start the shaped cluster"; SHAPED_UP=0; }
SHAPED_UP=${SHAPED_UP:-1}

if [ "$SHAPED_UP" = "1" ]; then
  ADMIN_LABEL=supabase_admin
  SH_ADMIN="postgresql://supabase_admin@127.0.0.1:$SHAPEDPORT/postgres"
  psql "$SH_ADMIN" -q -c "create role postgres login nosuperuser createdb;" >/dev/null 2>&1
  # Give it a live CRM to back up, owned by the platform superuser — the shape the
  # office server was in when the backup came back empty. `postgres` is given
  # pg_read_all_data so that PRIVILEGES are not the variable: it may select from
  # every table and still cannot dump one, because pg_dump sets `row_security = off`
  # and that fails for any role which neither owns the table nor has BYPASSRLS.
  psql "$SH_ADMIN" -v ON_ERROR_STOP=1 -q -f "$ROOT/scripts/restore-prepare.sql" >/dev/null 2>&1
  psql "$SH_ADMIN" -q -c "grant connect on database postgres to postgres;" \
                   -c "grant pg_read_all_data to postgres;" >/dev/null 2>&1
  pg_dump "$SOURCE_DATABASE_URL" --format=custom --no-owner --no-privileges \
    --schema=public --schema=auth --schema=storage --file="$WORK/live.dump" 2>/dev/null
  pg_restore --dbname "$SH_ADMIN" --clean --if-exists --no-owner --no-privileges \
    "$WORK/live.dump" >/dev/null 2>&1
  [ "$(psql "$SH_ADMIN" -tAq -c "select count(*) from pg_tables where schemaname='public';" | tr -d ' ')" = "$SRC_TABLES" ] \
    && ok "a live CRM exists, owned by $ADMIN_LABEL, with RLS on every table" \
    || bad "could not seed the shaped cluster"
  [ "$(psql "$SH_ADMIN" -tAq -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres';" | tr -d ' ')" = "0" ] \
    && ok "the dumping role owns none of them — the office server's shape" \
    || bad "postgres owns some tables" "the failure under test would not reproduce"

  # --- the reported failure, and the fix, at the level of the guard ------------
  . "$ROOT/scripts/lib/backup-archive.sh"

  pg_dump "postgresql://postgres@127.0.0.1:$SHAPEDPORT/postgres" \
    --format=custom --no-owner --no-privileges \
    --schema=public --schema=auth --schema=storage --file="$WORK/asrole.dump" \
    >"$WORK/asrole.err" 2>&1
  grep -q "row-level security" "$WORK/asrole.err" \
    && ok "as postgres: pg_dump is refused by row-level security" \
    || bad "as postgres: pg_dump was not refused" "$(head -1 "$WORK/asrole.err")"
  if assert_archive_complete "$WORK/asrole.dump" >/dev/null 2>&1; then
    bad "the guard accepted the archive dumped as postgres" "it has no business-table data"
  else
    ok "the completeness guard REFUSES that archive — no artifact would be published"
  fi

  pg_dump "$SH_ADMIN" --format=custom --no-owner --no-privileges \
    --schema=public --schema=auth --schema=storage --file="$WORK/asadmin.dump" 2>/dev/null
  assert_archive_complete "$WORK/asadmin.dump" >/dev/null 2>&1 \
    && ok "as $ADMIN_LABEL: the archive carries all 14 business tables" \
    || bad "as $ADMIN_LABEL: the archive is still incomplete"

  # --- a TRUNCATED archive must be diagnosed as transport, not as permissions ---
  #
  # The office server's dump arrived at 95,811 bytes. A custom archive keeps its
  # table of contents at the end, so `pg_restore -l` failed and the checker — which
  # looked for per-table entries first — reported every business table missing and
  # blamed the dumping role. The byte count was the giveaway: a schema-only dump of
  # this database is 212 KB, so 95 KB was never schema-only, it was cut off.
  head -c 95811 "$WORK/asadmin.dump" > "$WORK/trunc.dump"
  TRUNC_MSG="$(assert_archive_complete "$WORK/trunc.dump" 2>&1 >/dev/null | head -1)"
  case "$TRUNC_MSG" in
    *"truncated or corrupt"*) ok "a truncated archive is diagnosed as a TRANSPORT fault" ;;
    *) bad "a truncated archive was misdiagnosed" "said: ${TRUNC_MSG:-nothing}" ;;
  esac
  assert_archive_complete "$WORK/trunc.dump" >/dev/null 2>&1 \
    && bad "the guard accepted a truncated archive" \
    || ok "and it is refused, so no artifact would be published"

  # The transport shim.
  mkdir -p "$WORK/bin"
  cat > "$WORK/bin/docker" <<SHIM
#!/usr/bin/env bash
# Translates the compose calls the deploy scripts make into local equivalents:
#   compose exec -T db <cmd> <args>   -> <cmd> against 127.0.0.1:$SHAPEDPORT
#   compose cp db:<src> <dest>        -> cp <src> <dest>
#   compose cp <src> db:<dest>        -> cp <src> <dest>
# Everything else is a no-op success.
args=(); seen_exec=0; seen_cp=0; cmd=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    compose|-T) shift ;;
    --env-file) shift 2 ;;
    exec) seen_exec=1; shift ;;
    cp) seen_cp=1; shift ;;
    stop|start|ps) exit 0 ;;
    db) if [ "\$seen_cp" = 1 ]; then args+=("\$1"); fi; shift ;;
    *) if [ "\$seen_exec" = 1 ] && [ -z "\$cmd" ]; then cmd="\$1"; else args+=("\$1"); fi; shift ;;
  esac
done
if [ "\$seen_cp" = 1 ]; then
  # Strip the db: prefix from whichever side carries it; both sides are local here.
  src="\${args[0]#db:}"; dst="\${args[1]#db:}"
  exec cp -f "\$src" "\$dst"
fi
[ -n "\$cmd" ] || exit 0
case "\$cmd" in
  psql|pg_dump|pg_restore|pg_isready)
    final=(); i=0
    while [ \$i -lt \${#args[@]} ]; do
      case "\${args[\$i]}" in
        -h|-p) i=\$((i+2)); continue ;;
        *) final+=("\${args[\$i]}"); i=\$((i+1)) ;;
      esac
    done
    exec "\$cmd" -h 127.0.0.1 -p $SHAPEDPORT "\${final[@]}" ;;
  *) exec "\$cmd" \${args[@]+"\${args[@]}"} ;;
esac
SHIM
  chmod +x "$WORK/bin/docker"

  # A temporary production.env, removed on exit. There is no real one to disturb.
  [ -f "$PROD_ENV" ] && mv -f "$PROD_ENV" "$PROD_ENV.drillbak"
  mkdir -p "$(dirname "$PROD_ENV")" "$WORK/backups"
  {
    echo "POSTGRES_PASSWORD=drill-not-a-real-password"
    echo "BACKUP_PASSPHRASE=$(openssl rand -hex 24)"
    echo "BACKUP_DIR=$WORK/backups"
    echo "BACKUP_RETENTION_DAYS=30"
  } > "$PROD_ENV"
  chmod 600 "$PROD_ENV"

  PATH="$WORK/bin:$PATH" "$ROOT/deploy/backup.sh" --verify >"$WORK/verify.log" 2>&1
  VSTATUS=$?
  [ "$VSTATUS" = "0" ] && ok "deploy/backup.sh --verify completed" \
                       || { bad "deploy/backup.sh --verify failed" "$(grep -iE 'error|refus|FATAL' "$WORK/verify.log" | head -1)"
                            [ -n "${DRILL_DEBUG:-}" ] && { echo "--- verify.log tail ---"; tail -20 "$WORK/verify.log"; }; }
  grep -q "preparing .* (platform roles, schemas, extensions)" "$WORK/verify.log" \
    && ok "it used the SHARED preparation, not the old extensions-only copy" \
    || bad "it did not run the shared preparation" "the wrappers have diverged again"
  grep -q "archive contains all 14 business tables and decodes cleanly" "$WORK/verify.log" \
    && ok "the production backup checks archive completeness too" || bad "no completeness check on the production path"
  grep -q "pg_dump (inside the db container, as supabase_admin)" "$WORK/verify.log" \
    && ok "the production backup dumps as the platform superuser" \
    || bad "the production backup did not dump as the admin role" "it would read no RLS-protected table"
  grep -qE '(pg_dump|pg_restore)[^|]*[<>] *"?\$WORK' "$ROOT/deploy/backup.sh" "$ROOT/deploy/restore.sh" \
    && bad "a dump still crosses an exec pipe" "that is what truncated the office server's archive" \
    || ok "no archive crosses an exec stream — both directions copy a file"
  grep -q "pg_restore exit=0, 0 error line(s)" "$WORK/verify.log" \
    && ok "pg_restore: exit 0, zero diagnostics" || bad "pg_restore reported errors" "$(grep 'pg_restore exit' "$WORK/verify.log" | head -1)"
  for n in "all 14 business tables present" "policies restored" "public, auth, storage and extensions all present" "search_crm() executes"; do
    grep -q "$n" "$WORK/verify.log" && ok "verification: $n" || bad "verification missing: $n"
  done
  grep -q "RESTORE VERIFIED" "$WORK/verify.log" \
    && ok "the backup is reported verified" || bad "no RESTORE VERIFIED line"
  [ "$(psql "$SH_ADMIN" -tAq -c "select count(*) from pg_database where datname like 'jsk_restore_check_%';" | tr -d ' ')" = "0" ] \
    && ok "the scratch database was dropped afterwards" || bad "a scratch database was left behind"
fi
echo

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
