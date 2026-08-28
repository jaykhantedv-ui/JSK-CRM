# Runbook

The commands the business and its developer actually need. Everything here is
either safe to run against production or says loudly that it is not.

For *why* any of it is shaped this way, see `/docs/DEPLOYMENT.md`. For what is
still blocked on external credentials, see §0 of that file.

---

## Every day

Nothing. The five cron jobs run themselves and the digests arrive by email.

If a digest does not arrive, start at **Cron** below — the job failing is far
likelier than the mail failing.

---

## Deploy

Deployment is `.github/workflows/deploy.yml`, triggered by a push to `main` or by
**Actions → Deploy → Run workflow**. It runs the §21 sequence and stops at the
production gate until a reviewer approves.

```bash
git push origin main          # or run the workflow by hand from the Actions tab
```

Never `vercel --prod` from a laptop: it skips the tests, the staging verification
and the pre-migration backup.

**Watch:** Actions → Deploy. The two `smoke test` steps are the ones that matter;
a green deploy with a red smoke test is a bad deploy.

---

## Migrate

> **On the office server the migrations run as `supabase_admin`.** They create
> extensions, install functions the API roles execute and grant across platform
> schemas — superuser work — and `postgres` is an ordinary role in that image.
> `deploy/migrate.sh` resolves the same administrative path the restore and the
> credential alignment use, and refuses to start if that role is not a superuser.
> Each migration commits with its ledger row or not at all, and the row is read
> back afterwards as proof that both landed.

Migrations are applied **only** by the deploy pipeline. Not from a laptop, and
never through the Supabase dashboard SQL editor — a hand-applied change is
invisible to the migration ledger, and the next deployment will either fail or
quietly disagree with it.

To add one:

```bash
# 1. Write it. Next number in sequence, never edit an applied file.
$EDITOR supabase/migrations/030_what_it_does.sql

# 2. Apply locally and regenerate the types it changes.
npm run db:reset
npm run db:types:nodocker      # or: npm run db:types  (needs Docker)

# 3. Prove it before pushing.
npm run verify                 # typecheck · lint · unit · integration · build · bundle
```

To see what production has applied:

```bash
npx supabase link --project-ref "$SUPABASE_PRODUCTION_REF"
npx supabase migration list --linked
```

---

## Backup

Weekly, automatically, from `.github/workflows/backup.yml` — 00:00 IST Monday.

**On demand** (before a risky change, say):
Actions → *Weekly backup* → Run workflow → label it, e.g. `pre-import`.

**From a machine with the credentials:**

```bash
export DATABASE_URL='<read-capable production URL>'
export BACKUP_PASSPHRASE='<from the safe>'
export AWS_REGION=ap-south-1
export BACKUP_DEST="s3://$AWS_BACKUP_BUCKET/database"
scripts/backup.sh pre-import
```

`backup.sh` refuses any region other than `ap-south-1`, refuses a passphrase under
20 characters, refuses to publish a dump under 4 KB, and decrypts the archive back
and compares it to the dump before uploading.

**The passphrase is the whole thing.** It is not recoverable from AWS, from
Supabase, or from this repository. Safe, password manager, and one printed copy.

---

## Restore

```bash
aws s3 ls s3://$AWS_BACKUP_BUCKET/database/ --region ap-south-1

export BACKUP_PASSPHRASE='<from the safe>'
export RESTORE_DATABASE_URL='postgresql://…/a_scratch_database'
scripts/restore.sh s3://$AWS_BACKUP_BUCKET/database/jsk-crm-<stamp>-scheduled.dump.enc
```

It verifies the checksum, decrypts, **prepares the target** (see below), restores,
and then runs `scripts/verify-restore.sql`, which fails unless the tables, the
relationships, the settings, RLS **and its policies**, the platform schemas and
`search_crm()` all come back.

### Who takes the backup, and why it is not `postgres`

