# Setup

How to get a development environment running. Derived from `CLAUDE_CODE_BUILD_SPEC.md` §17.4,
§21.1, §5.12, with the approved decisions of 2026-08-19 applied.

> **The application has not been built yet.** This document describes the intended setup and is
> updated as each phase lands (§22.1 step 9). Steps marked *(not yet)* do not work today.
>
> **Local Supabase under Docker is permitted at any time** — it creates nothing irreversible.
> **Staging and production provisioning waits for the Decision Gate** (see
> `/docs/IMPLEMENTATION_PLAN.md`).

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 20 LTS or later | Next.js 15 |
| npm | bundled with Node | Lockfile is npm |
| Docker Desktop | current | `supabase start` runs Postgres locally; **also required in CI** for the integration suite (M-20) |
| Supabase CLI | current | Migrations, type generation, local stack |
| Git | current | |

**Development never connects to production** (§21.1). The production service-role key exists only
in Vercel's production environment and must never appear on a developer machine.

---

## 2. Clone and install

```bash
git clone <repo-url> jsk-crm
cd jsk-crm
npm install                    # (not yet — Phase 1)
```

---

## 3. Environment variables (§17.4)

Copy the template and fill it in. **`.env.example` is committed; `.env.local` is not.**

```bash
cp .env.example .env.local
```

### From §17.4

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | The **browser** address. Local: printed by `supabase start` |
| `SUPABASE_INTERNAL_URL` | **server only** | Leave unset locally — it falls back to the public URL. Set only for the self-hosted stack, where the browser address is unreachable from inside the container (ADR-034) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | RLS applies; safe to expose |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | **Never in a client bundle.** Three permitted callers — see §7 |
| `DATABASE_URL` | migrations only | |
| `RESEND_API_KEY` | server only | Email |
| `CRON_SECRET` | server only | Bearer token for `/api/cron/*` |
| `NEXT_PUBLIC_APP_URL` | client + server | |
| `TZ=Asia/Kolkata` | server | Sets the **Node** timezone. **It does not affect Postgres** — see §7 |

### Approved additions (M-28)

§17.4's list is incomplete for what §14, §19 and §21 actually require. These are approved and
belong in `.env.example`:

| Variable | Scope | Why |
|---|---|---|
| `RESEND_FROM_EMAIL` | server | **No email sends without a verified sender domain** |
| `SUPABASE_ACCESS_TOKEN` | CI | Supabase CLI auth for pipeline migrations |
| `SUPABASE_PROJECT_REF` | CI | Target project for the pinned migration command (M-17) |
| `PLAYWRIGHT_BASE_URL` | CI/local | E2E target |
| `TEST_{SALESPERSON,MANAGER,OWNER,ADMIN}_EMAIL` / `_PASSWORD` | CI/local | Per-role credentials — the RLS and E2E suites must run **as the restricted role**, never as OWNER (§23) |

The weekly backup job's secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
`AWS_BACKUP_BUCKET`, and a separate read-capable `DATABASE_URL`) live in **GitHub Actions**, not
in `.env.local` and not in Vercel — see `/docs/DEPLOYMENT.md` §7.2. They never touch a developer
machine.

**Nothing is hard-coded.** `.env.example` contains placeholder values only — never a real key.

---

## 4. Start the local database

### The normal path — Supabase CLI

```bash
npx supabase start          # first run pulls the container images
npx supabase status         # prints the URL, anon key and service-role key for .env.local
npm run db:reset            # apply every migration from empty, then seed
npm run db:types            # regenerate src/types/database.types.ts
```

### Running without Docker (ADR-018)

Some environments cannot reach the Supabase container registry — this repository was built in one,
where `public.ecr.aws`'s blob CDN is denied by an egress policy. **`supabase start` and
`supabase gen types --local` both fail there**, and neither working around the policy nor skipping
verification is acceptable.

The fallback runs everything against a **real PostgreSQL 16 server** with the Supabase platform
objects the application depends on created by a bootstrap file:

```bash
scripts/db.sh start                 # initdb if needed, then start PostgreSQL on 127.0.0.1:54322
npm run db:reset                    # drop, recreate, bootstrap, migrate, seed
npm run db:reset:fixtures           # ... and load the development fixtures
npm run db:types:nodocker           # regenerate types with the same generator, no container
npm run db:psql                     # a shell on the database
```

