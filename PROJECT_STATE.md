# JSK CRM — Project State

**Snapshot: 2026-08-23, updated after the `2a0d35b` production deployment.**
Operational facts only. Background, architecture and reasoning are in
`CLAUDE_HANDOFF.md`.

> **Where the deployment facts come from.** The `2a0d35b` deployment was run by
> the operator on the server and its outcome was reported to the assistant that
> wrote this file; the run's console output is not in this repository. Everything
> in the "Deployment of `2a0d35b`" table below is that report, recorded as
> given and not embellished — no timestamps, byte counts or log lines have been
> invented around it.
>
> Anything still marked **VERIFY ON SERVER** was not covered by that report. Run
> the command given and replace the value. Do not carry a guess forward.

---

## CURRENT PRODUCTION STATE

**Live and in daily use by employees.** Do not restart, redeploy or migrate
without a reason and a backup.

**Production is current.** It runs `2a0d35b` — the last commit that changes
behaviour. Everything after it on this branch is documentation only.

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
| **Deployed on production** | **`2a0d35b`** — `fix: the administrator runs the business, the owner controls the system` |
| Repository HEAD | ahead of production by **documentation-only** commits (`9f86f01` and later) |

Production is functionally current: `2a0d35b` is the newest commit that changes
application behaviour or schema. Confirm at any time with:

```bash
ssh <server> 'cd /opt/jsk-crm && git rev-parse --short HEAD && git log --oneline -1'
```

### Deployment of `2a0d35b` — as reported by the operator

| Step | Outcome |
|---|---|
| Verified backup, taken immediately **before** the migration | **succeeded** |
| Restore verification of that backup | **succeeded** |
| `git pull` — `2745e4f` → `2a0d35b` | **succeeded** |
| `deploy/migrate.sh` — migration `032` | **applied successfully** |
| Application image rebuild | **succeeded** |
| `deploy/health.sh` | **eventually HEALTHY** — see Known Issue 1 |
| `scripts/smoke.sh https://www.jskcrm.online` | **32 / 32 passed** |

Recent history, newest first:

```
9f86f01  docs: add the project handoff and current state                            docs only
2a0d35b  fix: the administrator runs the business, the owner controls the system   ► DEPLOYED
2745e4f  feat: edit and remove people in Settings → Organization                     deployed
c541cd0  fix: assemble the organization without PostgREST self-embedding             deployed
7bf50fd  feat: model the organization on the reporting line                          deployed
4f8374f  feat: bootstrap the first production owner                                  deployed
a2116c0  fix: finish container backup validation path                                deployed
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
| **Applied in production** | **`001` … `032`, all applied.** `032` applied successfully during the `2a0d35b` deployment |
| Tables in `public` | 14 |
| DELETE policies | exactly **1**, on `project_stakeholders` (ADR-004) |
| Admin role | `supabase_admin` — `postgres` is an ordinary role in this image |

```bash
ssh <server> 'cd /opt/jsk-crm && deploy/migrate.sh --status'
```

**Migration `032` is applied, so the ADMIN privilege escalation is closed.** An
administrator can no longer rewrite the `system_settings` business rules, mint a
second OWNER, or deactivate the real OWNER. Those three were reachable on the
live system before this migration, with a JWT and a PostgREST call and no
interface involved.

---

## OUTLET STATE

**One outlet exists in production** — confirmed by the verified backup taken
during the `2a0d35b` deployment.

| Branch | State |
|---|---|
| **Moolakarai Branch** | **ACTIVE** — the configured pilot outlet. The whole pilot is assigned here |
| **Chithode Branch** | **Not configured.** No row exists — it has not been created, not merely closed. Nobody is assigned to it and it appears in no selector |

Outlets are data — created at **Settings → Organization → Branches**, never
seeded, never hard-coded. When Chithode is eventually opened it is created there,
and `listAuthorizedOutlets()` starts offering it to whoever is assigned to it.

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

**15 rows in `public.users`** — confirmed by the verified backup taken during the
`2a0d35b` deployment.

That count is consistent with the target organisation being complete: fourteen
real people plus the **ADR-003 system actor** (`system@jsk-crm.internal`, an
inactive `ADMIN` that is never a person, never appears in a list, and can never
sign in). **Fourteen real accounts is an inference from the count, not something
the deployment report stated** — confirm the roster and the reporting line on the
screen before relying on it:

```
Settings → Organization → People
Settings → Organization → Reporting Structure
```

or read it directly:

```bash
ssh <server> 'cd /opt/jsk-crm && docker compose --env-file deploy/env/production.env \
  exec -T db psql -h 127.0.0.1 -U supabase_admin -d postgres -c \
  "select u.full_name, u.role, u.is_active, m.full_name as reports_to
     from public.users u left join public.users m on m.id = u.manager_id
    order by u.role, u.full_name;"'