**`supabase_admin` dumps; `postgres` cannot.** `pg_dump` issues
`SET row_security = off`, and that fails for any role which neither owns the table
nor holds `BYPASSRLS`. In the Supabase image `postgres` is an ordinary role — not a
superuser, not `BYPASSRLS` — so the moment the CRM tables are owned by anything
else it can read **none** of them. Every business table comes back with no rows and
the archive restores an empty database. That is what the office server produced,
and what the completeness guard refused to publish.

Granting `pg_read_all_data` does not help: privileges are not the obstacle, RLS is.
The fix is the role that is *meant* to read the whole database for recovery, which
is the platform superuser this deployment already uses for administration
(`deploy/lib/db-admin.sh`).

**Nothing about RLS changed to make this work.** No policy was altered, none was
disabled, and no application role gained a privilege — `authenticator`,
`supabase_auth_admin` and `supabase_storage_admin` connect exactly as before. Only
the backup, an administrative operation, uses an administrative role.

`scripts/backup.sh` takes its connection from `DATABASE_URL`, so give it an
administrative role too. If you do not, the guard refuses the archive rather than
publishing an empty one.

### The office server needs no PostgreSQL client tools

Reading a custom-format archive needs `pg_restore`, and the server has none
installed — nor should it, when a container with the exact matching version is
already running. The validator used to call `pg_restore` on the host and exited
**127, `command not found`**, immediately after the dump: a healthy archive
refused because nothing could open it.

`deploy/backup.sh` now inspects **inside the db container**. The archive goes in as
a file, the table of contents comes back as a file, and only `sh -c` and an exit
status cross the exec stream. `scripts/backup.sh` still uses whatever `pg_restore`
is on the machine it runs on, which is right for CI and a laptop; if there is none
it now says so by name instead of exiting 127.

The three-way diagnosis and the fourteen-table check are shared — one validator,
two transports (`ARCHIVE_INSPECT=host|container`).

### Reading a backup log, and what exit 127 means now

`deploy/backup.sh` prints which transport it used, immediately after the dump:

```
--- pg_dump (inside the db container, as supabase_admin)
--- dumped 224934 bytes
--- validating the archive inside the db container (no host client tools needed)
--- archive contains all 14 business tables and decodes cleanly
```

**That third line is also a version marker.** If a log goes straight from
`--- dumped N bytes` to a failure without it, the checkout on that machine predates
the container transport — `git log --oneline -1` on the server before anything else
is diagnosed.

Exit 127 is `command not found`, and a bare 127 names nothing. Both backup scripts
now say what is missing before they start:

- `require_commands` lists **every** absent command by name — `missing on this host,
  needed for the backup: …`. Note what is *not* in that list: `pg_dump`,
  `pg_restore` and `psql`. This host is never expected to have PostgreSQL client
  tools, so if one of those is ever named, something is using the wrong path.
- `require_container_commands` does the same for the db **container**, which is
  where those three must exist.
- An `ERR` trap prints `` FAILED: `cmd` exited 127 (line N) `` for anything that
  slips through, so the failing command is always named.

`scripts/test-restore-drill.sh` runs the real `deploy/backup.sh --verify` on a host
where every PostgreSQL client binary exits 127, and asserts that a complete archive
still validates, that an unreadable one and a readable-but-incomplete one are each
diagnosed correctly, and that not one host binary was invoked. It also scans the
deploy scripts for a client binary in command position outside
`docker compose exec -T db` — and proves that scan catches an injected one.

### The dump is copied out as a file, never piped

`docker compose exec` multiplexes stdout, and a custom-format dump is large and
binary. Piping one through it truncated a ~220 KB archive to **95,811 bytes** on the
office server. A custom archive keeps its table of contents at the *end*, so what
survived could not be read at all — and because the old checker looked for
per-table entries first, it reported every business table missing and blamed the
dumping role. The byte count was the tell: a schema-only dump of this database is
212 KB, so 95 KB was never "schema without data", it was cut off.

Both directions now move a **file** — `pg_dump --file=` inside the container then
`docker compose cp` out, and `docker compose cp` in before `pg_restore`. There is no
stream framing to lose bytes to, and pg_dump's own exit status is observed directly.

If a backup ever fails again, the message says which of the three it is:

