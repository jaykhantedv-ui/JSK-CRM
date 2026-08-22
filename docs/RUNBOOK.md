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

It verifies the checksum, decrypts, prepares the target's `extensions` schema,
restores, and then runs `scripts/verify-restore.sql`, which fails unless the
tables, the relationships, the settings, RLS, and `search_crm()` all come back.

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
| `password authentication failed for user "authenticator"` / `"supabase_auth_admin"` / `"supabase_storage_admin"` — while `db` is healthy | The service-role passwords are not the superuser's. Run `deploy/db-credentials.sh`, then `deploy/start.sh`. See `DEPLOYMENT.md` §10.4 |

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
```

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