`supabase/platform/000_supabase_platform.sql` is **not a migration**. It creates only what a real
Supabase project already provides and the application actually uses: the `anon`, `authenticated`,
`service_role`, `authenticator` and `supabase_admin` roles; the `auth`, `extensions` and
`graphql_public` schemas; `auth.users`; and `auth.uid()` / `auth.jwt()` / `auth.role()` /
`auth.email()` **with the platform's own definitions**, which read `request.jwt.claims`.

Nothing in `supabase/migrations` may depend on anything else it defines.

**Migrations are still applied by the Supabase CLI** (`supabase migration up --db-url`), which
needs no container, so migration ordering and the `supabase_migrations` ledger are exercised for
real. Types are still generated by `@supabase/postgres-meta` — the same generator the
`supabase gen types` container runs, invoked as a library.

**What this cannot verify**, and what therefore stays open until a real project exists: Supabase
Auth (password hashing, JWT issue, its built-in login rate limiting), Storage buckets and their
policies, and PostgREST request handling.

`supabase/config.toml` declares `major_version = 17`; the local fallback is PostgreSQL 16. Nothing
in the schema uses a 17-only feature, and the remote project remains the authority.

### Type generation — repeatable

```bash
npm run db:types            # Supabase CLI, needs Docker
npm run db:types:nodocker   # same generator as a library, no Docker
```

**Never hand-write or hand-edit `src/types/database.types.ts`.** It is generated from the real
database; if it and the schema disagree, regenerate it. Both commands write the same file from the
same generator, and the output is byte-identical across runs on an unchanged schema.

---

## 5. Run the app

```bash
npm run dev                    # (not yet — Phase 1)
```

Log in with the seeded OWNER from `/supabase/seed/seed.sql`. The Phase 1 gate is: *a new developer
can clone, run, log in as the seeded OWNER, and create a salesperson who can log in* (§22).

ADMIN accounts land on **`/settings`**, not `/dashboard` (M-01) — ADMIN is a system/data role with
no dashboards.

---

## 6. Run the tests

```bash
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint, including the §18 import boundaries
npm run test              # Vitest — unit
npm run test:integration  # Vitest against the real database (resets it first)
npm run test:e2e          # Playwright
npm run build             # must pass with zero TypeScript and lint errors
npm run check:bundle      # after build: no service-role key in the client bundle

npm run verify            # all of the above, in order
```

`npm run test:integration` resets the database and loads the development fixtures before the first
test, then runs each test inside a transaction it rolls back — so the fixtures are identical for
every test and no test depends on another's order.

**Never skip a failing test** (§22.1). Integration tests use fixture users of every role and
assert permissions **as the restricted role, never as OWNER** (§23) — OWNER passes everything,
which is exactly why it proves nothing. The RLS suite is the most important suite in the project
and **runs on every commit**, not locally only (M-20).

The E2E suite is a **smoke suite** in this environment: it proves the app boots, that every
protected route sends a signed-out visitor to the login screen, and that there is no way to
register an account. **It does not sign anybody in and must not pretend to** — that needs Supabase
Auth, which cannot run here (ADR-018). The fifteen required scenarios (§19.3) arrive with the
features they cover, against a real project.

The lint step also enforces §18's **no-cross-feature-import** rule (M-30). A feature folder may
import from `services`, `lib`, `components/ui` and `components/shared` — never from another
feature folder.

---

## 7. Four environment traps

### Timezone — the business day is not the session day

`TZ=Asia/Kolkata` sets the **Node** timezone. The local Postgres session timezone stays **UTC**,
so bare `current_date` in SQL is a day behind IST between 00:00 and 05:30 IST. **Every
business-day expression in SQL must be written `(now() at time zone 'Asia/Kolkata')::date`**, and
`lib/dates.ts` must behave identically (B-10). Do not "fix" this by changing the database
timezone — timestamps are stored UTC by design (§8.11).

Rendering uses **`Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'`**. `date-fns-tz` is **not**
installed and must not be (M-13).

### Service-role key — three callers, no more

`lib/supabase/admin.ts` throws if `typeof window !== 'undefined'`. If you hit that error, you have
imported the admin client into something that ships to the browser. **Fix the import — do not
remove the guard** (§15.7).

Permitted callers: **cron routes**, **the import executor**, and **the user-provisioning Server
Action** (ADR-009). The provisioning action performs its OWNER/ADMIN check **before** touching the
admin client; reversing that order is a privilege-escalation hole.

### Settings values are never literals

