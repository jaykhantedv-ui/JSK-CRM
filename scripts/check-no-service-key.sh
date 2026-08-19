#!/usr/bin/env bash
# The service-role key must never reach a client bundle (§15.7, §19.4).
#
# `lib/supabase/admin.ts` has a runtime browser guard and an ESLint import
# restriction. This is the third control: proof, against the actual build output,
# that neither the key nor a reference to its variable was bundled for the
# browser. Run it after `npm run build`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT/.next/static"

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "No build output at $BUNDLE_DIR. Run 'npm run build' first." >&2
  exit 1
fi

fail=0

# The variable name. Its presence means the module reached the client graph.
if grep -rqI "SUPABASE_SERVICE_ROLE_KEY" "$BUNDLE_DIR"; then
  echo "FAIL: SUPABASE_SERVICE_ROLE_KEY is referenced in the client bundle." >&2
  fail=1
fi

# The key's own value, when one is set in the environment running this check.
if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] &&
   grep -rqIF "$SUPABASE_SERVICE_ROLE_KEY" "$BUNDLE_DIR"; then
  echo "FAIL: the service-role key VALUE is present in the client bundle." >&2
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: no service-role key or reference in $BUNDLE_DIR"
fi
exit "$fail"