```

Jay Khanted (OWNER) and Vinay Kumar Jain (ADMIN) are known to exist — Vinay's
inability to open Dashboard, Team and Reports is what prompted the ADR-042 work
that `2a0d35b` delivered.

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

**A verified backup was taken immediately before migration `032`, and its restore
verification succeeded** — the operator's deployment report. That is the most
recent restore proof on record for this system.

**VERIFY ON SERVER** — timers installed and firing, and a recent artifact
present:

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
| `2745e4f` | People Edit / Remove (deactivate) / Restore | ✔ |
| `2a0d35b` | ADMIN access fix + migration 032 owner/admin boundary | ✔ **current** |

---

## KNOWN ISSUES

**1. `deploy/start.sh` can report `UNHEALTHY` while the app is still starting.**
CURRENT, and seen on the `2a0d35b` deployment — the operator's report records the
application becoming healthy *eventually* rather than at once.

`start.sh` brings up `gateway app` with `up -d` and **no `--wait`** (unlike the
`db`/`auth`/`storage` steps, which use it), then runs `deploy/health.sh`
immediately. The app container's `HEALTHCHECK` has a 20 s `start-period`, so
`docker compose ps` shows `health: starting` while `health.sh` has already failed
its curl to `/api/health` and printed `UNHEALTHY`.

> **A race, not a fault.** Wait ~10 s and run `deploy/health.sh` again — it
> returns `HEALTHY`, which is what happened here. Do not roll back on the first
> reading. One-line fix when somebody wants it: add `--wait` to the
> `gateway app` line of `deploy/start.sh`.

**2. ADMIN writes no business data.** Deliberate (ADR-042): it reads everything
and administers people and branches, but archiving and reassigning stay with the
sales heads. Open for the business to decide; one predicate to change. **Raise it;
do not widen it quietly.**

**3. SPEC_AUDIT B-14 / B-15 open.** `/my-day` vs `/today` (two screens or one?),
and a self-contradicting bullet in the reporting-shape rules. Both implemented
under a stated reading, both awaiting the business owner.

**4. No staging environment.** One machine, live users.

**5. Playwright E2E is skipped** unless `E2E_SUPABASE_READY=1` with real
credentials — GoTrue cannot run in the development environment (ADR-018). The
authorization rules are proved in the integration suite instead.

### Closed by the `2a0d35b` deployment

- **ADMIN could not open Dashboard, Team or Reports** — the route guard admitted
  ADMIN while four service gates still refused it. Fixed.
- **ADMIN privilege escalation** — an administrator could rewrite every global
  business rule, mint a second OWNER and deactivate the real one. Closed by
  migration `032`, which is applied.

---

## CURRENT BUSINESS PILOT

**Moolakarai Branch only** — it is the one configured outlet, and every person in
the pilot is assigned to it. That single fact is why outlet scope could not be the
read rule and the reporting line had to be (ADR-040): three sales heads sharing
one branch would otherwise each see the other two's entire pipeline.

**Chithode Branch has not been configured for the pilot.** No outlet row exists
for it.

---

## IMMEDIATE NEXT TASK

`2a0d35b` is deployed and migration `032` is applied, so nothing is outstanding
that puts the live system at risk. What is left is confirmation and two open
questions.

1. **Confirm the organisation on screen.** Settings → Organization → Reporting
   Structure should match the tree above exactly. It is the authorization model
   drawn — a person in the wrong place is a person seeing the wrong pipeline.
   Then spot-check as Vinay (ADMIN): Dashboard, Team and Reports load, and
   `/settings` shows the Organization links but **not** the business-rules card.
2. **Confirm the backup timers are firing** — `systemctl list-timers 'jsk-crm*'`
   — and that a `.dump.enc` from last night exists. A backup nobody has restored
   is a guess; the one taken during this deployment was verified, so the
   mechanism is known good.
3. **Settle SPEC_AUDIT B-14 and B-15** with the business owner.
4. **Decide whether ADMIN should archive and reassign** (Known Issue 2).
5. **Optional, low risk:** add `--wait` to the `gateway app` line of
   `deploy/start.sh` so a deployment stops reporting `UNHEALTHY` before the app
   has finished starting (Known Issue 1).

---

## OWNERSHIP OF THIS REPOSITORY

**The Claude Code account reading this is intended to become the sole
development and maintenance AI for this repository.** No other assistant is
expected to be working on it in parallel.

That means the responsibilities below are yours and are not shared:

- **`CLAUDE.md` is the engineering contract**, not advice. Read it before writing
  code, and follow §19's working method — inspect, state what will change, write
  the migration, implement the service, implement the UI, write the RLS policy in
  the same phase as the table, write the tests, run the full suite, update
  `/docs/*`, summarise deviations.
- **Keep the documentation true.** `/docs/DECISIONS.md` records every
  architectural decision with its reasoning and the alternatives rejected;
  `/docs/SPEC_AUDIT.md` records every place the specification is silent or
  self-contradictory. An assumption that is not written down is a defect.
- **Keep this file and `CLAUDE_HANDOFF.md` current.** They are the state of a
  production system, and they are only worth anything if the next person can
  trust them. Update them when production changes — especially the deployed
  commit and the applied migration.
- **Nobody else is checking the security model.** RLS is the boundary; every
  change to it ships with an integration test written as the restricted role.