| Message | Meaning |
|---|---|
| `The archive cannot be read — truncated or corrupt` | a **transport** fault; nothing to do with roles |
| `The archive lists cleanly but does not decode` | data blocks missing |
| `readable but incomplete — no TABLE DATA for: …` | the **dumping role** could not read those tables |

### Two wrappers, one preparation

There are two restore entry points, and they do the same job for different callers:

| | Used by | Talks to the database via |
|---|---|---|
| `scripts/restore.sh` | the off-site copy, CI, a laptop | `RESTORE_DATABASE_URL` |
| `deploy/restore.sh` | **the office server**, and `deploy/backup.sh --verify` | `docker compose exec db` |

Both run **`scripts/restore-prepare.sql`** and both verify with
**`scripts/verify-restore.sql`**. That is deliberate and it matters: `deploy/`
previously kept its own copy of the preparation, so a fix to `scripts/` never
reached the path the server actually runs every night, and the drill kept failing
with `schema "storage" does not exist` after the fix was already in the repository.
If you change what a restore needs, change `scripts/restore-prepare.sql` — nothing
else has a list.

The same applies to the two backup entry points: `scripts/backup.sh` and
`deploy/backup.sh` both source `scripts/lib/backup-archive.sh`, which owns the list
of business tables an archive must contain before it may be published.

### What the target has to have before pg_restore runs

The archive is schema-filtered and `pg_dump` never dumps roles, so three things the
CRM depends on are simply not in it. `scripts/restore-prepare.sql` creates them —
that is the whole of the preparation step, and skipping any part of it produces a
restore that reports success and is not a usable database:

| Missing from the archive | What it looks like if absent |
|---|---|
| `pg_trgm`, `pgcrypto` in `extensions` | trigram indexes vanish, `search_crm()` raises on every call |
| `auth`, `storage` schemas | `schema "storage" does not exist`; with `--clean --if-exists` the DROPs fail too, because `IF EXISTS` tolerates a missing table but not a missing schema |
| roles `anon`, `authenticated`, `service_role`, … | **every `CREATE POLICY` fails** with `role "authenticated" does not exist` — 45 of them. Tables and rows come back, RLS reads as on, and not one policy exists |

That last one is the dangerous one: a table with RLS enabled and no policy denies
everything, so the restore looks complete and the database is unusable. Errors are
never suppressed to get past it — `scripts/test-restore-drill.sh` asserts
`pg_restore` reports **zero** diagnostics, and compares tables, policies, foreign
keys, indexes and every table's row count against the source.

**It refuses a target whose URL contains `prod`.** During a real recovery, and
only then:

```bash
ALLOW_PRODUCTION_RESTORE=I-UNDERSTAND scripts/restore.sh …
```

Drill it once a quarter. `backup.yml` does this automatically on its scheduled
runs; the record of the last manual drill is in `/docs/DEPLOYMENT.md` §7.4.

---

## Logs

| What | Where |
|---|---|
| Application, SSR, Server Actions | Vercel → Project → Logs (filter by route) |
| A specific cron run | Vercel → Logs → filter path `/api/cron/` |
| Cron scheduling itself | Vercel → Project → Cron Jobs |
| Database, slow queries, connections | Supabase → Project → Logs & Reports |
| Auth: sign-ins, failures, rate limiting | Supabase → Authentication → Logs |
| Email delivery, bounces | Resend → Emails |
| CI, deploys, backups | GitHub → Actions |

Nothing sensitive is logged by the application: services throw a typed
`AppError`, and a raw Postgres error never reaches a user or a log line (§16.2).

---

## Cron verification

Five routes. Each authenticates by `CRON_SECRET` alone — `/api/cron/*` is exempt
from the session middleware, because answering a scheduler with a redirect to
`/login` returns **200 and a page of HTML**, which reads as a successful run and
would hide a broken job indefinitely.

```bash
# Correct secret — runs the job.
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/daily-digest

# No secret — must be 401 JSON, never a redirect.
curl -i https://<host>/api/cron/daily-digest
```

Every route answers `{ processed, sent, failed, durationMs }`. A job that throws
answers the same shape with `failed: 1` and HTTP 500 — never a stack trace.

