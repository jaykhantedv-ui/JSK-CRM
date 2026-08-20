# Deployment

Derived from `CLAUDE_CODE_BUILD_SPEC.md` §21, §14.7, §15.7, §17.4, §23.9, with the approved
decisions of 2026-08-19 (Project Owner) applied.

**Nothing is deployed yet.** Deployment is Phase 21 of `/docs/IMPLEMENTATION_PLAN.md`.

> ## Provisioning is gated
> **Do not start production or staging provisioning before the Decision Gate passes**
> (see `/docs/IMPLEMENTATION_PLAN.md`). Local Supabase under Docker is permitted at any time.

---

## 0. Hosted verification — BLOCKED, re-attempted 2026-08-20

A staging Supabase project in `ap-south-1` was to be provisioned so the platform could be verified
through the real API. **It could not be, and nothing about it is claimed to have passed.**

Re-tested on 2026-08-20 at the start of the production-readiness phase. The result is unchanged,
and it now also covers Vercel and Resend: `api.vercel.com:443` and `api.resend.com:443` are denied
by the same policy, and no `VERCEL_TOKEN` or `RESEND_API_KEY` is attached to the environment
either. The AWS variables present in the environment are the sandbox's own proxy placeholders
(`AWS_ACCESS_KEY_ID=proxy-injected`), not business credentials, and were **not** used to provision
anything.

Two independent blockers, either of which is sufficient on its own:

| Blocker | Evidence |
|---|---|
| **Network.** The whole Supabase domain family is denied by the environment's egress policy — control plane and data plane alike. | `api.supabase.com:443` → the gateway answers **403 to CONNECT**, recorded in the proxy's own failure log. `supabase.com` and `supabase.co` are unreachable through the proxy. |
| **Credentials.** No Supabase account is attached to this environment. | `SUPABASE_ACCESS_TOKEN` is unset, and the official CLI reports `LegacyPlatformAuthRequiredError`. `supabase login` is an interactive browser flow and needs a human. |

The block was established with **official tooling only** — `npx supabase projects list` and a
direct request to the documented management API. **No egress restriction was bypassed and no
unofficial endpoint was used.**

### What therefore remains unverified

- A Supabase project exists and its region reads back as exactly `ap-south-1`.
- Supabase Auth: password hashing, JWT issue, session refresh over real cookies, and the built-in
  login rate limiting of C-5.
- PostgREST: that the policies below hold against real HTTP requests carrying a real JWT, rather
  than against the `set role` + `request.jwt.claims` impersonation the local suite uses.
- Storage: the bucket, its policies, signed upload and download URLs, and parent-entity visibility.
- The SSR session architecture end to end, and each role's effective scope through the live API.

### What was additionally verified locally on 2026-08-20

Running the real production build behind a stub Auth endpoint made several §22–§24 items
genuinely testable without a hosted project:

- Every §23 security header, read off a live response (`scripts/smoke.sh`, 27 checks, all passing).
- The CSP nonce is fresh per request and present on the page's own scripts — verified in **real
  Chromium**, with zero CSP violations and the sign-in form hydrating and accepting input.
- `/api/*` answers `401` with a JSON body, and never a redirect (ADR-024).
- All five `/api/cron/*` routes answer `401 {"error":"unauthorized"}` with a missing secret and
  with a wrong one, and are not redirected to `/login`; with the correct secret,
  `/api/cron/owner-summary` returns the documented `{ processed, sent, failed, durationMs }`.
- Mobile: no horizontal overflow, no touch target under 44 px, and no data lost on blur, at
  412×839, 320×658 and 320×568.

### What is verified, and is not affected by the block

The schema, every constraint and trigger, and **the complete RLS model** are verified against a
real PostgreSQL 16 server (ADR-018). The local suite impersonates a user exactly as PostgREST does,
so the policies themselves are genuinely exercised — what is untested is the transport in front of
them, not the rules.

The service-role boundary is verified by three independent controls that need no hosted project:
the runtime browser guard in `lib/supabase/admin.ts`, the ESLint import restriction, and
`npm run check:bundle`, which greps the built client bundle for the key and its variable name.

### What to do when a project is available

