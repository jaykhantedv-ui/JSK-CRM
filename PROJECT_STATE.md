# JSK CRM — Project State

**Snapshot: 2026-08-23.** Operational facts only. Background, architecture and
reasoning are in `CLAUDE_HANDOFF.md`.

> Anything below marked **VERIFY ON SERVER** could not be observed from the
> development environment. Run the command given and replace the value. Do not
> carry a guess forward.

---

## CURRENT PRODUCTION STATE

**Live and in daily use by employees.** Do not restart, redeploy or migrate
without a reason and a backup.

| | |
|---|---|
| Production URL | https://www.jskcrm.online |
| Server path | `/opt/jsk-crm` |
| GitHub | `jaykhantedv-ui/JSK-CRM` |
| Stack | Docker Compose — `db`, `auth`, `rest`, `storage`, `gateway`, `app`, `tunnel` |

---

## CURRENT GIT COMMIT

| | |
|---|---|
| **Repository HEAD** | `2a0d35bb60761852e8dc9fd2e33d6681bc97c30c` (`2a0d35b`) |
| **Deployed on production** | **VERIFY ON SERVER — it is NOT `2a0d35b`.** |

```bash
ssh <server> 'cd /opt/jsk-crm && git rev-parse --short HEAD && git log --oneline -1'
```

**What is known without the server:**

- `2a0d35b` (ADR-042, migration 032) has **not** been deployed. It was committed
  and pushed with an explicit instruction not to deploy.
- Production is somewhere in `c541cd0 … 2745e4f`. `c541cd0` is deployed or later:
  the People screen was reported working after that fix. Whether `2745e4f`
  (People Edit/Remove) is deployed was never confirmed.
- **Migration `032` is NOT applied to production.** `031` is — the organisation
  screens are live.

Recent history, newest first:

```
2a0d35b  fix: the administrator runs the business, the owner controls the system   NOT DEPLOYED
2745e4f  feat: edit and remove people in Settings → Organization                    unconfirmed
c541cd0  fix: assemble the organization without PostgREST self-embedding            deployed
7bf50fd  feat: model the organization on the reporting line                         deployed
4f8374f  feat: bootstrap the first production owner                                 deployed
a2116c0  fix: finish container backup validation path                               deployed
02de62e  fix: validate backups inside postgres container                            deployed
```

---

## CURRENT BRANCH

`claude/jsk-crm-final-completion-mr2e17` — the working branch **and** the branch
production is deployed from. There is no `main` deployment. Working tree clean.

---

## PRODUCTION URL

https://www.jskcrm.online — served through a Cloudflare Tunnel. HTTPS terminates
at Cloudflare's edge; nothing is exposed inbound on the VPS.

---

## DATABASE STATE

| | |
|---|---|
| Engine | PostgreSQL 15 — `supabase/postgres:15.8.1.060` |
| Volume | `db-data` (Docker named volume) |
| Reachable | `127.0.0.1:54322` on the host only |
| Migrations in repo | `001` … `032` |
| **Applied in production** | `001` … `031`. **`032` is PENDING.** **VERIFY ON SERVER.** |
| Tables in `public` | 14 |
| DELETE policies | exactly **1**, on `project_stakeholders` (ADR-004) |
| Admin role | `supabase_admin` — `postgres` is an ordinary role in this image |

```bash
ssh <server> 'cd /opt/jsk-crm && deploy/migrate.sh --status'
```

**Migration `032` closes a live privilege escalation.** Until it is applied, an
ADMIN can rewrite every `system_settings` business rule, mint a second OWNER, and
deactivate the real OWNER — with a JWT and a PostgREST call, no interface needed.

---

## OUTLET STATE

| Branch | State |
|---|---|
| **Moolakarai Branch** | **ACTIVE** — the whole pilot is assigned here |
| **Chithode Branch** | **Intentionally not configured.** Nobody assigned. Must not appear in a salesperson's branch selector. **VERIFY ON SERVER** whether the row exists-and-is-closed or does not exist yet |

Outlets are data — created at **Settings → Organization → Branches**, never
seeded, never hard-coded.

---

## USER / ROLE STATE

