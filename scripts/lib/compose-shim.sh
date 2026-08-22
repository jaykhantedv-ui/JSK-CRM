# A stand-in for `docker` that runs the deploy scripts against a local PostgreSQL.
# Sourced by the deployment regression tests, not run.
#
# The Supabase container images cannot be pulled in every environment, so the
# tests substitute the TRANSPORT and nothing else: the real deploy/backup.sh,
# deploy/restore.sh and deploy/migrate.sh execute, and only
# `docker compose exec -T db <cmd>` and `docker compose cp` are turned into local
# equivalents. Both tests need it, so it lives in one file.

# write_compose_shim <bin-directory> <postgres-port> [postgres-bin-directory]
#
# The emulated container resolves its binaries through the third argument when it
# is given. That matters for the no-client-tools test: the HOST must be able to
# lack pg_restore on PATH while the stand-in container still has it, which is
# exactly the office server's situation.
write_compose_shim() {
  local dir="$1" port="$2" pgbin="${3:-}"
  mkdir -p "$dir"
  cat > "$dir/docker" <<SHIM
#!/usr/bin/env bash
# Translates:
#   compose exec -T db <cmd> <args>   -> <cmd> against 127.0.0.1:${port}
#   compose cp db:<src> <dest>        -> cp <src> <dest>
#   compose cp <src> db:<dest>        -> cp <src> <dest>
# Anything else succeeds silently.
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
  exec cp -f "\${args[0]#db:}" "\${args[1]#db:}"
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
    [ -n "${pgbin}" ] && export PATH="${pgbin}:\$PATH"
    exec "\$cmd" -h 127.0.0.1 -p ${port} \${final[@]+"\${final[@]}"} ;;
  *) [ -n "${pgbin}" ] && export PATH="${pgbin}:\$PATH"
     exec "\$cmd" \${args[@]+"\${args[@]}"} ;;
esac
SHIM
  chmod +x "$dir/docker"
}