1. Verify the organisation and the region **before** creating anything.
2. Create a **staging** project in `ap-south-1`. Do not provision production for this.
3. **Read the region back from the provider** — `supabase projects list`, or
   `GET /v1/projects/{ref}` — and confirm it is exactly `ap-south-1`. Never trust the value merely
   because it was supplied at creation.
4. `supabase link`, then `supabase migration up --linked`. The twenty-nine migrations already
   apply cleanly from empty, twice, producing a byte-identical schema, so this should be
   uneventful.
5. Run the hosted verification set listed above, then record the result here.
6. Point `scripts/smoke.sh` at the deployment. It checks the security headers, the CSP nonce, the
   anonymous redirect, the `401` JSON on API routes and all five cron routes in one pass.
7. Unskip the E2E suites by setting `E2E_SUPABASE_READY=1` with the test-user credentials from
   `.env.example`. The three suites are written and currently skip themselves with a stated reason;
   they do not need editing.

---

## 1. Environments (§21.1)

| Environment | Where | Database | Region | Data |
|---|---|---|---|---|
| Development | Local Next.js + `supabase start` | Local Postgres in Docker | n/a | Seeded fixtures |
| Staging | Vercel preview | **Separate** Supabase project | **`ap-south-1`** | Anonymised or synthetic |
| Production | Vercel production | Production Supabase | **`ap-south-1`** | Real |

> **Development never connects to production. The production service-role key exists only in
> Vercel's production environment.**

Fixtures (`dev-fixtures.sql`) never run against staging or production.

---

## 2. Region — TODO-BD-08, resolved and irreversible

**Indian data residency is a requirement.** Both the staging and production Supabase projects are
provisioned in the **Mumbai region, `ap-south-1`**. **Do not provision in any other region.**

The region is chosen at project creation and **cannot be changed afterwards** — §24 states it
plainly: *decide before production provisioning, it cannot be changed later.* A region mistake is
not an edit; it is a new project and a full data migration.

**Verify the region in the Supabase dashboard before any data is written**, and record it here:

| Project | Region | Project ref | Provisioned | Verified by |
|---|---|---|---|---|
| Staging | `ap-south-1` (required) | *(not yet provisioned)* | — | — |
| Production | `ap-south-1` (required) | *(not yet provisioned)* | — | — |

**Phase 2 status:** neither project has been created. Provisioning requires explicit
approval per firing, because the region cannot be changed afterwards. The region must be
**read back from the created project and recorded in this table** before any data is
written — selecting it in a form is not verification.

---

## 3. Migrations (§21.2)

- Version-controlled files under `/supabase/migrations`.
- **Never edit a migration that has been applied to production — write a new one.** This includes
  extensions to an existing table: §22's "004 (extend)" is a new numbered file, never an edit
  (H-03).
- **Never modify production schema through the Supabase dashboard.**
- RLS is enabled in each table's own creation migration; `015_rls_policies` is an audit/hardening
  pass, not the first place security exists (H-04).

**M-17 resolved — pin the command.** Development uses `supabase db push`. The pipeline uses:

```bash
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase migration up --linked
```

authenticated by `SUPABASE_ACCESS_TOKEN` (not by embedding `DATABASE_URL` in CI). Both variables
are documented in `.env.example` and set as CI secrets (M-28).

---

## 4. Deploy sequence (§21.3)

```
run tests
  → apply migrations to staging
    → verify
      → deploy staging
        → smoke test
          → apply migrations to production
            → deploy production
              → smoke test
```

No step is skipped, including on a hotfix.

---

## 5. Environment variables in production (§17.4, M-28)

Set as platform secrets, never committed:

`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY`
(**server only**) · `DATABASE_URL` (migrations only) · `RESEND_API_KEY` · **`RESEND_FROM_EMAIL`** ·
`CRON_SECRET` · `NEXT_PUBLIC_APP_URL` · `TZ=Asia/Kolkata`.

The backup workflow's secrets live in **GitHub Actions**, not Vercel: `AWS_ACCESS_KEY_ID` ·
`AWS_SECRET_ACCESS_KEY` · `AWS_REGION` · `AWS_BACKUP_BUCKET` · a separate read-capable
`DATABASE_URL`.

