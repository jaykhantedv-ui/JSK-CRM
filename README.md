# JSK CRM

A standalone web CRM replacing handwritten sales books at a building-materials retail business
(tiles, marble, granite, sanitaryware, CP fittings). Mobile-first for salespeople,
desktop-oriented for management.

> **Status: specification audited, all decisions resolved, implementation planned. No application
> code has been written yet.** All 53 audit findings and all 12 `TODO-BD` business decisions are
> closed (2026-08-19). Implementation begins at Phase 1 on the Project Owner's approval.

---

## The source of truth

[`CLAUDE_CODE_BUILD_SPEC.md`](./CLAUDE_CODE_BUILD_SPEC.md) is the implementation specification and
the source of truth. **If behaviour is not described there, it is not in Version 1.** It is never
edited; issues with it are recorded in `/docs/SPEC_AUDIT.md`.

[`CLAUDE.md`](./CLAUDE.md) holds the engineering rules for this repository — read it before
writing code.

## Documentation

| Document | What it covers |
|---|---|
| [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) | 21 phases plus a Decision Gate: objective, dependencies, files, database changes, tests, acceptance criteria, risks |
| [`docs/SPEC_AUDIT.md`](./docs/SPEC_AUDIT.md) | 53 findings against the specification — **all resolved**, each with rationale and affected phase |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | The 12 resolved business decisions (`TODO-BD`), 14 ADRs, and 5 product decisions |
| [`docs/PRODUCT_REQUIREMENTS.md`](./docs/PRODUCT_REQUIREMENTS.md) | Scope, users, business rules, lifecycle, screens, dashboards |
| [`docs/DATABASE.md`](./docs/DATABASE.md) | Eleven tables, constraints, triggers, migration order |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Stack, layering, rendering strategy, invariants |
| [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md) | Roles, capability matrix, RLS policies |
| [`docs/API.md`](./docs/API.md) | Service contract, error codes, transactional RPCs, cron routes |
| [`docs/TESTING.md`](./docs/TESTING.md) | Unit, integration/RLS, the 15 E2E scenarios, security suite |
| [`docs/SETUP.md`](./docs/SETUP.md) | Local development environment |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | Environments, migrations, cron, backups, launch checklist |

## Stack

Next.js 15 (App Router) + TypeScript strict · Supabase (Postgres, Auth, Storage) in **Mumbai
`ap-south-1`** · Tailwind + shadcn/ui · Zod · TanStack Query · Recharts · Resend · Vercel ·
Vitest + Playwright.

The stack is frozen (§17.1). Any addition requires a `/docs/DECISIONS.md` entry **before** it is
installed — one dev-dependency (an ESLint import-boundary rule) is approved; `date-fns-tz` and
`file-type` were considered and declined.

## Principles

- RLS is the authorization boundary — frontend filtering is not a control
- The database enforces critical business rules through check constraints
- Nothing is ever hard-deleted; history is append-only
- Money is bigint paise; timestamps are UTC, displayed `Asia/Kolkata`
- Business logic lives in services; mutations go through Server Actions
- No business-decision value is ever hard-coded — it lives in `system_settings`, even now that
  all twelve are decided

## Getting started

```bash
npm install

# Database — the normal path, needs Docker
npx supabase start && npm run db:reset && npm run db:types

# Database — where the Supabase images cannot be pulled (ADR-018)
scripts/db.sh start
npm run db:reset:fixtures
npm run db:types:nodocker

cp .env.example .env.local     # fill in from `npx supabase status`
npm run dev
```

Verify everything:

```bash
npm run verify      # typecheck -> lint -> unit -> integration -> build -> bundle check
npm run test:e2e    # Playwright, separately
```

Operate it:

```bash
scripts/smoke.sh https://<host>                    # 27 post-deploy checks, no credentials needed
psql "$DATABASE_URL" -f scripts/data-quality.sql   # read-only data-quality report
scripts/backup.sh <label>                          # encrypted pg_dump to S3 (ap-south-1)
scripts/restore.sh <archive>                       # restore + verify; refuses a production target
```

Day-to-day commands and what to look at when something breaks:
[`/docs/RUNBOOK.md`](docs/RUNBOOK.md).

Full instructions, including the traps worth knowing before writing code, are in
[`/docs/SETUP.md`](docs/SETUP.md).

## Status

**All five master phases are built.** The application, the database and the operational tooling are
complete and verified locally. What is **not** done is the hosted infrastructure: no Supabase,
Vercel, Resend or AWS account is reachable from the environment this was built in, so nothing about
those is claimed to have passed. See [`/docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §0 for the exact
blockers and the steps to finish.

| Phase | Scope | State |
|---|---|---|
| 1 — Platform foundation | Schema, auth, outlet model, RLS, service layer, generated types | Built and verified |
| 2 — Core CRM | Customers, contacts, projects, opportunities, activities, next actions, `/today`, search, duplicate detection | Built and verified |
| 3 — Management intelligence | Manager and owner dashboards, `/team`, eleven reports, sales targets, CSV export | Built and verified |
| 4 — Operations and automation | Import + rollback, archive/restore, merge, Storage and file upload, five cron jobs, digests, maintenance | Built and verified |
| 5 — Production readiness | Security headers and CSP, CI/CD, independent backup with a tested restore, smoke test, data-quality report, RLS performance | Built and verified locally |
| — Hosted infrastructure | Supabase staging + production, Vercel, Resend, S3 bucket, real-Auth E2E | **Blocked — no credentials or network access** |

| Verified | |
|---|---|
| Unit tests | 498 passing |
| Integration / RLS tests | 425 passing |
| Migrations | 29, applied from empty twice, byte-identical schema |
| Generated types | Byte-identical to the live database |
| Post-deploy smoke checks | 27/27 against a real production build |
| Restore drill | Passed — full object and content parity |

An unbuilt screen renders a plain "not built yet" panel rather than a mock, because a phase demoed
on fixtures is a phase misreported.

**378 unit tests · 314 integration and RLS tests · 27 E2E tests passing**, with 24 E2E scenarios
written and skipped for a stated reason: they need Supabase Auth, which this environment cannot run
(**ADR-018**). Every authorization rule in those scenarios is separately proved against a real
PostgreSQL server in `tests/integration/`. **Hosted Supabase — Auth, Storage and PostgREST — remains
unverified**, and is not claimed otherwise.
