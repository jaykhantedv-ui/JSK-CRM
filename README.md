# JSK CRM

A standalone web CRM replacing handwritten sales books at a building-materials retail business
(tiles, marble, granite, sanitaryware, CP fittings). Mobile-first for salespeople,
desktop-oriented for management.

> **Status: complete and ready for the office server.** All five master phases are built, the
> demo/training dataset and the self-hosted deployment package are in place, and the whole suite
> passes locally. The one thing that cannot be verified here is a running Docker stack — this
> environment has the Docker CLI but no daemon — so the compose package is statically validated
> and the single human step to run it is written down (ADR-033, `docs/DEPLOYMENT.md` §10).

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
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | Both deployments — **§10 is the office server**, §1–9 the hosted upgrade — migrations, cron, backups, launch checklist |
| [`docs/TRAINING.md`](./docs/TRAINING.md) | **How to use the CRM.** Written for staff, no technical knowledge assumed |
| [`docs/RUNBOOK.md`](./docs/RUNBOOK.md) | Day-to-day operation and what to check when something breaks |

## Stack

Next.js 15 (App Router) + TypeScript strict · Supabase (Postgres, Auth, Storage) · Tailwind +
shadcn/ui · Zod · TanStack Query · Recharts · Resend · Vitest + Playwright.

**It runs on one office PC at ₹0/month recurring** — self-hosted Supabase in Docker Compose, with
systemd timers in place of Vercel Cron and a Cloudflare tunnel for access from outside the shop
(ADR-033). Vercel plus Supabase Cloud remains a supported upgrade, not a requirement: the schema,
the migrations and the application are identical either way.

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

Load the demo / training data — 20 users, 40 customers, 60 opportunities across every stage,
with overdue, due-today, missing-next-action, stalled and dormant work already in it:

```bash
scripts/demo.sh                     # rebuilds the database, then seeds it
NEXT_PUBLIC_DEMO_MODE=1 npm run dev # the DEMO / TRAINING DATA banner needs this
```

Sign in as `owner@demo.jsk.local`, `manager.a@demo.jsk.local` or `sales01@demo.jsk.local`.
The script prints the password; set your own with `DEMO_PASSWORD=… scripts/demo.sh`.
See [`docs/TRAINING.md`](docs/TRAINING.md).

Run it on the office server:

```bash
cp deploy/env/production.env.example deploy/env/production.env
deploy/keygen.sh >> deploy/env/production.env   # database password, JWT secret, anon +
                                                # service-role keys, cron and backup secrets
deploy/start.sh --build                         # db -> auth -> migrations -> gateway -> app
deploy/health.sh                                # app, database, disk, backup freshness
```

Operate it:

```bash
scripts/smoke.sh https://<host>                    # 27 post-deploy checks, no credentials needed
psql "$DATABASE_URL" -f scripts/data-quality.sql   # read-only data-quality report
deploy/backup.sh --verify                          # encrypted backup + a proven restore
deploy/restore.sh --scratch <archive>              # prove a backup restores, touching nothing
deploy/restore.sh --live    <archive>              # the real thing, with a typed confirmation
```

Day-to-day commands and what to look at when something breaks:
[`/docs/RUNBOOK.md`](docs/RUNBOOK.md).

Full instructions, including the traps worth knowing before writing code, are in
[`/docs/SETUP.md`](docs/SETUP.md).

## Status

**Complete and ready for the office server.** The application, the database, the demo dataset and
the self-hosted deployment package are built and verified locally.

Two things are **not** claimed to have passed, for the same reason in both cases — this environment
cannot reach them:

- **Hosted infrastructure.** No Supabase Cloud, Vercel, Resend or AWS account is reachable from
  here (§20), so nothing about the hosted path is claimed. It is documented as an optional upgrade.
- **A running Docker stack.** The Docker CLI is present but there is no daemon, and the registry is
  policy-blocked. The compose package is therefore **statically validated** — `docker compose
  config` parses and interpolates it, every systemd unit passes `systemd-analyze verify`, the
  generated JWTs verify against their secret — but no container was started. Starting it is the one
  human step, and it is written down in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §10.

| Phase | Scope | State |
|---|---|---|
| 1 — Platform foundation | Schema, auth, outlet model, RLS, service layer, generated types | Built and verified |
| 2 — Core CRM | Customers, contacts, projects, opportunities, activities, next actions, `/today`, search, duplicate detection | Built and verified |
| 3 — Management intelligence | Manager and owner dashboards, `/team`, eleven reports, sales targets, CSV export | Built and verified |
| 4 — Operations and automation | Import + rollback, archive/restore, merge, Storage and file upload, five cron jobs, digests, maintenance | Built and verified |
| 5 — Production readiness | Security headers and CSP, CI/CD, independent backup with a tested restore, smoke test, data-quality report, RLS performance | Built and verified |
| 6 — Demo, self-hosting, launch | Demo/training dataset, DEMO banner, health endpoint, Docker Compose stack, systemd timers, local encrypted backups with a verified restore, training guide | Built; container runtime not exercised here |
| — Hosted infrastructure | Supabase Cloud, Vercel, Resend, S3 | **Not attempted — unreachable, and no longer required** |

| Verified locally | |
|---|---|
| Unit tests | **506 passing** |
| Integration / RLS tests | **425 passing** |
| E2E tests | **60 passing**, 32 skipped — they need Supabase Auth, which cannot run here (ADR-018) |
| Migrations | **30**, applied from empty twice; schema byte-identical across both |
| Generated types | Byte-identical to the live database |
| Backup → restore drill | Passed, including the trigram indexes and full row counts |
| Data-quality report | Clean; **no manager without outlet scope** |
| Service-role key in the browser bundle | Absent |
| DELETE policies in the database | Exactly one — `project_stakeholders` (ADR-004) |

Every authorization rule in the skipped E2E scenarios is separately proved against a real
PostgreSQL server in `tests/integration/`, as the restricted role rather than as OWNER (§23).

Where a screen cannot show a real number it shows the specified empty state — never an invented
one, and never a fixture presented as production data (CLAUDE.md §15).