**Rate limiting (C-5).** V1 relies on **Supabase Auth's built-in** authentication rate limiting —
no Redis, no distributed infrastructure. The configured thresholds depend on the Supabase project
and **must be recorded here once provisioned**, because the application's tests assert that
throttling occurs and that its error never reaches the user as a provider string:

| Setting | Value | Recorded |
|---|---|---|
| *(sign-in attempt limits)* | *(not yet provisioned)* | — |

Before the first production deploy, verify by grepping the build output that
`SUPABASE_SERVICE_ROLE_KEY` is **absent from the client bundle** (§19.4, §23.8).

**Resend requires a verified sender domain** before any email will send (M-28). The service-role
key has three permitted callers — cron routes, the import executor, and the user-provisioning
Server Action (ADR-009) — and appears in no client bundle.

---

## 6. Cron (§14.7)

Five routes under `/api/cron/*`, each requiring an `Authorization: Bearer ${CRON_SECRET}` header,
using the service-role client, excluded from the public sitemap, returning
`{ processed, sent, failed, durationMs }`.

**M-27 resolved.** Schedules are declared in `vercel.json` and are **UTC**. A Vercel plan
supporting **hourly cron** and five jobs is required — the Hobby plan allows two daily jobs, which
is not enough. IST converts as:

| Job | IST | UTC cron | Notes |
|---|---|---|---|
| New-opportunity SLA | hourly | `0 * * * *` | Dedupes on `sla_notified_at` (ADR-002) |
| Daily salesperson digest | 08:30 | `0 3 * * *` | Never a group email |
| Manager exception digest | 09:00 | `30 3 * * *` | |
| **Owner summary** | **hourly trigger** | `0 * * * *` | **ADR-011** — see below |
| Nightly maintenance | 02:00 | `30 20 * * *` | **The previous UTC day** |

### ADR-011 — the owner summary runs hourly and gates in-route

**TODO-BD-05** sets the owner summary to **daily at 19:00 Asia/Kolkata**. Vercel Cron schedules are
**static in `vercel.json`** and require a redeploy to change, so they cannot be driven by a
database value. The route therefore fires **hourly**, reads
`system_settings.owner_summary_schedule` on every firing, and sends only when the current
**Asia/Kolkata** hour matches.

**Changing the setting still requires no deployment**, which is the rule §24 exists to protect.
§14.5's "Log; no retry — a stale summary is worse than none" still applies: a skipped hour is not
made up later.

**H-09** — the nightly maintenance job must exclude records still inside the 7-day import rollback
window, so it cannot silently make imported records look user-edited and disqualify a rollback.

---

## 7. Backup and data ownership (§21.4)

Two independent layers, because §21.4 requires the business to be able to recover **without vendor
cooperation**:

### 7.1 Supabase automated backups

Supabase automated daily backups. **Confirm the retention period on the chosen plan and record it
here once provisioned.** This layer depends entirely on the vendor and therefore cannot satisfy
§21.4 on its own.

### 7.2 Independent weekly `pg_dump` to AWS S3 — **M-21, final**

> *The company must be able to recover without vendor cooperation.* (§21.4)

**Destination: AWS S3, Mumbai region `ap-south-1`**, matching the Supabase region so the backup
does not itself create a data-residency problem (TODO-BD-08).

| Requirement | Specification |
|---|---|
| AWS account | **Business-controlled** — owned by the business, not by a contractor, not by an agency, not by a developer's personal account |
| Bucket | A **dedicated backup bucket**, used for nothing else |
| Region | **`ap-south-1` (Mumbai)** |
| Encryption | **Enabled** — server-side encryption at rest |
| Versioning | **Enabled** — so an overwrite or a bad dump cannot destroy the previous good one |
| Public access | **Blocked**, at both the bucket and the account level |
| Credentials | **Least-privilege IAM** — write-and-list on this one bucket prefix, nothing else; no console access; rotated on a schedule |
| Frequency | **Weekly `pg_dump`** |
| Retention | **Automated**, via an S3 lifecycle policy — **minimum 90 days** |
| Restore procedure | **Documented** (§7.3 below) |
| Restore test | **At least one tested restore before production go-live** (§23.9) |