Roles: `SALESPERSON` · `MANAGER` · `OWNER` · `ADMIN`.
**The UI says "Sales Head" for `MANAGER`. It must never say "Manager".**

### Target organisation

```
Jay Khanted (OWNER)
  Vinay Kumar Jain (ADMIN)
    Pankaj      — Sales Head 1
      Revathi
    Jainendra   — Sales Head 2
      Thamarai · Ashokji · Deivanai · Kathirvel
    Dhanendran  — Sales Head 3
      Anandh · Ankur Tiwari · Sathya · Selvi
```

Sales heads report to the **ADMIN**, never directly to the OWNER.

### Who actually exists

**Jay Khanted (OWNER) and Vinay Kumar Jain (ADMIN) exist in production.** The rest
of the roster is **VERIFY ON SERVER** — open Settings → Organization → People, or:

```bash
ssh <server> 'cd /opt/jsk-crm && docker compose --env-file deploy/env/production.env \
  exec -T db psql -h 127.0.0.1 -U supabase_admin -d postgres -c \
  "select u.full_name, u.role, u.is_active, m.full_name as reports_to
     from public.users u left join public.users m on m.id = u.manager_id
    order by u.role, u.full_name;"'
```

People are created **in ladder order** — administrator, then sales heads, then
salespeople — because `guard_user_hierarchy()` checks the manager's role and
refuses somebody whose manager does not exist yet.

### Authorization

| | SALESPERSON | SALES HEAD | ADMIN | OWNER |
|---|---|---|---|---|
| Own records | ✔ | ✔ | ✔ | ✔ |
| Direct reports' records | — | ✔ | ✔ | ✔ |
| Every operational record | — | — | ✔ | ✔ |
| Dashboard · Team · Reports · Export | — | ✔ | ✔ | ✔ |
| Import · People · Branches | — | — | ✔ | ✔ |
| Archive · reassign · write records | own | ✔ | — | ✔ |
| Global `system_settings` | — | — | **—** | ✔ |
| Create/alter/deactivate an OWNER | — | — | **—** | ✔ |

> **OWNER** = full control. **ADMIN** = full operational access, no OWNER-only or
> global configuration control. **SALES HEAD** = their direct team.
> **SALESPERSON** = their own workspace.

### The rules that make it hold

- **`users.manager_id` defines the reporting hierarchy.**
- **`user_outlets` defines outlet assignment.**
- **A Sales Head is derived automatically from `manager_id`** — nobody is ever
  asked to pick one when creating a customer, opportunity or activity.
- **RLS remains the data-security boundary.** Every rule must hold against a
  direct PostgREST call with the user's own JWT.
- **UI hiding is not security.** A hidden button and a filtered list are not
  controls.
- **Normal application pages must never use service-role credentials to bypass
  RLS.** `lib/supabase/admin.ts` has three permitted callers in `src/` — the cron
  path, the import executor and user provisioning — enforced by an ESLint
  boundary rule, and `npm run check:bundle` proves the key never reaches the
  browser.

---

## BACKUP STATE

| | |
|---|---|
| Nightly backup | `deploy/backup.sh`, systemd timer `21:00` daily |
| Weekly verify | `deploy/backup.sh --verify`, systemd timer `Sun 22:00` |
| Location | `BACKUP_DIR` (default `/var/backups/jsk-crm`) + external drive if configured |
| Format | custom `pg_dump` inside the db container as `supabase_admin`, `aes-256-cbc` / pbkdf2 / 600k, sha256 sidecar |
| Verified | Yes — `--verify` restores into a scratch database and checks 14 tables, 42 policies, FKs, indexes, row counts, extensions, `search_crm()` and **zero** pg_restore diagnostics |
| Passphrase | `BACKUP_PASSPHRASE` in `deploy/env/production.env` **and the business safe. Lose it and every backup is unreadable.** |

**VERIFY ON SERVER** — timers installed and a recent artifact present:

```bash
ssh <server> "systemctl list-timers 'jsk-crm*' && ls -lt /var/backups/jsk-crm/ | head"
```

---

## CLOUDFLARE STATE