`owner-summary` returning `{ processed: 0, sent: 0, failed: 0 }` is **a success**,
not an error: it fires hourly and gates in-route against the owner's configured
IST hour (ADR-011), so twenty-three runs a day correctly send nothing.

All five at once, plus the headers and the authorization boundary:

```bash
CRON_SECRET=… scripts/smoke.sh https://<host>
```

| Job | IST | UTC cron |
|---|---|---|
| `new-opportunity-sla` | hourly | `0 * * * *` |
| `daily-digest` | 08:30 | `0 3 * * *` |
| `manager-digest` | 09:00 | `30 3 * * *` |
| `owner-summary` | per settings | `0 * * * *` + in-route gate |
| `maintenance` | 02:00 | `30 20 * * *` (previous day, UTC) |

---

## Health checks

```bash
scripts/smoke.sh https://<host>                      # 27 checks, no credentials needed
psql "$DATABASE_URL" -f scripts/data-quality.sql     # read-only; never mutates
```

`data-quality.sql` reports orphans, invalid owner and outlet references, duplicate
primary stakeholders, malformed settings, impossible won/lost states, archived
records leaking into live calculations, and gaps in the audit trail. **Any
non-zero row is a conversation with the owner, never a row to quietly `UPDATE`.**

---

## When something is wrong

| Symptom | First look |
|---|---|
| Nobody can sign in | Supabase → Authentication → Logs. Then: is the project paused? |
| One person cannot sign in | Are they `is_active`? A deactivated user loses access at the database boundary within the hour, by design |
| A salesperson sees nothing | Their outlet scope in `/settings` → Users. A manager with no outlets sees only their own records — that is deliberate (ADR-016) |
| A manager sees another outlet | Stop and treat it as a security incident. Capture the user, the outlet and the screen, then run the RLS suite against a restored copy |
| Digests stopped | `curl` the route with the secret. Then Resend → Emails. `RESEND_API_KEY` **and** `RESEND_FROM_EMAIL` must both be set or nothing sends |
| A screen is slow | `/docs/DEPLOYMENT.md` §7A, then EXPLAIN the query as the affected role — RLS cost is invisible when you test as `postgres` |
| A file will not upload | Over 10 MB, or the magic bytes do not match the extension. Both are deliberate refusals |
| A bad import landed | Roll the batch back from `/import` while it is still eligible. Rollback refuses after a legitimate edit, on purpose |
| `password authentication failed for user "authenticator"` / `"supabase_auth_admin"` / `"supabase_storage_admin"` — while `db` is healthy | The service-role passwords are not the superuser's, or are stored in the wrong scheme. Run `deploy/db-credentials.sh`, then `deploy/start.sh`. See `DEPLOYMENT.md` §10.4 |
| The same, but `psql` **inside the db container** succeeds | That proves nothing — loopback is `trust` there. Run `deploy/db-credentials.sh --test`, which logs in from another container over the network. A role reported without a `SCRAM-SHA-256` verifier is the cause |

---

## The office server (ADR-033)

Everything above describes the hosted deployment. On the office PC — or a VPS such
as Hostinger, which behaves identically — the commands are these. Full instructions:
[`DEPLOYMENT.md`](DEPLOYMENT.md) §10.

### First run, from nothing

```bash
git clone <repo-url> /opt/jsk-crm && cd /opt/jsk-crm

cp deploy/env/production.env.example deploy/env/production.env
deploy/keygen.sh >> deploy/env/production.env   # secrets; print BACKUP_PASSPHRASE
$EDITOR deploy/env/production.env               # set PUBLIC_URL / PUBLIC_SUPABASE_URL

deploy/start.sh --build                         # LOCAL mode — no Cloudflare needed
deploy/health.sh                                # expect HEALTHY
scripts/smoke.sh http://localhost               # end-to-end check (the PUBLIC_URL)

deploy/bootstrap-owner.sh \
  --email owner@example.com --name 'Full Name' --confirm-production
```

**Do not skip the last line.** A healthy stack with no OWNER is a CRM nobody can
sign in to — see below.