**Scheduler: a scheduled GitHub Actions workflow.** Vercel Cron cannot run `pg_dump`, and the
frozen stack (§17.1) contains nothing that can — this is deliberately infrastructure *outside* the
application, which is the point of an independent backup.

**The scripts and the workflow now exist and have been exercised.**
`scripts/backup.sh` dumps, encrypts and publishes; `scripts/restore.sh` fetches, decrypts,
restores and verifies; `.github/workflows/backup.yml` runs the first weekly and drills the second
quarterly. What is *not* provisioned is the AWS side — see the table below — because no
business-controlled AWS account is attached to this environment.

The archive is encrypted **client-side**, with `aes-256-cbc` and PBKDF2 at 600,000 iterations,
before it leaves the runner. S3 server-side encryption is enabled as well, but SSE protects the
object from someone who reaches the bucket, not from someone who reaches AWS — and "recover
without vendor cooperation" has to mean without *any* vendor's cooperation. `BACKUP_PASSPHRASE`
lives in GitHub Actions secrets and, on paper, in the business safe. **Lose it and the archives are
unreadable. That is the intended trade and the owner must be told so in those words.**

`backup.sh` refuses to run if `AWS_REGION` is not exactly `ap-south-1`, refuses a passphrase under
20 characters, refuses to publish a dump under 4 KB (an empty database with a schema, which would
otherwise overwrite last week's good copy), and decrypts the archive back and compares it to the
dump before uploading. It then re-reads the object's `ContentLength` from S3, because a `PUT` that
returned 200 is not the same as an object that exists at the size you wrote.

Infrastructure still to create (**the AWS account is not attached to this environment**):

| Component | Status | What is needed |
|---|---|---|
| AWS | **Not provisioned** | Business-owned account · dedicated S3 bucket in `ap-south-1` · SSE enabled · versioning enabled · public access blocked · lifecycle policy with ≥90-day retention |
| IAM | **Not provisioned** | A dedicated principal, `PutObject`/`GetObject` on the backup prefix and nothing else — **no `DeleteObject`**, because retention is the bucket's lifecycle rule, not the job's business. No console access. Keys held only as GitHub Actions secrets |
| GitHub Actions | **Built** — `.github/workflows/backup.yml` | Weekly `30 18 * * 0` UTC = 00:00 IST Monday, plus a quarterly restore drill job |
| Scripts | **Built** — `scripts/backup.sh`, `scripts/restore.sh`, `scripts/verify-restore.sql` | — |
| Secrets | **Not set** | `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` · `AWS_REGION=ap-south-1` · `AWS_BACKUP_BUCKET` · `BACKUP_PASSPHRASE` · `BACKUP_DATABASE_URL`, a read-capable production credential **separate from the application's** |
| Monitoring | **Built** | The workflow fails loudly on any non-zero exit — a silent backup failure is worse than no backup, because it is believed |

**The production database credential used by the backup job is a second secret surface.** It is
least-privilege, held only as a CI secret, and never shared with the application's environment.

### 7.3 CSV export

CSV export of accounts, contacts, projects, opportunities and activities.

- **OWNER** — bulk export from `/settings` (§21.4).
- **MANAGER** — export from the manager-accessible list and report screens, scoped to the current
  filtered view (**C-2**, resolving M-02).
- **ADMIN** — **denied**, per §3.1. The control is not rendered *and* the Server Action rejects
  ADMIN, because a hidden button is not a control.

### 7.4 Restore procedure

```bash
# 1. List what is held.
aws s3 ls s3://$AWS_BACKUP_BUCKET/database/ --region ap-south-1

# 2. Restore into a NON-PRODUCTION target. restore.sh refuses a URL containing
#    'prod' or 'production' unless ALLOW_PRODUCTION_RESTORE=I-UNDERSTAND is set.
export BACKUP_PASSPHRASE='<from the password manager / the safe>'
export RESTORE_DATABASE_URL='postgresql://…/restore_target'
scripts/restore.sh s3://$AWS_BACKUP_BUCKET/database/jsk-crm-<stamp>-scheduled.dump.enc
```

The script verifies the SHA-256 before decrypting, creates the `extensions` schema with `pg_trgm`
and `pgcrypto` in the target, restores, and then runs `scripts/verify-restore.sql`, which fails the
restore unless all fourteen business tables are present, no orphaned rows exist in opportunities,
activities, events or contacts, all nine `system_settings` business keys survived, RLS is enabled
on every public table, and `search_crm()` executes with its three trigram indexes present.

#### Restore test record (§18, §23.9)

| Field | Value |
|---|---|
| Backup taken | 2026-08-20 08:32 UTC, label `restore-drill` |
| Restore run | 2026-08-20 08:35 UTC |
| Source | `jsk-crm-20260820T083248Z-restore-drill.dump.enc` (217,648 bytes encrypted; 217,626 plain) |
| SHA-256 | `f8ddffee876c731e9c74b131efe2dc9e323df8bbcf3a0a2ee3358a16abedf0d2` — verified before decrypt |
| Target | `jsk_restore_drill`, a **separate database** created empty for the drill |
| `pg_restore` | exit 0, **0 diagnostics** |
| Result | **PASS** |

Object parity between source and restored, all matching: 14 tables · 42 policies · **1** DELETE
policy · 27 check constraints · 51 foreign keys · 70 indexes · 60 functions · 18 triggers · 1 view
· 10 `auth.users`. Content compared by MD5 over each table's rows, order-independent: `accounts`,
`contacts`, `projects`, `opportunities`, `activities`, `opportunity_events`, `users`, `outlets`
and `system_settings` all **byte-identical**.

**The drill found a real defect, which is why §18 requires it.** The first attempt reported a clean
restore and every row count matched — and search was completely broken in the restored database.
`pg_trgm` and `pgcrypto` live in Supabase's `extensions` schema, and a schema-filtered `pg_dump`
carries the *uses* of an extension without the `CREATE EXTENSION` that defines it, so the three
trigram indexes silently vanished and `search_crm` raised `schema "extensions" does not exist` on
every call. Counting rows would never have found it. `restore.sh` now prepares the target, and
`verify-restore.sql` calls `search_crm()` so the failure can never be silent again.

**Caveat, stated plainly:** this drill ran against the local PostgreSQL 16 runtime (ADR-018), not
against a hosted Supabase project, and the destination was a local directory rather than S3 — no
AWS account is attached to this environment. It proves the dump, the encryption, the checksum, the
restore and the verification. It does **not** yet prove the S3 leg or a Supabase-to-Supabase
restore. Repeat it against staging as step 6 of §9's launch checklist.

**A backup nobody has restored from is not a backup.** The tested restore is a launch gate, not a
formality.

### 7.5 No business-critical state outside Postgres and Storage

Confirmed by the model: eleven tables plus the `crm-files` bucket. The only state that lives
anywhere else is deployment configuration (platform secrets) and the cron schedule
(`vercel.json`), both of which are reproducible from this repository.

## 7A. CI/CD (§19)

Three workflows, in `.github/workflows/`.

### `ci.yml` — every push and pull request

Two jobs, split by what they need rather than by what they are, so a TypeScript error is reported
in under a minute instead of behind a database boot.

| Job | Steps |
|---|---|
| `verify` | `npm ci` · typecheck · lint · unit tests · build · `check:bundle` |
| `database` | Reset from empty → migrate → **capture schema** → integration + RLS tests → reset from empty again → migrate → capture schema → **byte-compare** · regenerate types and compare · backup + restore drill |

The build runs with placeholder Supabase values on purpose: a build that needs real credentials is
a build that can reach — and write to — a real project.

The **two resets with a byte comparison** are the point of the database job. A migration that is
not deterministic (depends on the date, on a row that happens to exist, or on statement order)
passes one reset and fails this. The generated-types comparison catches the other silent failure:
a stale `database.types.ts` is a compile-time lie, because the code typechecks against columns the
database no longer has.

CI runs PostgreSQL as a service container; `scripts/db.sh` takes `PG_EXTERNAL=1` and skips only the
server lifecycle, so CI exercises the same bootstrap, the same migration ordering and the same seed
a developer runs, rather than a parallel path that can drift away from it.

### `deploy.yml` — the §21 sequence, as job dependencies

    test → migrate staging → verify → deploy staging → smoke
         → migrate production → deploy production → smoke

The order is enforced by `needs:`, so it cannot be reversed by re-running one job. The two
production jobs are gated on a GitHub **Environment** with a required reviewer, so a human approves
the step that touches customer data. `migrate-production` takes an out-of-band `pre-migration`
backup first, so a bad migration is recoverable to the minute rather than to last Sunday.

**Schema changes are applied only from here** — never from a laptop, never through the Supabase
dashboard. A hand-applied change is invisible to the migration ledger, and the next deployment
either fails or quietly disagrees with it.

### `backup.yml` — weekly, plus a quarterly restore drill

See §7.2 and §7.4.

### `scripts/smoke.sh`

Deliberately small, deliberately unauthenticated, and safe to run against production: it answers
"did this deployment come up as the thing we think we deployed?" without credentials and without
touching business data. 27 checks — reachability, every §23 header, the CSP nonce being fresh
*and* matching the page's scripts, the anonymous redirect, `401` JSON on API routes, all five cron
routes refusing a missing and a wrong secret, and a scan of the served HTML for a leaked key, a
stack trace, or the word "Revenue".

---

## 8. Security posture in production (§15.7, §15.8, §20)

- Security headers: CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`.
- Sessions in httpOnly cookies via `@supabase/ssr`.
- **RLS enabled on every table**, created per table rather than in one late migration (H-04).
- **No `DELETE` policy anywhere except `project_stakeholders`** (ADR-004) — a reviewer should be
  able to grep for `for delete` and find exactly one policy.
- Storage bucket `crm-files` is **private**; read signed URLs expire in 60 seconds; upload signed
  URLs are short-lived and issued only after a server-side visibility check (ADR-005).
- Logs never contain tokens, keys, or full request bodies with personal data.
- **No database error text ever reaches the user.** Unauthorised record access returns **404**,
  never a message confirming the record exists (M-03).

---

## 9. Launch checklist (§23.9)

- [ ] Migrations apply cleanly to an empty database
- [ ] Seed produces a working OWNER login (and the ADR-003 system user, `is_active = false`)
- [ ] `system_settings.cities` populated with the **ten Erode District revenue taluks** — Erode,
      Perundurai, Modakkurichi, Kodumudi, Gobichettipalayam, Sathyamangalam, Bhavani, Anthiyur,
      Thalavadi, Nambiyur (**Chennimalai is not among them** — it is a block/firka under
      Perundurai and belongs in `area`)
- [ ] `system_settings.high_value_threshold_paise = 30000000` and appears as a literal nowhere else
- [ ] `account_dormancy_days` and `opportunity_dormancy_days` both seeded; `dormancy_days` absent
- [ ] Supabase region verified as **`ap-south-1`** for staging and production
- [ ] `maintenance_consecutive_failures = 0` and `maintenance_last_failure_at = null` seeded
- [ ] Backup and restore procedure documented **and tested once**
- [ ] AWS S3 backup live: business-controlled account · `ap-south-1` bucket · encryption ·
      versioning · least-privilege IAM · weekly `pg_dump` · ≥90-day automated retention
- [ ] Supabase Auth rate-limit thresholds recorded below (C-5)
- [ ] All `/docs` files reflect the built system
- [ ] `npm run build` passes with zero TypeScript and lint errors
- [ ] Mobile create-customer flow completes in under 60 seconds **on a real Android device**

Plus, from §23.8: all fifteen E2E scenarios pass, the service-role key is absent from the client
bundle, and **no role can DELETE from any business table** (with `project_stakeholders` documented
as the single approved exception).

---

## 10. Rollback

- **Application:** redeploy the previous Vercel build.
- **Database:** there is no down-migration path. Forward-fix with a new migration
  (§21.2 — never edit an applied migration). A destructive schema change must be reviewed against
  a staging restore **before** it reaches production.
- **Data:** restore from backup per §7. This is why the restore procedure must be tested before
  go-live and not discovered during an incident.
- **Import:** a batch may be rolled back by OWNER within 7 days, archiving (never deleting) every
  record carrying that `import_batch_id`. Nightly maintenance must not invalidate that window
  (H-09).