Cloudflare Tunnel (`cloudflared`), outbound only — nothing inbound is exposed and
no router configuration exists. Compose **profile `tunnel`**, started only by
`deploy/start.sh --tunnel`. Token in `CLOUDFLARE_TUNNEL_TOKEN`, passed as
`TUNNEL_TOKEN` so it stays out of `docker inspect`.

Assumed running, since https://www.jskcrm.online serves. **VERIFY ON SERVER:**

```bash
ssh <server> 'cd /opt/jsk-crm && docker compose --env-file deploy/env/production.env ps tunnel'
```

---

## RECENT DEPLOYMENTS

| Commit | What it delivered | Deployed |
|---|---|---|
| `4f8374f` | Owner bootstrap — the deployment could not be signed into before it | ✔ |
| `7bf50fd` | Organisation on the reporting line; `manager_id`; migration 031 | ✔ |
| `c541cd0` | PostgREST self-reference workaround — both org screens were dead | ✔ |
| `2745e4f` | People Edit / Remove (deactivate) / Restore | unconfirmed |
| `2a0d35b` | ADMIN access fix + migration 032 owner/admin boundary | **✘ not deployed** |

---

## KNOWN ISSUES

**1. ADMIN cannot open Dashboard, Team or Reports (fixed in `2a0d35b`, not
deployed).** Route guard admits ADMIN, four service gates still refused it →
generic Server Components error.

**2. ADMIN privilege escalation is LIVE until `032` is applied.** An ADMIN can
change every global business rule, mint a second OWNER, and deactivate the real
OWNER. Reproduced as plain SQL; no interface needed. **This is the reason to
deploy.**

**3. `deploy/start.sh` can report `UNHEALTHY` while the app is still starting.**
CURRENT. `start.sh` brings up `gateway app` with `up -d` and **no `--wait`**, then
runs `deploy/health.sh` immediately. The app's `HEALTHCHECK` has a 20 s
`start-period`, so `docker compose ps` shows `health: starting` while `health.sh`
has already failed its curl and printed `UNHEALTHY`.

> **A race, not a fault.** Wait ~10 s, run `deploy/health.sh` again — it returns
> `HEALTHY`. Do not roll back on the first reading. One-line fix when wanted:
> add `--wait` to the `gateway app` line of `deploy/start.sh`.

**4. ADMIN writes no business data.** Deliberate (ADR-042): it reads everything
and administers people and branches, but archiving and reassigning stay with the
sales heads. Open for the business to decide; one predicate to change.

**5. SPEC_AUDIT B-14 / B-15 open.** `/my-day` vs `/today` (two screens or one?),
and a self-contradicting bullet in the reporting-shape rules. Both implemented
under a stated reading, both awaiting the business owner.

**6. No staging environment.** One machine, live users.

**7. Playwright E2E is skipped** unless `E2E_SUPABASE_READY=1` with real
credentials — GoTrue cannot run in the development environment (ADR-018). The
authorization rules are proved in the integration suite instead.

---

## CURRENT BUSINESS PILOT

**Moolakarai Branch only.** All fourteen people — owner, administrator, three
sales heads, nine salespeople — work out of that one branch, which is exactly why
outlet scope could not be the read rule and the reporting line had to be
(ADR-040).

**Chithode Branch is intentionally not configured.** Not staffed, not assigned,
and not offered in any salesperson's selector.

---

## IMMEDIATE NEXT TASK

**Deploy `2a0d35b`.** It closes the live privilege escalation in issue 2 and fixes
the ADMIN pages in issue 1. It carries migration `032`, so back up first.

```bash
cd /opt/jsk-crm
deploy/backup.sh --verify          # backup AND prove it restores — do not skip
git pull
deploy/migrate.sh --status         # expect 032 pending, 001–031 applied
deploy/migrate.sh                  # applies 032 only, in one transaction
deploy/start.sh --build            # add --tunnel if the tunnel is not running
deploy/health.sh                   # UNHEALTHY on the first read? see issue 3
deploy/db-credentials.sh --test
scripts/smoke.sh https://www.jskcrm.online
```

Then sign in as Vinay (ADMIN) and confirm: Dashboard, Team and Reports load;
`/settings` shows the Organization links but **not** the business-rules card.

Afterwards: create the remaining team members in ladder order, and check
Settings → Organization → Reporting Structure against the tree above.