`deploy/start.sh --tunnel` adds remote access and is the **only** thing that needs a
Cloudflare token; without `--tunnel` nothing about the stack requires Cloudflare, and
`--tunnel` with no token in the env file refuses before Docker is touched. Resend and
AWS are optional everywhere: unset, digests do not send and backups stay on disk.

```bash
cd /opt/jsk-crm

deploy/start.sh            # start everything (safe to re-run)
deploy/start.sh --build    # rebuild the app image first, after a git pull
deploy/start.sh --tunnel   # also bring up the Cloudflare tunnel
deploy/stop.sh             # stop the containers, keep the data

deploy/health.sh           # app, database, restart-loops, disk, backup freshness
deploy/migrate.sh --status # what is applied, what is pending
```

### Nobody can sign in — there is no OWNER yet

The symptom is a working login page that rejects every address, on a deployment
where everything else reports healthy. Confirm it in one command:

```bash
deploy/bootstrap-owner.sh --status
# no active OWNER — this deployment still needs the one-time bootstrap
```

It is not a fault. There is no self-registration in any environment (§3.2), the
production seed creates no users on purpose, and users are created by an OWNER at
Settings → Users — so the first owner cannot be made from inside the application.
`deploy/bootstrap-owner.sh` is the only way out of that, and it runs **once**:

```bash
deploy/bootstrap-owner.sh \
  --email owner@example.com --name 'Full Name' --confirm-production
```

It names the deployment and waits for `BOOTSTRAP-OWNER` to be typed, then prints a
generated password once. **Sign in, change it, clear the scrollback** — that
password is stored nowhere else. Use `--password-stdin` to type your own instead;
`--password` on the command line is refused, because arguments are visible in `ps`
and land in the shell history.

Re-running it is safe. Once an active OWNER exists it stops with exit `3` and
changes nothing:

```
This deployment already has an active OWNER: owner@example.com
```

| Situation | What to do |
|---|---|
| No owner yet | run it — this is what it is for |
| The owner exists but forgot their password | an ADMIN resets it at Settings → Users. Do **not** run this again |
| The only owner was deactivated by mistake | run it: a deactivated owner cannot sign in, so it does not block the bootstrap. Reactivate the original afterwards |
| A second owner is wanted | Settings → Users, as the first owner. Never here |

Full procedure and exit codes: `/docs/DEPLOYMENT.md` §10.6. Design and the reason
this is a script rather than a first-run web page: ADR-039.

### Correcting or removing somebody

```
Settings → Organization → People → Edit
```

Name, role, sales head, branches and status, on one form. Saving is an UPDATE
keyed on the person's id — it cannot produce a second row for them, whatever the
form is submitted with. The reporting line is re-validated on save, so an edit
that would break the ladder is refused with the reason rather than half-applied.

Email is deliberately not editable there: it is the Auth account's identity, and
changing it on the profile alone would leave the sign-in and the record
disagreeing about who somebody is.

**"Remove" deactivates. It is not a delete, and there is no delete.**

| | |
|---|---|
| What it does | `is_active = false` |
| What that closes | `current_user_id()` filters on `is_active`, so every policy in the schema resolves to nothing for them — no sign-in, no visibility, no appearance in any list |
| What it keeps | every customer, opportunity, activity and audit row they created, still attributed to them |
| Undo | Restore, on the same row |

`users` has **no DELETE policy for any role, including the owner**, and that is
deliberate rather than missing: `accounts.owner_id` and
`opportunity_events.actor_id` both reference this table, so deleting a person
either takes their work with them or orphans it (§8.8, CLAUDE.md §11).

Nobody can remove themselves — the last owner locking themselves out of their own
deployment is not a recoverable mistake. The button is not offered on your own
row and the service refuses it regardless.

### Somebody sees the wrong pipeline

Almost always the reporting line, not a policy. A **Sales Head** reads their own
records and their **direct reports'** — never their branch, and never another
sales head's team (ADR-040).

```
Settings → Organization → Reporting Structure
```