All twelve `TODO-BD` items are resolved, but **resolution fixed the values, not the mechanism**.
Every threshold is still read through `settings.service.ts` from `system_settings`. In particular
`30000000` — the approved high-value threshold (TODO-BD-02) — must never appear as a literal in
application code, a default parameter, or a test fixture the application reads.

Note the split: **`account_dormancy_days`** and **`opportunity_dormancy_days`** are separate keys
(ADR-010). `dormancy_days` does not exist.

Two keys are **operational state, not configuration**: `maintenance_consecutive_failures` and
`maintenance_last_failure_at` (ADR-014). The maintenance cron route is their only writer, and they
must not appear as editable rows at `/settings`.

### Deletes

Exactly one table in the schema accepts a `DELETE`: `project_stakeholders` (ADR-004), because its
rows are relationship links rather than business records. If you find yourself needing a second
DELETE policy, the flow is wrong — raise it.

### Geography — `cities` holds taluks, not cities

`system_settings.cities` holds the **ten Erode District revenue taluks**: Erode, Perundurai,
Modakkurichi, Kodumudi, Gobichettipalayam, Sathyamangalam, Bhavani, Anthiyur, Thalavadi, Nambiyur.
The key is named `cities` because §5.10 names it so; it is not renamed.

**Chennimalai is not a taluk** — it is a development block and firka within Perundurai taluk, and
belongs in `accounts.area` / `projects.area`, which are **free text** in V1. Lower geographic
units are not enumerated. **Do not invent geographic units** (TODO-BD-06).

---

## 8. Seed data

| File | Runs where | Contains |
|---|---|---|
| `/supabase/seed/seed.sql` | all environments | OWNER user, **the system user (ADR-003, `is_active = false`)**, `system_settings` rows |
| `/supabase/seed/dev-fixtures.sql` | **development only** | Sample accounts, projects, opportunities, activities |
| *(performance fixture)* | development/CI only | 20,000 opportunities for the §23.6 gate (M-18) |

**Fixtures never run against staging or production.** A demo built on fixtures is not a working
feature (`CLAUDE.md` §15).

The seeded `system_settings` values are the approved ones — see `/docs/DATABASE.md`. Note that
`cities` is seeded with the **Erode District** taluk list (TODO-BD-06); the exact enumeration is
still to be confirmed and is a §23.9 launch gate.

---

## 8a. Demo / training data

`dev-fixtures.sql` (above) is shaped for the RLS tests: three outlets, a handful of
records, deliberately awkward permission cases. It is **not** something to demo.

For a realistic system — 20 users, 2 outlets, 40 customers, 20 projects, 60
opportunities across every stage, 240 activities, and work that is already
overdue, due today, missing a next action, stalled and dormant:

```bash
scripts/demo.sh                       # rebuilds the database, then seeds it
NEXT_PUBLIC_DEMO_MODE=1 npm run dev   # the DEMO / TRAINING DATA banner needs this
```

Sign in as `owner@demo.jsk.local`, `admin@demo.jsk.local`,
`manager.a@demo.jsk.local` or `sales01@demo.jsk.local` … `sales16@`. The script
prints the password; override it with `DEMO_PASSWORD=…`.

Two things keep this data unmistakable: every id begins `dd…` and every login is
`@demo.jsk.local`, so one query separates demo rows from real ones; and with
`NEXT_PUBLIC_DEMO_MODE=1` an orange banner sits above every screen, including the
login page. **It is off unless the variable is exactly `'1'`** — there is a unit
test for that, because a demo banner is only useful if it cannot appear in
production and, more importantly, cannot fail to appear in a demo.

`scripts/demo.sh` resets the database before seeding, so re-running it is a
rebuild rather than a mutation — which is why the demo data needs no delete
statements and the no-hard-delete rule stays intact (CLAUDE.md §11).

---

## 9. Before you write code

1. Read `CLAUDE_CODE_BUILD_SPEC.md` end to end. It is the source of truth.
2. Read `CLAUDE.md` — the engineering rules for this repository.
3. Read `/docs/IMPLEMENTATION_PLAN.md` for the current phase — and check that the
   **Decision Gate** has passed before touching migrations or provisioning.
4. Read `/docs/SPEC_AUDIT.md` for the resolutions affecting that phase. **All 53 findings are
   resolved**; the audit is now a reference for *why* things are built the way they are.
5. Read `/docs/DECISIONS.md` — the twelve resolved `TODO-BD` values, the fourteen ADRs, and the
   five product decisions C-1 … C-5. **A resolved decision is still never hard-coded.**
