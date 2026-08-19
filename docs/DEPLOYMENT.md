# Deployment

Derived from `CLAUDE_CODE_BUILD_SPEC.md` §21, §14.7, §15.7, §17.4, §23.9, with the approved
decisions of 2026-08-19 (Project Owner) applied.

**Nothing is deployed yet.** Deployment is Phase 21 of `/docs/IMPLEMENTATION_PLAN.md`.

> ## Provisioning is gated
> **Do not start production or staging provisioning before the Decision Gate passes**
> (see `/docs/IMPLEMENTATION_PLAN.md`). Local Supabase under Docker is permitted at any time.

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

Infrastructure to create at Phase 21 (**none of it is provisioned in this documentation pass**):

| Component | What is needed |
|---|---|
| AWS | Business-owned account · dedicated S3 bucket in `ap-south-1` · SSE enabled · versioning enabled · public access blocked · lifecycle policy with ≥90-day retention |
| IAM | A dedicated principal with a least-privilege policy scoped to the backup bucket prefix; access keys stored only as GitHub Actions secrets |
| GitHub Actions | A weekly scheduled workflow: install the Postgres client, `pg_dump` the production database, compress, upload to S3, and fail loudly on any non-zero exit |
| Secrets | `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` · `AWS_REGION=ap-south-1` · `AWS_BACKUP_BUCKET` · a read-capable production `DATABASE_URL`, **separate from the application's** |
| Monitoring | The workflow must alert on failure — a silent backup failure is worse than no backup, because it is believed |

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

*(To be written and tested in Phase 21. §23.9 requires it to be documented **and tested once**
before go-live. Record here: source of the dump, target project, exact commands, verification
queries, elapsed time, who ran it, and the date.)*

| Restore test | Date | Run by | Source dump | Result |
|---|---|---|---|---|
| *(not yet performed)* | — | — | — | — |

**A backup nobody has restored from is not a backup.** The tested restore is a launch gate, not a
formality.

### 7.5 No business-critical state outside Postgres and Storage

Confirmed by the model: eleven tables plus the `crm-files` bucket. The only state that lives
anywhere else is deployment configuration (platform secrets) and the cron schedule
(`vercel.json`), both of which are reproducible from this repository.

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
