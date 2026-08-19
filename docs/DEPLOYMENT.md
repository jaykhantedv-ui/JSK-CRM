# Deployment

Derived from `CLAUDE_CODE_BUILD_SPEC.md` §21, §14.7, §15.7, §17.4, §23.9.
**Nothing is deployed yet.** Deployment is Phase 21 of `/docs/IMPLEMENTATION_PLAN.md`.

---

## 1. Environments (§21.1)

| Environment | Where | Database | Data |
|---|---|---|---|
| Development | Local Next.js + `supabase start` | Local Postgres in Docker | Seeded fixtures |
| Staging | Vercel preview | **Separate** Supabase project | Anonymised or synthetic |
| Production | Vercel production | Production Supabase | Real |

> **Development never connects to production. The production service-role key exists only in
> Vercel's production environment.**

Fixtures (`dev-fixtures.sql`) never run against staging or production.

---

## 2. Before provisioning — **TODO-BD-08**

The Supabase **region is chosen at project creation and cannot be changed afterwards**. §24 is
explicit: *decide before production provisioning, it cannot be changed later.*

Do not create the staging or production Supabase projects until the Indian data-residency question
is answered. Local development does not need it.

---

## 3. Migrations (§21.2)

- Version-controlled files under `/supabase/migrations`, applied with `supabase db push` in
  development and `supabase migration up` in the deploy pipeline.
- **Never edit a migration that has been applied to production — write a new one.**
- **Never modify production schema through the Supabase dashboard.**

The exact production command needs pinning, along with whether the pipeline authenticates by
`DATABASE_URL` or a Supabase access token (`/docs/SPEC_AUDIT.md` M-17).

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

## 5. Environment variables in production (§17.4)

Set as platform secrets, never committed:

`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY`
(**server only**) · `DATABASE_URL` (migrations only) · `RESEND_API_KEY` · `CRON_SECRET` ·
`NEXT_PUBLIC_APP_URL` · `TZ=Asia/Kolkata`.

Before the first production deploy, verify by grepping the build output that
`SUPABASE_SERVICE_ROLE_KEY` is **absent from the client bundle** (§19.4, §23.8).

Resend additionally requires a **verified sender domain** before any email will send
(`/docs/SPEC_AUDIT.md` M-28).

---

## 6. Cron (§14.7)

Five routes under `/api/cron/*`, each requiring an `Authorization: Bearer ${CRON_SECRET}` header,
using the service-role client, excluded from the public sitemap, returning
`{ processed, sent, failed, durationMs }`.

Schedules are declared in `vercel.json` and are **UTC**. The specified IST times convert as:

| Job | IST | UTC cron |
|---|---|---|
| New-opportunity SLA | hourly | `0 * * * *` |
| Daily salesperson digest | 08:30 | `0 3 * * *` |
| Manager exception digest | 09:00 | `30 3 * * *` |
| Owner summary | 19:00 (per setting) | see below |
| Nightly maintenance | 02:00 | `30 20 * * *` — **the previous UTC day** |

Two platform constraints the spec does not mention (`/docs/SPEC_AUDIT.md` M-26, M-27):

- **Vercel Cron schedules are static.** A settings-driven schedule (TODO-BD-05) cannot change them
  without a redeploy, so the owner summary must run on an **hourly trigger with an in-route gate**
  that reads `system_settings.owner_summary_schedule` and decides whether to send. The value stays
  in settings and changing it still needs no deploy.
- **Hourly schedules and more than two cron jobs require a Vercel Pro plan.** The Hobby plan allows
  two daily jobs, which is not enough for the five specified routes.

---

## 7. Backup and data ownership (§21.4)

**Required and documented here by the specification:**

- **Supabase automated daily backups** — confirm retention on the chosen plan and record it here
  once provisioned.
- **A weekly `pg_dump` to storage the business controls independently of Supabase.**
  > *The company must be able to recover without vendor cooperation.*
  Destination, credentials, scheduler and retention are **not specified** and need a decision;
  Vercel Cron cannot run `pg_dump`, so this needs infrastructure outside the stack — a scheduled CI
  job writing to an object store the business owns (`/docs/SPEC_AUDIT.md` M-21).
- **CSV export** of accounts, contacts, projects, opportunities and activities, available to OWNER
  from `/settings`. *(§3.1 also grants export to MANAGER, who cannot reach `/settings` — M-02.)*
- **A documented restore procedure, tested at least once before go-live.** Record the date and who
  ran it below.
- **No business-critical state exists outside Postgres and Storage.**

### Restore procedure

*(To be written and tested in Phase 21. §23.9 requires it to be documented **and tested once**
before go-live. Record here: source of the dump, target project, exact commands, verification
queries, elapsed time, who ran it, and the date.)*

| Restore test | Date | Run by | Result |
|---|---|---|---|
| *(not yet performed)* | — | — | — |

---

## 8. Security posture in production (§15.7, §15.8, §20)

- Security headers: CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`.
- Sessions in httpOnly cookies via `@supabase/ssr`.
- **RLS enabled on every table**, with no `DELETE` policy anywhere.
- Storage bucket `crm-files` is **private**; signed URLs only, 60-second expiry.
- Logs never contain tokens, keys, or full request bodies with personal data.
- **No database error text ever reaches the user.**

---

## 9. Launch checklist (§23.9)

- [ ] Migrations apply cleanly to an empty database
- [ ] Seed produces a working OWNER login
- [ ] `system_settings.cities` populated — **TODO-BD-06**
- [ ] Backup and restore procedure documented **and tested once**
- [ ] All nine `/docs` files reflect the built system
- [ ] `npm run build` passes with zero TypeScript and lint errors
- [ ] Mobile create-customer flow completes in under 60 seconds **on a real Android device**

Plus, from §23.8: all fifteen E2E scenarios pass, the service-role key is absent from the client
bundle, and no role can DELETE from any business table.

---

## 10. Rollback

- **Application:** redeploy the previous Vercel build.
- **Database:** there is no down-migration path. Forward-fix with a new migration
  (§21.2 — never edit an applied migration). A destructive schema change must be reviewed against
  a staging restore **before** it reaches production.
- **Data:** restore from backup per §7. This is why the restore procedure must be tested before
  go-live and not discovered during an incident.
