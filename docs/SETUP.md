# Setup

How to get a development environment running. Derived from `CLAUDE_CODE_BUILD_SPEC.md` §17.4,
§21.1, §5.12.

> **The application has not been built yet.** This document describes the intended setup and is
> updated as each phase lands (§22.1 step 9). Steps marked *(not yet)* do not work today.

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 20 LTS or later | Next.js 15 |
| npm | bundled with Node | Lockfile is npm |
| Docker Desktop | current | `supabase start` runs Postgres locally |
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

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Local: printed by `supabase start` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | RLS applies; safe to expose |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | **Never in a client bundle.** Cron and import only |
| `DATABASE_URL` | migrations only | |
| `RESEND_API_KEY` | server only | Email |
| `CRON_SECRET` | server only | Bearer token for `/api/cron/*` |
| `NEXT_PUBLIC_APP_URL` | client + server | |
| `TZ=Asia/Kolkata` | server | Sets the **Node** timezone. **It does not affect Postgres** — see §7 below |

**Nothing is hard-coded.** `.env.example` documents every variable with placeholder values only —
never a real key.

Additional variables the spec's own requirements imply but §17.4 omits
(`/docs/SPEC_AUDIT.md` M-28), pending approval: a Resend verified sender address, Supabase CLI
credentials for pipeline migrations, and Playwright base URL plus per-role test-user credentials.

---

## 4. Start the local database

```bash
supabase start                 # first run pulls Docker images
supabase status                # prints local URL, anon key, service-role key
```

Apply migrations and seed:

```bash
supabase db reset              # applies /supabase/migrations in order, then /supabase/seed
```

`db reset` must succeed against an **empty** database, twice in a row (§23.9).

Generate types after any schema change:

```bash
supabase gen types typescript --local > src/types/database.types.ts
```

---

## 5. Run the app

```bash
npm run dev                    # (not yet — Phase 1)
```

Log in with the seeded OWNER from `/supabase/seed/seed.sql`. The Phase 1 gate is: *a new developer
can clone, run, log in as the seeded OWNER, and create a salesperson who can log in* (§22).

---

## 6. Run the tests

```bash
npm run test              # Vitest — unit
npm run test:integration  # Vitest against local Supabase (requires supabase start)
npm run test:e2e          # Playwright
npm run lint
npm run build             # must pass with zero TypeScript and lint errors
```

**Never skip a failing test** (§22.1). Integration tests seed users of each role and assert
permissions **as the restricted role, never as OWNER** (§23).

---

## 7. Two environment traps

### Timezone
`TZ=Asia/Kolkata` sets the **Node** timezone. The local Postgres session timezone stays **UTC**, so
`current_date` in SQL is a day behind IST between 00:00 and 05:30 IST. Every date expression in SQL
must be written `(now() at time zone 'Asia/Kolkata')::date`. Do not "fix" this by changing the
database timezone — timestamps are stored UTC by design (§8.11, `/docs/SPEC_AUDIT.md` **B-10**).

### Service-role key
`lib/supabase/admin.ts` throws if `typeof window !== 'undefined'`. If you hit that error, you have
imported the admin client into something that ships to the browser. Fix the import — do not remove
the guard (§15.7).

---

## 8. Seed data

| File | Runs where | Contains |
|---|---|---|
| `/supabase/seed/seed.sql` | all environments | OWNER user, `system_settings` rows |
| `/supabase/seed/dev-fixtures.sql` | **development only** | Sample accounts, projects, opportunities, activities |

**Fixtures never run against staging or production.** A demo built on fixtures is not a working
feature (`CLAUDE.md` §15).

---

## 9. Before you write code

1. Read `CLAUDE_CODE_BUILD_SPEC.md` end to end. It is the source of truth.
2. Read `CLAUDE.md` — the engineering rules for this repository.
3. Read `/docs/IMPLEMENTATION_PLAN.md` for the current phase and its blockers.
4. Read `/docs/SPEC_AUDIT.md` for the open defects affecting that phase.
5. Check `/docs/DECISIONS.md` — **never resolve a `TODO-BD` by choosing a value in code.**
