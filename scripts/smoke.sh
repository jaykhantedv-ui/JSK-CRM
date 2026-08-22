#!/usr/bin/env bash
#
# Post-deployment smoke test (§21, §22).
#
# Deliberately small and deliberately unauthenticated. Its job is to answer one
# question — "did this deployment come up as the thing we think we deployed?" —
# in the seconds after a release, without credentials and without touching
# business data. The exhaustive checks live in the test suites; this catches the
# deployment-shaped failures those cannot see: a missing environment variable, a
# middleware that stopped protecting routes, headers that vanished with a config
# change, a cron route that started answering 200 to anyone.
#
#   scripts/smoke.sh https://crm.example.com
#   CRON_SECRET=... scripts/smoke.sh https://crm.example.com   # also runs a real cron call
set -uo pipefail

BASE="${1:?usage: scripts/smoke.sh <base-url>}"
BASE="${BASE%/}"
PASS=0
FAIL=0

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n     %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }

code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
hdrs() { curl -sS -o /dev/null -D - --max-time 20 "$@"; }
body() { curl -sS --max-time 20 "$@"; }

echo "Smoke test: $BASE"
echo

echo "Reachability"
STATUS=$(code "$BASE/login")
[ "$STATUS" = "200" ] && ok "/login answers 200" || bad "/login answers 200" "got $STATUS"

echo
echo "Security headers (§23)"
H=$(hdrs "$BASE/login")
check_header() {
  local name="$1" want="$2"
  local got
  got=$(echo "$H" | grep -i "^$name:" | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//')
  if [ -z "$got" ]; then bad "$name present" "header absent"
  elif [ -n "$want" ] && ! echo "$got" | grep -qi -- "$want"; then bad "$name contains '$want'" "got '$got'"
  else ok "$name: $got"; fi
}
check_header 'X-Frame-Options' 'DENY'
check_header 'X-Content-Type-Options' 'nosniff'
check_header 'Content-Security-Policy' "frame-ancestors 'none'"
check_header 'Referrer-Policy' ''
check_header 'Permissions-Policy' ''
if [[ "$BASE" == https://* ]]; then
  check_header 'Strict-Transport-Security' 'max-age='
else
  echo "  SKIP  Strict-Transport-Security (only meaningful over https)"
fi

# The framework version is free reconnaissance.
if echo "$H" | grep -qi '^x-powered-by:'; then bad "X-Powered-By absent" "header is present"
else ok "X-Powered-By absent"; fi

# The CSP must carry a real per-request nonce, and the page's own scripts must
# carry the same one. A nonce in the header that no script matches is a policy
# that blocks the entire application while passing every header check.
N1=$(hdrs "$BASE/login" | grep -i '^content-security-policy:' | grep -o "nonce-[^']*" | sed 's/nonce-//')
N2=$(hdrs "$BASE/login" | grep -i '^content-security-policy:' | grep -o "nonce-[^']*" | sed 's/nonce-//')
if [ -z "$N1" ]; then bad "CSP carries a nonce" "no nonce in the policy"
elif [ "$N1" = "$N2" ]; then bad "CSP nonce is per-request" "two requests shared the nonce '$N1'"
else ok "CSP nonce is fresh per request"; fi

PAGE=$(body "$BASE/login")
HDR_NONCE=$(echo "$PAGE" | grep -o 'nonce="[^"]*"' | head -1 | sed 's/nonce="//;s/"//')
if [ -z "$HDR_NONCE" ]; then bad "page scripts carry the nonce" "no nonce attribute in the HTML"
else ok "page scripts carry a nonce"; fi

echo
echo "Authorization boundary (§9, §24)"
for path in /today /dashboard /accounts /settings /team /reports; do
  LOC=$(hdrs "$BASE$path" | grep -i '^location:' | tr -d '\r' | sed 's/^[Ll]ocation: *//')
  # Next.js parses the Location header back into a URL and rejects a relative one,
  # so middleware always answers with an absolute address. What matters is the
  # PATH, and that the origin is the one the browser used — which is what
  # `requestOrigin` in src/middleware.ts reconstructs from Host.
  case "$LOC" in
    /login\?*|/login) ok "$path redirects an anonymous visitor to /login" ;;
    "$BASE"/login\?*|"$BASE"/login) ok "$path redirects an anonymous visitor to /login" ;;
    *://*/login\?*|*://*/login) ok "$path redirects an anonymous visitor to /login" ;;
    *) bad "$path redirects to /login" "Location: '${LOC:-<none>}'" ;;
  esac
done

# An API route answers with a status, never with the login page (ADR-024).
for path in /api/export/opportunities /api/export/accounts; do
  S=$(code "$BASE$path")
  B=$(body "$BASE$path" | head -c 200)
  if [ "$S" = "401" ] && echo "$B" | grep -q '^{'; then ok "$path → 401 JSON"
  else bad "$path → 401 JSON" "got $S with body: $(echo "$B" | head -c 80)"; fi
done

echo
echo "Cron authentication (§12, §14.7)"
for job in new-opportunity-sla daily-digest manager-digest owner-summary maintenance; do
  S=$(code "$BASE/api/cron/$job")
  B=$(body "$BASE/api/cron/$job" | head -c 120)
  if [ "$S" = "401" ] && echo "$B" | grep -q '^{'; then ok "/api/cron/$job refuses an unauthenticated call (401 JSON)"
  else bad "/api/cron/$job → 401 JSON" "got $S with body: $(echo "$B" | head -c 80)"; fi
done

S=$(code -H 'Authorization: Bearer definitely-not-the-secret' "$BASE/api/cron/maintenance")
[ "$S" = "401" ] && ok "a wrong CRON_SECRET is refused" || bad "wrong CRON_SECRET refused" "got $S"

if [ -n "${CRON_SECRET:-}" ]; then
  R=$(body -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/cron/owner-summary")
  if echo "$R" | grep -q '"processed"' && echo "$R" | grep -q '"durationMs"'; then
    ok "a correct CRON_SECRET runs the job and returns the documented shape"
  else
    bad "correct CRON_SECRET returns { processed, sent, failed, durationMs }" "got: $(echo "$R" | head -c 120)"
  fi
else
  echo "  SKIP  authenticated cron call (set CRON_SECRET to include it)"
fi

echo
echo "Nothing leaks (§29, §31)"
if echo "$PAGE" | grep -qiE 'service_role|SUPABASE_SERVICE_ROLE|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.'; then
  bad "no service-role key or JWT in the HTML" "a key-shaped string is present"
else ok "no service-role key or JWT in the HTML"; fi

if echo "$PAGE" | grep -qiE 'at [A-Za-z]+ \(/|node_modules/|PostgresError|pg_catalog|ECONNREFUSED'; then
  bad "no stack trace or database internals in the HTML" "internals are present"
else ok "no stack trace or database internals in the HTML"; fi

# §2.4 / CLAUDE.md §4 — the word is banned from the product surface.
if echo "$PAGE" | grep -qi '>[^<]*revenue'; then
  bad "the word 'Revenue' does not appear in the UI" "found on /login"
else ok "the word 'Revenue' does not appear"; fi

echo
echo "──────────────────────────────────────────"
printf 'passed %d, failed %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