That tree IS the authorization model. Read it back against who should be seeing
what; a person under the wrong sales head is a person seeing the wrong pipeline,
and moving them on the **People** tab moves their work with them immediately.

| Symptom | Cause | Fix |
|---|---|---|
| A sales head sees nothing | nobody reports to them | People → set each salesperson's "Reports to" |
| A sales head sees another team's deals | somebody is under the wrong person | People → correct "Reports to" |
| A deal is missing from a sales head's list | it belongs to a salesperson on another team | correct by owner, not by branch — a record follows its owner |
| A salesperson has no branch in a form | they hold no branch | People → tick a branch. Closed branches are never offered |
| A branch is missing from every selector | it is Closed | Organization → Branches → Reopen |

**The database is the control, not the screen.** A sales head who types another
team's record id reads nothing, because `scoped_owner_ids()` bounds every scoped
policy. `tests/integration/pilot-organization.test.ts` proves it against the real
organisation on every commit.

### The People or Reporting Structure page fails with PGRST200

```
Could not find a relationship between 'users' and 'users' in the schema cache
```

**Fixed in ADR-041, and it is not a database fault.** The organisation screens
used to ask PostgREST to embed `users` into itself through `manager_id`, and the
office server's PostgREST 12.2.12 does not expose a self-referencing relationship
however many times the schema cache is reloaded. The foreign key is fine —
checking it, recreating it or reloading the cache will not help, and none of
those was ever the problem.

The join now happens in the application (`lib/organization.ts`), over three plain
queries that each carry their own row-level security. If this error appears
again, the server is running a checkout older than ADR-041:

```bash
cd /opt/jsk-crm && git log --oneline -1     # is ADR-041 in it?
git pull && deploy/start.sh --build
```

No migration is involved: 031 is unchanged and does not need reapplying.

**Never fix this with a `SECURITY DEFINER` function or a view over `users`.** Both
put the authorization rule in a second place, and a view without
`security_invoker` bypasses row-level security entirely (§25).

### A screen says "This screen is not part of your role"

Working as intended. `/dashboard`, `/team`, `/reports` and `/settings` are not a
salesperson's, and `/settings/organization/*` is the owner's and the
administrator's alone. It is a refusal rather than a redirect on purpose — a
redirect is indistinguishable from a broken link.

If somebody should have it, their role is wrong: Settings → Organization →
People. Changing a role never changes what they can already see through
ownership.

### Is it actually working?

```bash
deploy/health.sh
```

`HEALTHY` means the app answers, the database answers through PostgREST, there is
disk space, and a backup was written in the last 48 hours. Anything else prints
which of those failed.

### Scheduled jobs

```bash
systemctl list-timers 'jsk-crm*'                  # when each next runs
journalctl -u jsk-crm-cron@maintenance --since today
systemctl start jsk-crm-cron@daily-digest.service  # run one now
```

### Backups

```bash
deploy/backup.sh                 # take one now
deploy/backup.sh --verify        # take one and prove it restores
ls -lh /var/backups/jsk-crm      # what is held

deploy/restore.sh --scratch /var/backups/jsk-crm/<file>.dump.enc   # prove it, safely
deploy/restore.sh --live    /var/backups/jsk-crm/<file>.dump.enc   # the real thing
```

### Demo / training data

```bash
scripts/demo.sh                  # rebuild the database with synthetic data
DEMO_PASSWORD=... scripts/demo.sh
```

**Never on the production server.** The script refuses `NODE_ENV=production` and a
hosted Supabase URL, but the real protection is not running it there. Training runs
on a second machine, or on the same machine before the real data is loaded.

### When the power goes out

Nothing to do. Containers restart, PostgreSQL replays its write-ahead log, and
`jsk-crm.service` brings the stack back at boot. Check `deploy/health.sh`
afterwards. A UPS is what keeps a write from being interrupted in the first place.

### When the server will not come back

[`DEPLOYMENT.md`](DEPLOYMENT.md) §11.4. In short: new machine, Docker, clone,
restore `deploy/env/production.env` from the safe, `deploy/start.sh --build`,
`deploy/restore.sh --live <newest backup>`.
