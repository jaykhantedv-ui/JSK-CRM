# Implementation Plan

**Source of truth:** `CLAUDE_CODE_BUILD_SPEC.md`. Section references (`§9.2`) point at it.
**Audit:** `/docs/SPEC_AUDIT.md` — **all 53 findings resolved** (2026-08-19).
**Decisions:** `/docs/DECISIONS.md` — **all 12 `TODO-BD` items resolved**, **14 ADRs** accepted,
5 product decisions (C-1 … C-5).

**Status: this plan reflects the approved decisions of 2026-08-19 (Project Owner).**
All ten blockers, all thirteen HIGH findings, all thirty MEDIUM findings and all five follow-on
questions are closed. **The Decision Gate's criteria are met.** The plan is ready for
implementation on your approval.

---

## How this plan relates to §22

The spec defines **nine build phases** with formal gates in §23. This plan expands those into
**21 working phases** plus a **Decision Gate**. §22 and §23 remain authoritative: a spec phase is
complete only when its §23 criteria pass. The mapping:

| Spec phase (§22) | Gate (§23) | Working phases here |
|---|---|---|
| 1 Foundation | "a new dev can clone, run, log in, create a salesperson" | 1, **Decision Gate**, 2, 3, 4, 7 |
| 2 Identity | §23.1, §23.2 | 8, 9, 13 (search half) |
| 3 Projects | §23.3 | 10 |
| 4 Sales | §23.4 | 11 |
| 5 Accountability | §23.5 | 12 |
| 6 Management | §23.6 | 14 |
| 7 Data | §23.7 | 15, 16, 17 |
| 8 Security & QA | §23.8 | 5 (written early), 19 |
| 9 Launch | §23.9 | 18, 20, 21 |

Phases 5 (RLS) and 6 (services) are **not** deferred: §22 requires policies to be written as each
table is created, and **audit H-04 makes that binding** — RLS is enabled in each table's own
migration, and migration 015 is a hardening audit rather than the first time security exists.
Phase 19 is the adversarial audit of what was built, not the first time security is considered.

**Every phase ends with §22.1 step 11: stop, summarise, wait for review.**

---

## Dependency graph

```
1 Foundation
└─◆ DECISION GATE ─ architecture and business decisions closed
  │                 no staging/production provisioning before this gate passes
  └─2 Supabase config ─ region fixed: Mumbai ap-south-1 (TODO-BD-08)
    └─3 Migrations + DB helpers ────────────────┐
      ├─4 Auth & users                          │
      │ └─5 RLS & permissions ──────────────────┤
      │   └─6 Core services ───────────────────┐│
      │     ├─7 Design system (parallel from 1)││
      │     ├─8 Accounts ──┬─9 Contacts        ││
      │     │              └─13 Search & dupes ││
      │     ├─10 Projects & stakeholders       ││
      │     │  └─11 Opportunities & pipeline   ││
      │     │     └─12 Activities & next action││
      │     │        └─14 Dashboards & reports ││
      │     ├─15 Import ───────────────────────┘│
      │     ├─16 Archive & merge                │
      │     └─17 Storage & quotation files ─────┘
      └─18 Cron & email
        └─19 Complete testing
          └─20 Production hardening
            └─21 Deployment
```

---

# Phase 1 — Repository and framework foundation

**Spec phase:** 1 Foundation · **Spec sections:** §17.1, §17.2, §17.4, §18

**Objective.** A clean Next.js 15 App Router + TypeScript-strict repository that builds, lints and
runs an empty shell, with the §18 directory structure in place and the frozen stack installed —
nothing more.

**Dependencies.** None. This is the only phase with no upstream blockers.

**Files/modules.** `package.json`, `next.config.ts`, `tsconfig.json` (strict),
`postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`,
`components.json`, `.env.example`, `.gitignore`, `src/app/{layout.tsx,globals.css,page.tsx}`,
`src/lib/utils.ts`, the empty §18 folder tree with `.gitkeep`,
`/tests/{unit,integration,e2e}`.

> **No `tailwind.config.ts`.** Tailwind v4 is CSS-first: design tokens live in `globals.css`
> under `@theme`, and PostCSS loads `@tailwindcss/postcss`. The earlier reference to
> `tailwind.config.ts` in this list was a Tailwind v3 artifact and is **superseded by ADR-015**.
> **Do not add the file to satisfy the old list.**

**Database changes.** None.

**Approved decisions applied here.**
- **M-13** — UTC→IST rendering uses **`Intl.DateTimeFormat`**. **`date-fns-tz` is not installed.**
- **M-14** — magic-byte MIME verification is a **hand-rolled signature check** for JPEG, PNG,
  WebP and PDF. **`file-type` is not installed.**
- **M-30 / ADR-000** — an ESLint import-boundary rule is **approved** as the one permitted
  dev-dependency addition. **As built, the allowance was not needed**: ESLint's core
  `no-restricted-imports` enforces the rule with zero added packages, which `CLAUDE.md` §16
  permits as an equivalent to `import/no-restricted-paths`.
- **ADR-015** — **Tailwind CSS v4**, CSS-first. No `tailwind.config.ts`.
- **M-28** — `.env.example` gains the Resend sender address, CI/Supabase-CLI credentials and
  Playwright per-role test credentials alongside the §17.4 list.

**Tests.** One trivial unit test proving Vitest runs. One Playwright smoke test proving the app
boots. `npm run build` clean.

**Acceptance criteria.**
- `npm install && npm run build && npm run lint && npm run test` all pass with zero errors.
- TypeScript `strict: true`, no `any` escape hatches configured.
- The §18 tree exists exactly; no extra top-level folders.
- Only §17.1 dependencies plus the approved lint plugin are installed. Any further addition needs
  a `/docs/DECISIONS.md` entry **first**.
- The import-boundary lint rule fails the build on a cross-feature import.

**Risks.** Dependency creep — the shadcn CLI pulls in transitive packages; audit the lockfile
against §17.1 before committing.

## As built — Phase 1 completed and approved 2026-08-19

| Decision taken during implementation | Record |
|---|---|
| **Tailwind CSS v4**, CSS-first; no `tailwind.config.ts` | **ADR-015** |
| **Next.js pinned to 15.5.23** — `next@16` is latest, but §17.1 freezes Next.js 15 | §17.1 |
| **TypeScript 5.9.3 / ESLint 9** — TS 7 and ESLint 10 are outside what Next 15 and `eslint-config-next@15` support | §17.1 |
| **`@playwright/test` pinned to 1.56.1** — the release shipping the Chromium revision the CI image provides, rather than hardcoding a machine-specific `executablePath` | §19.3 |
| **Import boundary via ESLint core `no-restricted-imports`** — no plugin installed; the M-30 allowance is unspent | `CLAUDE.md` §16 |
| **`clsx` + `tailwind-merge`** installed as the mandatory runtime dependencies of shadcn/ui's `cn()` | §17.1 |
| **Vitest `projects`** (`unit` / `integration`) so `test:integration` targets `tests/integration/**` when Phase 3 populates it | §19.1, §19.2 |
| **`/supabase` not created** — Phase 2 owns `config.toml`, `migrations/` and `seed/` | Phase 2 |

Verified at completion: `npm install`, `npm run build`, `npm run typecheck`, `npm run lint`,
`npm run test`, `npm run test:e2e` all pass; the dev server boots and serves; the import-boundary
rule was proven to fail a cross-feature import and permit a same-feature relative import.

---

# ◆ DECISION GATE — architecture and business decisions closed

**Sits between Phase 1 and Phase 2. Nothing downstream starts until it passes.**

**Objective.** Prove that every question capable of changing migration design, the permission
model or the hosting footprint has been answered and recorded, before a single migration is
written or a single Supabase project is created.

**Why here.** Migrations are append-only once applied to any shared environment (§21.2), and the
Supabase region is irreversible once a project exists (TODO-BD-08). A decision arriving after
either of those is a data migration, not an edit.

## Gate criteria

| # | Criterion | Status |
|---|---|---|
| 1 | All blocking audit findings that affect migration design are resolved | **✅ Met** — all 10 blockers, and the two migration-affecting sub-questions (H-10 `verbal_confirmation`, M-05 constraint) both answered |
| 2 | The approved `TODO-BD` values are recorded | **✅ Met** — all 12 in `/docs/DECISIONS.md` §A, including the final Erode taluk list |
| 3 | The Supabase region is fixed as Mumbai (`ap-south-1`) | **✅ Met** — TODO-BD-08 |
| 4 | The implementation plan reflects all approved architecture deviations | **✅ Met** — this document; ADR-001 … ADR-014, C-1 … C-5 |
| 5 | The audit resolution log is updated | **✅ Met** — `/docs/SPEC_AUDIT.md`, 53 of 53 resolved |

## What closed the two migration-blocking questions

| Ref | Answer | Effect on the schema |
|---|---|---|
| **H-10 sub** | Quotation fields are required **only when entering `quoted`** — not `negotiation`, not `verbal_confirmation`. | `010_opportunities.sql`: `check (stage <> 'quoted' or (…))`. Regression test: `selection → negotiation` succeeds with no quotation data. |
| **M-05** | **Yes — add the constraint.** `phone is not null or email is not null` on `accounts`. | `005_accounts.sql`: `constraint account_reachable`. **ADR-013.** |

## Standing constraint

> **Do not start production or staging provisioning before this gate is passed.**
> Local Supabase under Docker is permitted at any time; it creates nothing irreversible.

**Exit — the gate is met on the documentation side.** Criteria 1–5 are satisfied and no audit
finding remains open. Passing the gate is now an act of approval, not further analysis:
**Phase 2 begins on the Project Owner's go-ahead.**

---

# Phase 2 — Supabase configuration

> ## ⚠ STATUS: IMPLEMENTED — DATABASE WORKFLOW VERIFICATION BLOCKED BY ENVIRONMENT
>
> **Phase 2 is not complete.** Every implementation artifact is delivered and the code-level
> checks pass, but the four database-workflow steps that this phase exists to prove —
> `supabase start`, `supabase db reset`, `supabase db push` and local type generation — **could
> not be executed** and therefore **remain unverified**.
>
> **The acceptance criteria below are not weakened, waived or reinterpreted.** They stand exactly
> as written and remain unmet until the workflow is proven on a networked environment.
>
> **Phase 3 is blocked** until a networked environment can successfully run the local Supabase
> stack, or an equivalent approved verification environment is available. See *Blocked by the
> environment* below.

**Spec phase:** 1 Foundation · **Spec sections:** §17.1, §17.4, §21.1, §21.2 · **TODO-BD-08 resolved**

**Objective.** Local Supabase running under Docker, `supabase/config.toml` committed, a staging
project provisioned in Mumbai, and the migration workflow proven end to end on an empty database.

**Dependencies.** Phase 1 and the **Decision Gate**.

**Approved decisions applied here.**
- **TODO-BD-08** — Indian data residency **is** a requirement. Staging and production are
  provisioned in **Supabase Mumbai `ap-south-1`**, and **in no other region**. The region cannot
  be changed after project creation.
- **ADR-009 / H-07** — `lib/supabase/admin.ts` has three permitted callers: cron routes, the
  import executor, and the user-provisioning Server Action.

**Files/modules.** `supabase/config.toml`, `supabase/migrations/` (empty), `supabase/seed/`,
`src/lib/supabase/{client,server,admin}.ts`, `.env.local` (untracked), `.env.example` (tracked).

**Database changes.** None yet — this phase proves `supabase start`, `db reset`, `db push` and
`gen types` work.

**Tests.** `supabase db reset` from empty succeeds. `supabase gen types typescript` produces
`src/types/database.types.ts`. A runtime guard test proving `lib/supabase/admin.ts` **throws**
when `typeof window !== 'undefined'` (§15.7).

**Acceptance criteria.**
- Three clients exist with distinct responsibilities: browser (anon), server/SSR (anon + user
  session via `@supabase/ssr`), admin (service-role, server-only, guarded).
- The staging project's region is **`ap-south-1`**, verified in the Supabase dashboard and
  recorded in `/docs/DEPLOYMENT.md`.
- `.env.example` documents every §17.4 variable plus the M-28 additions; `.env.local` is ignored.
- The service-role key is not referenced anywhere under `src/app` (lint rule or grep in CI).
- Type generation is a documented, repeatable script.

**Risks.** Docker availability in CI (**M-20**, resolved — strategy defined in Phase 19).
Committing a real key to `.env.example` — the file must contain placeholders only.
**Provisioning in the wrong region is unrecoverable.**

## As built — Phase 2, implemented 2026-08-19

**Implementation artifacts: complete.** Everything this phase was asked to build exists and is
verified at the code level. What is *not* complete is the verification of the database workflow,
which no amount of implementation can supply from inside this environment.

**Delivered and verified**

| Item | Detail |
|---|---|
| `supabase/config.toml` | Generated by `supabase init`, then tuned: `project_id = "jsk-crm"`, `site_url = http://localhost:3000`, Postgres `major_version = 17`, and **`enable_signup = false`** on `[auth]` and `[auth.email]` per §3.2 (no self-registration) |
| `supabase/migrations/`, `supabase/seed/` | Created and **empty** — no CRM migration exists |
| Three client boundaries | `src/lib/supabase/{client,server,admin}.ts` plus `env.ts` for fail-loud variable access |
| Admin-client guard | Throws on **module evaluation** and on **factory call** when `typeof window !== 'undefined'`; four unit tests |
| Admin-client lint boundary | `no-restricted-imports` confines `@/lib/supabase/admin` to cron routes, the import executor and user provisioning (§15.7, ADR-009); proven to reject a feature-folder import and permit a cron-route import |
| Type-generation workflow | `npm run db:types` → `supabase gen types typescript --local > src/types/database.types.ts`; documented in `/docs/SETUP.md` |
| npm scripts | `db:start`, `db:stop`, `db:status`, `db:reset`, `db:push`, `db:types` — the CLI is pinned as a devDependency so every developer runs one version |
| Bundle grep | The §19.4 check ran early: no service-role identifier in the built client bundle |

**Blocked by the environment, not by the implementation**

**Confirmed 2026-08-19 by the Project Owner as an external environment/network egress
limitation.** It is not an implementation defect and must not be worked around.

`supabase start` could not run. Docker itself works — the daemon starts and `docker` responds —
but **all container image blob fetches are refused by the network egress policy**:
`production.cloudfront.docker.com` and `d2glxqk2uabbnd.cloudfront.net` return **403 to CONNECT**.
Sixteen images are required (`supabase/postgres`, `gotrue`, `postgrest`, `realtime`,
`storage-api`, `studio`, `kong`, `vector`, `logflare`, `edge-runtime`, `mailpit`, `postgres-meta`
and their bases); every pull failed and **zero containers started**.

**The required database workflow remains unverified.** These four steps are the first task of any
environment that can pull images:

| Step | Status |
|---|---|
| `supabase start` | **UNVERIFIED** — image pulls refused |
| `supabase db reset` (from empty) | **UNVERIFIED** — local stack not running |
| `supabase db push` | **UNVERIFIED** — no linked project |
| `supabase gen types typescript --local` | **UNVERIFIED** — local stack not running |

`api.supabase.com` is blocked by the same policy (**403 to CONNECT**), so remote provisioning was
not attempted either. **No Supabase project exists.**

**Standing prohibitions while this blocker holds** (Project Owner, 2026-08-19). Do not: bypass the
network policy; configure alternate registries to evade the restriction; claim any of the four
steps succeeded; write Phase 3 migrations to compensate for the missing database; or provision
staging or production through an unverified path.

### Phase 3 entry condition — MET (ADR-018)

**Phase 3 must not start until the local Supabase stack runs successfully in a networked
environment, or an equivalent approved verification environment is available.**

**An equivalent environment was established on 2026-08-19 and the condition is met.** The Supabase
container registry is denied by the environment's egress policy, so `supabase start` cannot run;
the approved alternative is a **real PostgreSQL 16 server** with the platform bootstrap in
`supabase/platform/`, migrations applied by the Supabase CLI over `--db-url`, and types generated
by `@supabase/postgres-meta`. See **ADR-018**. The migrations have since been applied cleanly from
empty **twice in a row** and are covered by 154 integration tests.

Phase 3 writes seventeen migrations whose acceptance criterion is *"`supabase db reset` applies
the full sequence cleanly to an empty database, twice in a row"*. Writing migrations that cannot
be applied would produce unverifiable schema — and migrations are append-only once applied to any
shared environment (§21.2), so a defect introduced blind becomes a permanent second migration
rather than an edit. §21's definition of done is explicit: *migrations applied* and *tests
passing*, not *migrations written*.

`src/types/database.types.ts` **now exists**, generated from the verified database. It is never
hand-written and never hand-edited — regenerate it instead.

**Resolved during review — `server-only` declined**

`server-only` was proposed to add a build-time error when `lib/supabase/admin.ts` is reached from
client code. **Declined 2026-08-19 by the Project Owner.** The three-layer admin boundary is
approved as sufficient: (1) the runtime browser guard on module evaluation and on the factory,
(2) the ESLint import restriction, and (3) client-bundle verification plus the guard unit tests.
**No further dependency is to be added for this.** Recorded in ADR-000.

---

# ★ Master Phase 1 — Platform foundation (2026-08-19)

A consolidated pass covering the original Phases 3–6: the database, authentication, the outlet
model, RLS, the shared service layer and generated types. **No CRM feature screens.**

| Deliverable | State |
|---|---|
| Real database runtime | ✅ PostgreSQL 16 + platform bootstrap (ADR-018) — Docker registry blocked |
| Migrations 001–017 | ✅ applied cleanly from empty, twice |
| `src/types/database.types.ts` | ✅ generated from the verified database |
| Outlet model | ✅ `outlets` + `user_outlets` + `outlet_id`; `branch` retired (ADR-016) |
| Authentication | ✅ email/password, SSR sessions, no self-registration, role-aware routing |
| RLS and permissions | ✅ 39 policies, one DELETE policy, outlet scope enforced at the boundary |
| Core services | ✅ errors · money · dates · phone · validation · permissions · transitions · settings · auth · user · outlet |
| Tests | ✅ 232 unit · 154 integration/RLS · 8 E2E smoke |
| Gate | ✅ typecheck · lint · build · bundle check all clean |
| Hosted Supabase verification | ⛔ **blocked** — egress policy denies `api.supabase.com`; no account attached. See `/docs/DEPLOYMENT.md` §0 |

**P1-05 — closed.** `opportunity_events.created_at` defaults to `clock_timestamp()` (**ADR-019**),
so events written in one transaction stay orderable. Covered by three regression tests.

**Open, needing infrastructure — the one remaining blocker.** Hosted verification could not run:
the Supabase control plane and data plane are both denied by this environment's egress policy, and
no account is attached. Supabase Auth, PostgREST, Storage and the live SSR session path are
therefore **unverified**. Attempted with official tooling only; nothing was bypassed. Full detail
and the steps to close it are in `/docs/DEPLOYMENT.md` §0.

**Not started:** every CRM feature screen, dashboards, reports, import, file uploads, cron and
notification automation. Those are Master Phases 2–5.

---

# Phase 3 — Database migrations and database helpers

> ## ✅ BUILT — Master Phase 1, 2026-08-19
>
> Seventeen migrations, applied cleanly from empty twice in a row against a real PostgreSQL 16
> server (ADR-018). Two defects were found by executing them and fixed before anything shipped:
> the audit trigger's `CASE` resolved to `text` and would have rejected **every** stage change,
> and `guard_record_scope()` fired for service-role callers that already bypass RLS. Both are
> recorded in `/docs/DATABASE.md`.
>
> **Deviations, each with an ADR recorded before the migration was written:** `outlets` and
> `user_outlets` replace `branch` (ADR-016, thirteen tables); ADMIN loses automatic business-data
> visibility (ADR-017).
>
> The original blocking note is preserved below as the record of why it was blocked.
>
> ## ⛔ BLOCKED — do not start
>
> Phase 3 requires a working local Supabase stack: its acceptance criterion is that
> `supabase db reset` applies the full migration sequence cleanly to an empty database, twice in
> a row. That stack **could not be started** during Phase 2 because container image pulls are
> refused by the network egress policy.
>
> **Entry condition:** the local Supabase stack runs successfully in a networked environment, or
> an equivalent approved verification environment is available. Until then, **do not write
> migrations to compensate for the missing database** — migrations are append-only once applied
> (§21.2), so a defect introduced blind becomes a permanent extra migration rather than an edit.

**Spec phase:** 1–5 (migrations 001–013) · **Spec sections:** §5 (all), §6, §10.3, §17.6

**Objective.** The complete eleven-table schema, all enums, all constraints, all indexes, the
`touch_updated_at` and `log_opportunity_event` triggers, `normalize_phone`, the
`v_opportunity_flags` view, and the `system_settings` seed — applied cleanly to an empty database
in a corrected §5.12 order, **with RLS enabled in each table's own migration**.

**Dependencies.** Phase 2. **All blockers resolved** (B-01, B-03, B-04, B-05, B-06, B-07, B-08,
B-10; H-01, H-03, H-04, H-06, H-10; M-07, M-08, M-23).
**⚠ H-10's `verbal_confirmation` sub-question and M-05 must be answered at the Decision Gate.**

**Files/modules.**
```
supabase/migrations/
  001_extensions_and_helpers.sql   pgcrypto, pg_trgm, normalize_phone() IMMUTABLE (B-06), touch_updated_at()
  002_enums.sql                    all enum types (§5.1) — lowercase opportunity_stage preserved (M-23)
  003_users.sql                    users + trigger + handle_new_auth_user() (ADR-009)
                                   + RLS: enumerated SELECT/INSERT/UPDATE, no FOR ALL (H-06)
  004_import.sql                   import_batches, import_rows + RLS
  005_accounts.sql                 accounts WITHOUT referred_by_contact_id FK (B-07)
                                   + account_reachable check constraint (ADR-013) + RLS
  006_contacts.sql                 contacts + RLS
  007_accounts_fk.sql              alter table accounts add constraint … references contacts (B-07)
  008_projects.sql                 projects + RLS
  009_project_stakeholders.sql     + three partial unique indexes + RLS incl. the ADR-004 DELETE policy
  010_opportunities.sql            + check constraints (quoted_requires_quotation narrowed, ADR-006)
                                   + sla_notified_at column (ADR-002) + indexes + RLS
  011_activities.sql               activities + RLS (24-hour author edit window)
  012_opportunity_events.sql       + log_opportunity_event(): reads app.event_reason GUC (ADR-001),
                                     resolves actor via the system user (ADR-003),
                                     maintains stage_changed_at (H-01) + RLS (no UPDATE, no DELETE)
  013_system_settings.sql          + seed rows incl. the maintenance failure counters (ADR-014)
                                   — applied BEFORE its consumers (H-03)
  0xx_flags_view.sql               v_opportunity_flags WITH (security_invoker = true),
                                     IST date expressions (B-10), coalesce(…, false) booleans (M-07)
  0xx_system_user_seed.sql         the dedicated automated-write actor (ADR-003), is_active = false
src/types/database.types.ts        generated
src/lib/dates.ts                   IST business-day helpers, behaviourally identical to the SQL (B-10)
```

**Database changes and the approved deviations they carry.**

| Change | Source |
|---|---|
| `normalize_phone()` declared `IMMUTABLE` and deterministic | B-06 |
| `referred_by_contact_id` FK deferred to 007 | B-07 |
| RLS enabled **in each table's migration**, not in 015 | H-04 |
| `users` policies enumerated; **no `FOR ALL`, no DELETE** | H-06 |
| `project_stakeholders` gains the **only** DELETE policy in the schema | **ADR-004** |
| `opportunities.sla_notified_at timestamptz` added | **ADR-002** |
| `accounts` gains `account_reachable check (phone is not null or email is not null)` | **ADR-013** |
| `quoted_requires_quotation` narrowed to `stage <> 'quoted' or (…)` — **not** `negotiation`, **not** `verbal_confirmation` | **ADR-006**, confirmed |
| `stage_changed_at` maintained by the trigger | H-01 |
| Trigger reads `app.event_reason`; actor resolves to the system user | **ADR-001**, **ADR-003** |
| `013_system_settings` applied before its consumers | H-03 |
| Every date expression `(now() at time zone 'Asia/Kolkata')::date` | B-10 |
| Flag booleans `coalesce(…, false)` | M-07 |

**`system_settings` seed — approved values.**

| Key | Seeded value | Source |
|---|---|---|
| `cities` | **The ten Erode District revenue taluks** — Erode, Perundurai, Modakkurichi, Kodumudi, Gobichettipalayam, Sathyamangalam, Bhavani, Anthiyur, Thalavadi, Nambiyur | **TODO-BD-06 — final** |
| `stage_probabilities` | as §5.10 | — |
| `high_value_threshold_paise` | **`30000000`** (₹3,00,000) | **TODO-BD-02 — changed** |
| `account_dormancy_days` | `30` | **TODO-BD-03 / ADR-010** |
| `opportunity_dormancy_days` | `30` | **TODO-BD-03 / ADR-010** |
| `stage_stall_days` | as §5.10 | TODO-BD-03 |
| `new_enquiry_sla_hours` | `48` | — |
| `owner_summary_schedule` | `{"cadence":"daily","hour":19}` | TODO-BD-05 |
| `material_types` | `[]` | TODO-BD-04 |
| **`maintenance_consecutive_failures`** | `0` | **ADR-014 — new key** |
| **`maintenance_last_failure_at`** | `null` | **ADR-014 — new key** |

> **Geography.** `cities` holds **revenue taluks**, despite the key name (which §5.10 fixes).
> **Chennimalai is not a revenue taluk** — it is a development block and firka within Perundurai
> taluk, and belongs in `accounts.area` / `projects.area`, which stay **free text** in V1. Lower
> geographic units are not enumerated. **Do not invent geographic units.**

> **`maintenance_consecutive_failures` and `maintenance_last_failure_at` are operational state,
> not tunable thresholds.** They are written only by the maintenance cron route and must not be
> editable at `/settings`.

**`dormancy_days` is retired and must not be seeded.** No value in this table may appear as a
literal anywhere in application code.

**Tests (integration, Vitest + local Supabase).**
- `supabase db reset` applies the full sequence cleanly to an empty database, twice in a row.
- Every check constraint rejects its invalid case: won without value, won without `closed_at`,
  lost without reason, lost without `closed_at`, quoted without quotation fields, next-action
  half-set, nurture without date, contact with neither phone nor email, stakeholder with neither
  target.
- **`selection → negotiation` succeeds with no quotation data** (ADR-006) — the required
  regression test. `verbal_confirmation` is likewise reachable without quotation fields; only
  `quoted` requires them.
- **`accounts` rejects a row with neither phone nor email** (ADR-013), and the violation maps to
  a friendly message rather than a raw Postgres error.
- `one_primary_per_project` rejects a second primary.
- `log_opportunity_event()` writes exactly one row on insert, on stage change, on owner change,
  and both rows when stage and owner change in one statement.
- **The reason GUC reaches the event row** and does not leak to the next transaction (ADR-001).
- **A service-role write records the system user as `actor_id`** and does not violate not-null
  (ADR-003).
- `stage_changed_at` advances on stage change and only then (H-01).
- `normalize_phone`: `+91 98765-43210`, `098765 43210`, `919876543210`, `9876543210` →
  `9876543210`; `12345` → null.
- `v_opportunity_flags` has `security_invoker = true` (assert against `pg_class.reloptions`).
- Timezone: an opportunity due "today IST" is due today when queried at 23:00 UTC (B-10).
- **DELETE succeeds on `project_stakeholders` and fails on all ten other tables**, for every role
  (ADR-004).

**Acceptance criteria.** §23.9 first bullet — "migrations apply cleanly to an empty database".
Eleven tables, no more (§4.1). Every column in §5 present; the **only** column added beyond §5 is
`opportunities.sla_notified_at` under ADR-002. Generated types compile.

**Risks.** The circular `accounts ↔ contacts` FK (§25) is handled but easy to reintroduce by
pasting §5.3 verbatim. Migration files are append-only once applied to any shared environment
(§21.2). **H-10's sub-question must be answered before 010 is written** — guessing it wrong means
a new migration, not an edit.

---

# Phase 4 — Authentication and users

> **✅ BUILT — Master Phase 1, 2026-08-19.** Email/password sign-in, SSR sessions refreshed in
> middleware, role-aware landing (`/today`, `/dashboard`, `/settings`), no self-registration
> anywhere, and OWNER/ADMIN provisioning through `user.service.ts` with the authorization check
> **before** the admin client (ADR-009). A deactivated user is refused at the database boundary,
> not only at login: every policy resolves ownership through `current_user_id()`, which filters on
> `is_active`, so a token issued before deactivation buys nothing.
> **Not verified here:** Supabase Auth's own behaviour, including C-5 login throttling (ADR-018).

**Spec phase:** 1 Foundation · **Spec sections:** §3.2, §5.2, §12.2, §15.3, §15.8, §17.2

**Objective.** Email/password login via Supabase Auth, httpOnly cookie sessions via
`@supabase/ssr`, role-based landing redirects, and OWNER/ADMIN user management — with no
self-registration.

**Dependencies.** Phase 3. **H-07, M-01, M-12 and M-25 all resolved.**

**Approved decisions applied here.**
- **ADR-009 / H-07** — the user-provisioning Server Action may use the service-role client, **but
  only after a server-side OWNER/ADMIN authorization check**. The order is the control.
  `handle_new_auth_user()` defaults `role` to `SALESPERSON` and `branch` to `'MAIN'`.
- **M-01** — ADMIN's landing route is **`/settings`**, not `/dashboard`.
- **M-25** — deactivation behaviour is documented: `user_role()` returns null immediately so every
  policy denies, while the issued JWT remains valid until expiry.
- **C-5 / M-12** — login rate limiting uses **Supabase Auth's built-in** limits. **No Redis, no
  distributed rate-limiting infrastructure.** Throttling failures surface as a plain-language
  message — never the provider's raw error, a retry-after internal, or any hint of which
  credential was wrong.

**Files/modules.** `src/app/(auth)/login/page.tsx`, `src/middleware.ts` (session refresh + route
guards), `src/app/(app)/layout.tsx`, `src/app/settings/users/*`,
`src/services/user.service.ts`, `src/lib/permissions.ts`, `src/features/auth/*`.

**Database changes.** None (003 already applied).

**Tests.**
- Unit: role → landing route mapping for all four roles, ADMIN → `/settings` (M-01).
- Integration: a deactivated user cannot log in; an active salesperson can; `user_role()` returns
  null for `is_active = false`; the system user (ADR-003) cannot authenticate.
- **Security: a salesperson calling the provisioning action is rejected *before* any admin client
  call is made** (ADR-009).
- E2E: login, logout, session persistence across reload, unauthenticated access to every `(app)`
  route redirects to `/login` (§19.4).
- Security: the sign-up endpoint is disabled — self-registration returns an error (§3.2).
- **Rate limiting (C-5):** repeated failed logins eventually throttle; the provider error maps to
  `AppError` rather than reaching the UI as a provider string; the UI renders the plain-language
  message. **Automated, not manual.**

**Acceptance criteria.** §22 Phase 1 gate: *"a new dev can clone, run, log in as the seeded OWNER,
and create a salesperson who can log in."* Sessions are httpOnly cookies, never `localStorage`.
Route guards are middleware-level, not component-level.

**Risks.** ADR-009's check-before-admin-client ordering is a privilege-escalation hole if
reversed — it carries a dedicated negative test. Rate-limit behaviour depends on the platform's
configured limits, which are recorded in `/docs/DEPLOYMENT.md` once the projects are provisioned.

---

# Phase 5 — RLS and permissions

> **✅ BUILT — Master Phase 1, 2026-08-19.** 39 policies across 13 tables, **one** DELETE policy
> (`project_stakeholders`, ADR-004), RLS enabled in each table's own migration (H-04), and outlet
> scope enforced at the database boundary (ADR-016). 154 integration tests, every one asserted
> **as the restricted role**.

**Spec phase:** 1–5 (written per table), audited in 8 · **Spec sections:** §3.1, §3.2, §15 (all), §19.2

**Objective.** The RLS helper functions, the policy pattern, and the integration-test harness that
every later phase extends. After this phase, adding a table without policies and negative tests is
a phase failure.

**Dependencies.** Phases 3, 4. **B-02, B-08, H-04, H-05, H-06, H-12, M-15, M-19 all resolved.**

**Approved decisions applied here.**
- **B-02** — reassignment goes through the `SECURITY DEFINER` `reassign_opportunity` RPC.
  **The §15.5 fallback `with check` is invalid SQL and recursive and must never be written.**
- **H-05** — a dedicated `can_reassign() = MANAGER or OWNER`. **ADMIN cannot reassign, by any
  route.**
- **H-06** — the `users` `FOR ALL` policy is replaced by enumerated SELECT/INSERT/UPDATE.
- **H-12** — `can_see_account`, `can_see_project`, `can_see_opportunity`, `can_see_activity`
  defined as `SECURITY DEFINER`, `set search_path = public`, least privilege.
- **B-04** — role helpers created before the tables; context helpers after.
- **ADR-004 / B-08** — `project_stakeholders` carries the schema's only DELETE policy, scoped
  identically to its UPDATE policy.
- **M-19** — every helper call wrapped `(select public.fn(...))` for InitPlan caching.

**Files/modules.**
```
supabase/migrations/
  0xx_rls_helpers_role.sql      user_role, is_manager_or_above, is_owner_or_admin, can_reassign (H-05)
  0xx_rls_helpers_context.sql   owns_opportunity_on_*, can_see_* (H-12) — after their tables (B-04)
  0xx_reassign_opportunity.sql  SECURITY DEFINER RPC gated on can_reassign() (B-02, H-05)
  015_rls_policies.sql          AUDIT/HARDENING pass — per-table policies already exist (H-04)
src/lib/permissions.ts          UI-level capability map — mirrors RLS, never substitutes for it
tests/integration/rls/*.test.ts one file per table
```

**Database changes.** RLS is already enabled per table from Phase 3 (H-04). This phase adds the
helpers, the RPC, and 015 as a hardening audit that asserts the end state rather than creating it.

**Tests (§19.2 — the most important tests in the project).** Seeded users of each role, and
**every assertion made as the restricted role, never as OWNER** (§23).
- Salesperson A cannot SELECT / UPDATE / INSERT-on-behalf-of salesperson B's records.
- Salesperson **can** read an account they do not own when they own an opportunity on it (§15.4)
  — and can read the account's contacts and projects by the same route (H-12).
- Salesperson cannot change `owner_id` by any route: direct UPDATE, PostgREST, and the RPC (B-02).
- **ADMIN cannot reassign** (H-05); MANAGER and OWNER can.
- **No role can DELETE from any table except `project_stakeholders`** (H-06, ADR-004) —
  asserted table by table, including `users`.
- A salesperson cannot escalate their own role via profile update (§15.3).
- `v_opportunity_flags` returns only the caller's rows for a salesperson (§25).
- Archived records excluded from active queries, included for authorised roles.

**Acceptance criteria.** §23.8 bullets 2–4. Every capability row in §3.1 has at least one passing
positive test and one passing negative test — **with §23.1's wording corrected per M-16**: a
salesperson sees their own accounts *plus* work-context accounts. Policy performance measured
against a seeded dataset before Phase 14 depends on it (M-19).

**Risks.** **RLS recursion on `users`** — §25 names it as the most likely early blocker; the
`SECURITY DEFINER` helpers are the answer and must not be bypassed. M-19 — subquery-bound policies
remain the main threat to §12.8's 400 ms budget; measure here, not in Phase 20.

---

# Phase 6 — Core services and business logic

> **✅ FOUNDATION BUILT — Master Phase 1, 2026-08-19.** The error contract, Zod conventions, money,
> phone, dates, permissions, the full transition matrix, and the settings, auth, user and outlet
> services. The account, contact, project, opportunity, activity, dashboard and import services
> arrive with their features — they were deliberately **not** written ahead of the screens that
> use them.

**Spec phase:** 2–7 (foundation laid here) · **Spec sections:** §16 (all), §17.2, §17.3, §18, §8.11

**Objective.** The service layer's spine before any feature uses it: the error contract, Zod
schema conventions, the Server Action → service boundary, money and phone and date libraries, the
transition matrix, and the cached settings reader.

**Dependencies.** Phases 3, 5.

**Approved decisions applied here.**
- **ADR-007 / H-11** — the transition matrix gains **`won → qualified`**, reopen-only,
  MANAGER/OWNER-only, reason required.
- **ADR-006 / H-10** — `selection → negotiation` requires no quotation data.
- **ADR-010 / TODO-BD-03** — `settings.service.ts` exposes `account_dormancy_days` and
  `opportunity_dormancy_days` as distinct values. `dormancy_days` does not exist.
- **B-10 / M-13** — `lib/dates.ts` uses `Intl.DateTimeFormat` and is behaviourally identical to
  the SQL IST helpers.
- **M-29** — `lib/money.ts` is the only conversion point and never `parseFloat`s a rupee string.

**Files/modules.**
```
src/lib/errors.ts               AppError { code, message, field?, details? } + constraint-name → message map (§16.2)
src/lib/money.ts                paise ↔ rupees, Indian grouping, no parseFloat (§17.3)
src/lib/phone.ts                normalisation mirroring the SQL function exactly (§5.3, B-06)
src/lib/dates.ts                Asia/Kolkata business day via Intl, relative recency (B-10, M-13)
src/lib/opportunity/transitions.ts   the §9.2 matrix + won → qualified (ADR-007)
src/services/settings.service.ts     cached read of system_settings — the ONLY reader (§5.10)
src/services/*.service.ts            signatures from §16.1, unimplemented bodies typed
src/features/*/schemas.ts            Zod schemas shared client/server
```

**Database changes.** None. RPC scaffolding for §16.3's transactional operations is written in the
phase that owns each one.

**Tests (unit, §19.1).**
- Money: paise↔rupee round-trips, `₹4,20,000` formatting, zero, large values, negative rejected.
- Phone: `+91`, `0`, `91`, spaces, dashes, brackets, too-short, non-numeric — and **parity with
  the SQL `normalize_phone`** over the same fixture table.
- Transition matrix: **every** valid and invalid pair, exhaustively, **including the added
  `won → qualified` and the still-forbidden `won → anything else`**.
- Dates: overdue/due-today across the IST↔UTC boundary (B-10), month boundaries.
- Error mapping: every constraint name in §5.7 maps to a friendly message; an unmapped Postgres
  error becomes `INTERNAL` and never leaks its text (§23.8).

**Acceptance criteria.** No business rule exists in a component. No `system_settings` value is
read anywhere but through `settings.service.ts`. **No approved `TODO-BD` value appears as a
literal anywhere** — resolution fixed the values, not the mechanism (§24). Every service throws
`AppError`, never a raw Postgres error.

**Risks.** Drift between `lib/phone.ts` and the SQL `normalize_phone` — the parity test is the
control. M-23 — lowercase stage literals; use generated enum types, never string literals.

---

# Phase 7 — Shared UI and design system

**Spec phase:** 1 Foundation · **Spec sections:** §12.1, §12.3, §12.5, §12.6, §12.7, §2.4

**Objective.** The AppShell, navigation, and the §12.5 component inventory — built once, before
any feature screen, so no feature invents its own card, badge or empty state.

**Dependencies.** Phase 1 (Phase 6 for `MoneyText`). **M-03 and M-11 resolved.**

**Approved decisions applied here.**
- **M-03** — unauthorised record access renders **404 / not-found**, never a Forbidden screen that
  confirms the record exists. The §12.6 "Forbidden" state is reserved for route-level denial where
  no record identity is revealed.
- **C-4 / M-11** — creation and editing use **explicit routes**: `/opportunities/new`,
  `/contacts/new`, `/projects/:id/edit`, `/opportunities/:id/edit`. **Account tabs use the
  existing `/accounts/:id` route with URL/query state** (`?tab=projects`), not nested routes —
  the same "state in URL params" convention `FilterBar` already uses (§12.5).

**Files/modules.** `src/components/ui/*` (shadcn primitives), `src/components/layout/{AppShell,
BottomNav,Sidebar,TopBar}.tsx`, and `src/components/shared/`: `RecordCard`, `DataTable`,
`StageBadge`, `NextActionChip`, `MoneyText`, `PhoneActions`, `ActivityTimeline`,
`QuickDateButtons`, `DuplicateWarning`, `FilterBar`, `EmptyState`, `ConfirmDialog`,
`StakeholderChips`.

**Database changes.** None.

**Tests.** Unit tests only where logic exists (§19.5): `MoneyText` formatting, `NextActionChip`
state selection (overdue/due/missing/none), `StageBadge` mapping, `FilterBar` URL-param
round-trip. A repository-wide test asserting the string "revenue" (case-insensitive) appears in
**no** user-facing string (§2.4, §23.6).

**Acceptance criteria.** All seven §12.6 states implemented as reusable components: loading
skeletons (never a full-page spinner), empty-no-data, empty-filtered, error, forbidden, offline,
saving. Mobile bottom nav with the raised `+` sheet; desktop sidebar with role-gated items
**hidden, not disabled** (§12.3). Colour never carries meaning alone (§12.1). 16px base, tabular
numerals for money. Single-column forms, validate on blur, **never lose entered data** (§12.7).

**Risks.** Scope creep into a component library beyond the §12.5 inventory. Tab state in the URL
must survive back/forward navigation and be server-readable, since `/accounts/:id` is a Server
Component.

---

# Phase 8 — Accounts / customers

**Spec phase:** 2 Identity · **Spec sections:** §5.3, §8.1, §8.4, §8.9, §11.1, §12.4, §23.1

**Objective.** Account CRUD, the Customer 360 screen, and the primary mobile create flow —
customer + opportunity + activity in one transaction, under 60 seconds.

**Dependencies.** Phases 5, 6, 7. Phase 11's opportunity insert is needed by §11.1's transaction;
build the RPC here and the opportunity UI in Phase 11. **M-04, M-16 resolved. M-05 open with a
safe default.**

**Approved decisions applied here.**
- **M-04** — resolved by §25.3, which is binding: **next action is strongly prompted, never
  hard-blocking**, including in §11.1's primary create flow. "Can't say yet" is always available.
- **M-16** — the salesperson visibility criterion is own accounts **plus** accounts where they own
  an opportunity.
- **M-05** — no database constraint is added; the phone-or-email rule is enforced in the service
  and in import validation, and the gap is documented.

**Files/modules.** `src/services/account.service.ts`, `src/features/accounts/*`,
`src/app/(app)/accounts/{page,new/page,[id]/page,[id]/edit/page}.tsx`, Server Actions.

**Database changes.** RPC `create_account_with_opportunity` (`SECURITY INVOKER`, §16.3) inserting
account → opportunity → activity, with the trigger writing `CREATED`.

**Tests.** Unit: title auto-generation (§8.4), defaults. Integration: the RPC is atomic — a
failure at the activity insert leaves no account; RLS negative cases from Phase 5 re-run for
accounts; **the create flow completes with no next action set** (M-04). E2E: §19.3 scenarios 1 and
15 (the 375×812 flow under 60 seconds).

**Acceptance criteria.** §23.1, all ten bullets — with **M-16 corrected**. Customer 360 shows next
action, Won Value, Pipeline Value, last contact and **exactly three** recent activities (§12.4).
Address, GSTIN, source and audit fields live in the Details tab, not above the fold.

**Risks.** The 60-second target is a real constraint: 6–7 fields maximum (§12.1). Duplicate
detection runs on phone blur and must not add perceptible latency.

---

# Phase 9 — Contacts

**Spec phase:** 2 Identity · **Spec sections:** §5.4, §4.4, §11.4, §23.2

**Objective.** Contacts as *additional* people — never forced, attachable to an account or
standalone, with `linked_account_id` for a contact who is also a customer.

**Dependencies.** Phase 8. **H-12 and M-11 resolved.**

**Files/modules.** `src/services/contact.service.ts`, `src/features/contacts/*`,
`src/app/(app)/contacts/{page,new/page,[id]/page}.tsx` — **`/contacts/new` is an explicit route**
(C-4).

**Database changes.** None (006 applied). The `referred_by_contact_id` FK from 007 becomes usable.

**Tests.** Integration: `contact_reachable` rejects neither-phone-nor-email; RLS — a salesperson
reads contacts of an account they can see (H-12). E2E: standalone architect contact; contact
linked to an account that is also a customer.

**Acceptance criteria.** §23.2, all four bullets. **A homeowner account works with no contact
record** — the UI must never force contact creation (§5.4).

**Risks.** §12.2's map does not list `/contacts/new`; it is added under C-4 and must be
role-gated like every other creation surface.

---

# Phase 10 — Projects and project stakeholders

**Spec phase:** 3 Projects · **Spec sections:** §5.5, §5.6, §4.4, §11.2, §11.4, §23.3

**Objective.** Projects under an account, and the multi-stakeholder model working end to end —
including the §4.4 worked example with three stakeholders and three opportunities on one project.

**Dependencies.** Phase 9. **B-08 and M-09 resolved.**

**Approved decisions applied here.**
- **ADR-004 / B-08** — `removeProjectStakeholder()` **deletes the link row**. This is the only
  hard delete in the system. No `archived_at` is added, so §5.6's three partial unique indexes
  stay exactly as specified.
- **M-09** — `setPrimaryStakeholder()` runs as **two statements in one transaction** (clear, then
  set), because the partial unique index is not deferrable.

**Files/modules.** `src/services/project.service.ts`, `src/features/projects/*`,
`src/app/(app)/projects/{page,new/page,[id]/page}.tsx`, `StakeholderChips` wiring.

**Database changes.** None (008, 009 applied, including the ADR-004 DELETE policy).

**Tests.** Integration: second primary stakeholder rejected by the partial unique index and
mapped to a friendly message (§11.2); a stakeholder referencing a contact, an account, and both;
`setPrimaryStakeholder` as two statements in one transaction (M-09); **`removeProjectStakeholder`
succeeds while DELETE on every other table still fails** (ADR-004). E2E: §19.3 scenarios 2 and 3;
§23.3's "project detail lists **multiple** opportunities" — verify visually, it is the model's key
behaviour (§11.3).

**Acceptance criteria.** §23.3, all six bullets. The UI says **"People on this project"**, never
"stakeholders" (§11.4). Filters by construction stage and city work.

**Risks.** §5.5's "Do not add fields not listed" is easy to violate here. The ADR-004 exception
must not widen: a reviewer should be able to grep for `for delete` and find exactly one policy.

---

# Phase 11 — Opportunities and pipeline

**Spec phase:** 4 Sales · **Spec sections:** §5.7, §5.9, §8.5–§8.7, §9 (all), §11.3, §11.7–§11.9, §23.4

**Objective.** The central table working: creation from account and from project, the stage
transition matrix, won/lost, reopen, assignment/reassignment, the audit trail, and the desktop
kanban.

**Dependencies.** Phases 8, 10. **B-01, B-02, B-03, H-10, H-11, H-13, M-11, M-24 all resolved.**

**Approved decisions applied here.**
- **ADR-001 / B-01** — the reason reaches the event row through the `app.event_reason` GUC.
- **ADR-006 / H-10** — `selection → negotiation` needs no quotation data; the constraint binds
  `quoted` only.
- **ADR-007 / H-11** — reopening a won opportunity moves it to **`qualified`** and **clears
  `final_order_value` and `closed_at`**, preserving the historical `WON` event.
  **Confirmed: `accounts.status` is NOT changed automatically** — account status is independent of
  any single opportunity, because the account may hold other WON opportunities.
- **C-1 / H-13** — the audit trail is surfaced **in the opportunity detail timeline**, with audit
  events **visually and semantically distinguishable from activities**. **No `/audit` route, no
  `team_id`, no `manager_id`.** "Own team" is the single-manager structure, which
  `can_see_opportunity()` already expresses.
- **C-4 / M-11** — `/opportunities/new` and `/opportunities/:id/edit` are explicit routes.
- **B-02 / H-05** — reassignment via the `SECURITY DEFINER` RPC gated on `can_reassign()`.
- **M-24** — `REOPENED`, `ARCHIVED` and `RESTORED` events have defined writers, using the same
  GUC mechanism so the trigger stays the single writer.
- **TODO-BD-01** — `project_id` remains **optional for all opportunities, including high-value
  ones**. No mandatory-project rule, no settings key, no conditional validation.

**Files/modules.** `src/services/opportunity.service.ts`, `src/lib/opportunity/transitions.ts`
(from Phase 6), `src/features/opportunities/*`,
`src/app/(app)/opportunities/{page,board/page,[id]/page}.tsx`, stage/won/lost/reassign/reopen
modals.

**Database changes.** RPC `change_opportunity_stage` (§16.3); RPC `reassign_opportunity`
(`SECURITY DEFINER`); RPC `bulk_reassign`.

**Tests.**
- Unit: the full transition matrix wired into `changeOpportunityStage`, including `won → qualified`
  and the rejection of every other transition out of `won`.
- Integration: entering `quoted` without quotation fields rejected **by the database**;
  **`selection → negotiation` succeeds with no quotation data**; `won` requires
  `final_order_value`; `lost` requires `lost_reason`; `nurture` requires a date; every stage and
  owner change writes an `opportunity_events` row; **backward transitions store their reason via
  the GUC**; a salesperson cannot change `owner_id` through the RPC; ADMIN cannot reassign.
- **Reopen: `final_order_value` and `closed_at` are cleared, the `WON` event survives, and a
  subsequent re-win cannot inherit the stale value** (ADR-007).
- **Reopen regression (required):** an account with **multiple opportunities including another
  WON one** — reopening one clears that opportunity's `final_order_value` and `closed_at`, leaves
  the other WON opportunity untouched, and **leaves `accounts.status = 'ACTIVE'`**.
- **The timeline renders audit events distinctly from activities** and never implies a person
  performed a system action (C-1).
- E2E: §19.3 scenarios 4, 7, 8, 9, 10, 11, 12.

**Acceptance criteria.** §23.4, all ten bullets. Winning sets `accounts.status = 'ACTIVE'`, clears
next action, and **prompts — never auto-creates** — a follow-on opportunity (§9.3, §11.8). Nurture
is excluded from Pipeline Value everywhere. **There is no `follow_up` stage and there must never
be one** (§9.1).

**Risks.** The combined activity + audit timeline is the one screen where §10.1's "deliberately
separate, must not be merged" is easiest to violate visually. M-23 — lowercase enum literals.

---

# Phase 12 — Activities and next actions

**Spec phase:** 5 Accountability · **Spec sections:** §5.8, §8.3, §8.10, §10 (all), §11.5, §11.6, §13.2, §23.5

**Objective.** The three-tap activity sheet, the append-only timeline with a 24-hour author edit
window, next-action management, and `/today`.

**Dependencies.** Phase 11. **B-09, B-10, M-04, M-07, M-15 resolved.**

**Approved decisions applied here.**
- **B-10** — every `/today` tile computes its dates in Asia/Kolkata.
- **M-15** — `/today` queries **filter by the current owner explicitly**; RLS scoping is not
  relied on, because MANAGER/OWNER/ADMIN would otherwise see the whole company.
- **M-07** — flag booleans read as `false`, not null, when there is no next action.
- **ADR-005 / B-09** — the site-visit photo upload goes browser → signed URL → Storage, with the
  activity row written by a Server Action.

**Files/modules.** `src/services/activity.service.ts`, `src/features/activities/*`,
`src/app/(app)/today/page.tsx`, `ActivityTimeline`, `QuickDateButtons`, `NextActionChip`.

**Database changes.** RPC `log_activity` (§10.2, §16.3): insert activity → update
`accounts.last_activity_at` and `opportunities.last_activity_at` → apply the next-action decision
→ return the updated opportunity, all in one transaction.

**Tests.**
- Integration: `account_id` is populated even when logging from an opportunity; "cannot determine
  yet" nulls **both** next-action fields; a closed opportunity's next-action fields are untouched;
  the author can update within 24 h and cannot at 24 h + 1 s; **no role can delete**;
  a non-author cannot update at all.
- Unit: `/today` tile queries against fixtures, including the IST boundary (B-10).
- **A manager's `/today` shows only their own work, not the company's** (M-15).
- E2E: §19.3 scenarios 5 and 6.

**Acceptance criteria.** §23.5, all seven bullets. Three taps from an opportunity to a logged
activity. Site visit exposes measurements, location and photo upload. Overdue renders red with
"Overdue by N days". **Logging is never hard-blocked for a missing next action** — the Missing
Next Action list is the control (§8.3, §25.3, M-04).

**Risks.** The upload path is the one approved client-side Supabase write (ADR-005) and must not
become a precedent for any other.

---

# Phase 13 — Search and duplicate detection

**Spec phase:** 2 Identity · **Spec sections:** §8.9, §11.10, §5.3, §5.4, §12.2, §23.1

**Objective.** Permission-scoped global search in the §11.10 order, and advisory duplicate
detection that warns and never blocks.

**Dependencies.** Phases 8, 9. Trigram indexes from Phase 3.

**Approved decisions applied here.**
- **TODO-BD-06** — the city component of the POSSIBLE-confidence rule resolves against the Erode
  District list in `system_settings.cities`, with free text accepted and flagged.

**Files/modules.** `src/services/search.service.ts`, `checkDuplicates` in `account.service.ts`,
`src/app/(app)/search/page.tsx`, `DuplicateWarning`.

**Database changes.** A `SECURITY INVOKER` search RPC using `similarity()` and
`phone_normalized`, so RLS scopes the results.

**Tests.** Unit: duplicate confidence scoring — exact phone, exact email, `similarity ≥ 0.6` with
matching city, `similarity ≥ 0.8` without, and none (§8.9's five rows). Integration: search
returns nothing a salesperson may not see; a 4+ digit numeric query is treated as a phone
fragment; minimum 3 characters enforced. Security: SQL injection through the search input (§19.4).

**Acceptance criteria.** §23.1 bullets 3–5. **Never merge automatically. Never block creation
outright.** Exact match → strong warning with [Open] and [Add opportunity here]; the user may
still proceed by confirming. Result order matches §11.10 exactly.

**Risks.** Trigram search performance against §12.8's 400 ms budget with RLS applied (M-19).
`phone_normalized` is deliberately **not unique** (§5.3, §25.2) — do not "fix" it.

---

# Phase 14 — Dashboards and reports

**Spec phase:** 6 Management · **Spec sections:** §13 (all), §12.2, §23.6

**Objective.** Every §13.1 metric as a named, unit-testable function; the salesperson `/today`
tiles (Phase 12), the manager `/dashboard` panels, the owner dashboard, `/team` and `/reports`.

**Dependencies.** Phases 11, 12. **B-10, M-02, M-10, M-15, M-18, M-19 resolved.**

**Approved decisions applied here.**
- **ADR-010 / TODO-BD-03** — the **Dormant** opportunity tile reads `opportunity_dormancy_days`;
  the nightly account-status job reads `account_dormancy_days`. They are never the same lookup.
- **TODO-BD-02** — "High-value at risk" compares against `high_value_threshold_paise = 30000000`,
  read through `settings.service.ts`. **₹3,00,000 never appears as a literal.**
- **TODO-BD-01** — the dashboard continues to report the percentage of high-value opportunities
  with no project (§8.5), now as steady-state reporting rather than a pending-decision metric.
- **M-18** — a dedicated 20,000-opportunity performance fixture, separate from `dev-fixtures.sql`.
- **C-2 / M-02** — **CSV export is available directly from the manager-accessible list and report
  screens** (`/opportunities`, `/accounts`, `/projects`, `/team`, `/reports`), exporting the
  current filtered view. It is **not** reachable only through `/settings`. OWNER keeps the §21.4
  `/settings` bulk export as well. **ADMIN export stays denied** — the control is not rendered for
  ADMIN *and* the Server Action rejects ADMIN, because a hidden button is not a control.

**Files/modules.** `src/services/dashboard.service.ts` (one exported function per §13.1 metric),
`src/features/dashboard/*`, `src/app/(app)/{dashboard,team,team/[userId],reports}/page.tsx`,
Recharts wrappers.

**Database changes.** Reporting RPCs/views as needed for grouped aggregates, all
`security_invoker`. No stored derived values (§5.7).

**Tests.** Unit: **every** §13.1 metric against fixture arrays — Pipeline Value excludes nurture,
won, lost and archived; Weighted Pipeline uses `system_settings.stage_probabilities`, never a
literal; **Win Rate returns null (displayed `—`) when the denominator is 0**; **a reopened
opportunity contributes no stale Won Value** (ADR-007). Integration: salesperson sees only their
own data in every tile; every manager exception tile links to a list filtered identically to the
tile's own query. Performance: tiles under 400 ms at 20,000 opportunities (§23.6, M-18).

**Acceptance criteria.** §23.6, all seven bullets. Pipeline Value equals a manual sum.
**The word "revenue" appears nowhere** (§2.4). The owner dashboard contains **no more** than the
§13.4 blocks — "Deliberately small. Do not add tiles." Salespeople never see team totals, win
rate or leaderboards (§13.2).

**Risks.** M-19 — this is where RLS subquery cost meets the 400 ms gate. Export must be scoped by
RLS so a manager's export and a manager's screen always agree; an export that bypasses the filter
is a data-leak path.

---

# Phase 15 — Import workflow

**Spec phase:** 7 Data · **Spec sections:** §20 (all), §5.11, §11.11, §23.7

**Objective.** The import wizard for accounts and contacts, with per-row duplicate decisions,
notification suppression, and 7-day rollback.

**Dependencies.** Phases 8, 9, 13. **H-08, H-09, M-22 resolved.**

**Approved decisions applied here.**
- **ADR-012 / H-08** — **import atomicity is preserved**; live per-100-row progress is dropped.
  Progress is reported when the atomic transaction completes.
- **H-09** — the nightly maintenance job **must not** make imported records look user-edited.
  Preferred mechanism: exclude records still inside the 7-day rollback window from the maintenance
  update.
- **TODO-BD-10** — accounts and contacts only. **No project or opportunity historical migration in
  V1.** `import_batches.entity` already accepts them for later, with no schema change.
- **ADR-003 / B-03** — the import executor's writes record the system user as actor.
- **H-03** — any extension of the import schema is a **new numbered migration**, never an edit to
  004.
- **M-22** — `duplicate_of` stays polymorphic with no FK; the entity type comes from
  `import_batches.entity`.

**Files/modules.** `src/services/import.service.ts`, `src/features/import/*`,
`src/app/(app)/import/*`, CSV templates, `src/app/api/import/*` (service-role executor).

**Database changes.** `execute_import` as a database function (§20.5).

**Tests.** Unit: every §20.3 validation rule, including case/space/underscore-tolerant enum
parsing and the in-file duplicate ERROR. Integration: rows in `DUPLICATE_*` with no decision
**block execution**; `LINK_EXISTING` writes `legacy_ref` on the existing record and **never
overwrites its fields**; every created row carries `is_imported`, `import_batch_id`, `legacy_ref`;
rollback archives (never deletes) and refuses when a record was edited; **import a batch, run
nightly maintenance, and prove rollback is still permitted** (H-09). E2E: §19.3 scenario 14.

**Acceptance criteria.** §23.7 bullets 1–5. **Import fires no notifications** — §25 names this as
the failure that permanently destroys trust in alerts; with ADR-002's `sla_notified_at` column,
suppression is now expressible. OWNER and ADMIN only; 5 MB / 5,000 rows.

**Risks.** 5,000 rows in one atomic transaction remains a serverless-timeout risk; the executor
runs with the longest permitted duration. Notification suppression must survive the cron path,
not just the request path.

---

# Phase 16 — Archive and merge

**Spec phase:** 7 Data · **Spec sections:** §8.8, §8.9, §16.1, §12.2, §23.1, §23.7

**Objective.** Archive/restore across all archivable entities with a preview of what will be
archived, the `/archive` screen, and manual account merge.

**Dependencies.** Phases 8–12. **H-02, M-06 and M-24 resolved.**

**Approved decisions applied here.**
- **ADR-008 / H-02** — **account merge is not reversible in V1.** The flow must show a complete
  preview, require explicit confirmation, record source/target and affected relationships in the
  available audit metadata, and **clearly warn the user that the merge is irreversible**.
  **Do not claim "always reversible via the audit trail"** in the UI or the docs.
- **M-24 / ADR-001** — `ARCHIVED` and `RESTORED` events are written through the GUC mechanism so
  the trigger remains the single writer.
- **C-3 / M-06** — archiving an account is a **four-step controlled operation**: preview the
  complete set of affected child records → clearly display what will be archived → require
  explicit confirmation → archive the account and its explicitly defined children **as one
  operation**. **The preview is informational; children do not require separate opt-ins.**
  The children are the account's opportunities, projects and contacts. **Activities and
  opportunity events are history and are never archived** — that is what preserves §8.8's
  "retain all relationships and activities". Restore reverses the same set. **No hard delete.**

**Files/modules.** Archive/restore in each `*.service.ts`, `mergeAccounts` in
`account.service.ts`, `src/app/(app)/archive/page.tsx`, merge preview UI with the irreversibility
warning.

**Database changes.** None. **No twelfth table** (§4.1, ADR-008).

**Tests.** Integration: archived records disappear from active lists, dashboards and pipeline
value; remain readable and searchable for MANAGER/OWNER/ADMIN; restore returns them with all
relationships and activities intact; **no role can DELETE** (except `project_stakeholders`, and
that is not archiving). Merge preserves every activity and records source/target in
`opportunity_events.metadata` for each moved opportunity. **The UI shows an irreversibility
warning before confirmation** (ADR-008).

**Acceptance criteria.** §23.1 bullet 6. §23.7 bullet 6 is interpreted per ADR-008: the merge is
recorded per-opportunity, not per-account, and reversibility is not claimed.

**Risks.** Merge is the most destructive operation in the system and is now provably one-way,
which raises the bar on its preview. The archive preview must be *complete* — a child the preview
omits but the operation archives is a trust failure.

---

# Phase 17 — Storage and quotation files

**Spec phase:** 7 Data / 8 Security · **Spec sections:** §15.6, §17.5, §8.6, §11.5, §19.4

**Objective.** The private `crm-files` bucket, path-prefix-based access policies, signed URLs, and
uploads attached to activities and opportunities.

**Dependencies.** Phases 11, 12. **B-09, H-12, M-14 resolved.**

**Approved decisions applied here.**
- **ADR-005 / B-09** — **browser → server-issued signed upload URL → private Storage.** The signed
  URL is short-lived; authorization is based on visibility of the parent entity, checked
  server-side before the URL is issued. **All database writes remain server-side.**
- **M-14** — MIME verification is a **hand-rolled magic-byte check** for JPEG, PNG, WebP and PDF.
- **H-12** — Storage policies use the `can_see_*` helpers, keyed off the path prefix.

**Files/modules.** `supabase/migrations/016_storage.sql`, `src/services/storage.service.ts`,
upload components in `features/activities` and `features/opportunities`.

**Database changes.** Bucket `crm-files` (private) and its policies.

**Tests.** Integration: a user without visibility of the parent entity cannot read the object
(§19.4); a read signed URL expires after 60 seconds; **the upload signed URL is short-lived and
issued only after a server-side visibility check**; a disguised executable is rejected by
magic-byte check, not by extension; >10 MB rejected. E2E: site-visit photo upload; **upload
failure does not block the activity** (§11.5).

**Acceptance criteria.** §23.8 bullet 6. No public URLs anywhere. Path convention exactly
`crm-files/{account|project|opportunity|activity}/{id}/{uuid}-{filename}`.

**Risks.** ADR-005 is the single approved exception to "no client-side Supabase writes" and must
not widen. Server-side validation must happen **before** the upload URL is issued, not after the
bytes arrive.

---

# Phase 18 — Cron jobs and email

**Spec phase:** 9 Launch · **Spec sections:** §14 (all), §16.4, §17.4, §21

**Objective.** Five cron routes with bearer-token auth and a service-role client, and the
`NotificationService` Resend implementation — nothing else automated (§14.8).

**Dependencies.** Phases 12, 14. **B-03, B-05, B-10, H-09, M-26, M-27, M-28 resolved, and the
§14.6 consecutive-failure state closed by ADR-014.**

**Approved decisions applied here.**
- **ADR-002 / B-05** — the SLA reminder deduplicates on `opportunities.sla_notified_at` and is
  sent **at most once per opportunity**.
- **ADR-011 / M-26 / TODO-BD-05** — the owner summary runs on an **hourly trigger with an in-route
  gate** reading `owner_summary_schedule` (daily, 19:00 Asia/Kolkata). Changing the setting never
  requires a deploy.
- **ADR-010 / TODO-BD-03** — nightly maintenance reads `account_dormancy_days`, not the
  opportunity threshold.
- **ADR-003 / B-03** — cron writes record the system user as actor.
- **H-09** — maintenance excludes records still inside the 7-day import rollback window.
- **B-10** — the hour gate and all dormancy boundaries evaluate in Asia/Kolkata.
- **M-27** — schedules are UTC in `vercel.json`; a plan supporting hourly cron is required.
- **M-28** — Resend needs a verified sender address before any email sends.
- **ADR-014** — the maintenance job's failure state lives in `system_settings`:
  `maintenance_consecutive_failures` and `maintenance_last_failure_at`. The route updates **both
  after every execution**; **at 2 consecutive failures the OWNER is notified**; **a successful run
  resets the count to 0**. **No notifications table.** The alert fires once at the threshold, not
  on every subsequent failure.

**Files/modules.** `src/app/api/cron/{new-opportunity-sla,daily-digest,manager-digest,
owner-summary,maintenance}/route.ts`, `src/services/integrations/{types.ts,notification.ts,
whatsapp.ts}`, `vercel.json`.

**Database changes.** None — `sla_notified_at` and the two maintenance counters were added in
Phase 3.

**Tests.** Integration: each route rejects a missing or wrong `CRON_SECRET`; the daily digest
skips users with all three lists empty and **never sends a group email**; per-user failure is
logged and the loop continues (§14.3); **the SLA reminder does not re-send on a second run**
(ADR-002); **the owner-summary gate fires only in the 19:00 IST hour and skips the other 23**
(ADR-011); nightly maintenance logs every `last_activity_at` correction it makes — **do not
suppress that log** (§14.6); **maintenance leaves rollback-window imports untouched** (H-09).
**maintenance failure state (ADR-014): a failed run increments the counter and stamps the
timestamp; a second consecutive failure emails the OWNER exactly once; a successful run resets the
counter to 0; a third consecutive failure does not re-alert.** Unit: IST→UTC cron expression
conversion (M-27).

**Acceptance criteria.** All seven §14 automations behave exactly as specified, including failure
behaviour. Every route returns `{ processed, sent, failed, durationMs }`. Routes excluded from the
sitemap. `AccountingIntegration` and `InventoryIntegration` remain **type declarations with no
implementation and no stub** (§16.4, TODO-BD-09).

**Risks.** The maintenance counters are operational state in a configuration table (ADR-014) and
must not be exposed as tunable settings at `/settings`. A maintenance run that throws before
reaching its counter update leaves the state stale — the update belongs in a `finally`.

---

# Phase 19 — Complete testing

**Spec phase:** 8 Security & QA · **Spec sections:** §19 (all), §23.8

**Objective.** The full suite green: unit, integration/RLS, the fifteen E2E scenarios, and the
security suite — as an adversarial audit of everything built, not a first pass.

**Dependencies.** Phases 1–18. **M-12, M-18, M-20, M-25 resolved.**

**Approved decisions applied here.**
- **M-20** — the Supabase/Docker CI strategy is defined: runner, database-reset strategy, per-role
  test credentials, parallelism policy. The RLS suite runs **on every commit**, not locally only.
- **M-18** — the 20,000-opportunity performance fixture exists and is used by the §23.6 gate.
- **M-25** — deactivation session behaviour is documented and asserted.
- **M-16** — the salesperson visibility assertions reflect work-context reads.
- **ADR-004** — the no-DELETE suite asserts table by table, with `project_stakeholders` as the
  documented single exception.
- **C-5 / M-12** — rate-limit and error behaviour is covered by **automated tests**: repeated
  failed logins throttle, the provider error maps to `AppError`, and the UI shows a
  plain-language message that leaks no implementation detail.
- **C-2 / M-02** — a negative test proves **ADMIN cannot export** through the Server Action, not
  merely that the button is hidden.

**Files/modules.** `/tests/unit`, `/tests/integration`, `/tests/e2e`, CI workflow, seeded role
fixtures, the performance fixture.

**Database changes.** Test seed and reset tooling only.

**Tests.** Everything in §19.1–§19.4. The security suite specifically:
direct PostgREST calls with salesperson credentials attempting cross-user reads · role escalation
via profile update · **service-role key absent from the built client bundle, verified by grepping
the build output** · Storage object access without entity visibility · unauthenticated access to
every route · session expiry · disguised-executable upload · SQL injection through search ·
**the user-provisioning action rejects a salesperson before touching the admin client** (ADR-009).

**Acceptance criteria.** §23.8, all seven bullets. **All fifteen E2E scenarios pass**, including
scenario 13 — a salesperson cannot reach another's opportunity "via direct URL **or via a direct
Supabase query from the browser console**". Every security test attacks the **API, not the UI**:
"a hidden button is never a control" (§19.4). No failing test is skipped or deleted (§22.1).

**Risks.** E2E flakiness against seeded state; reset per spec file. The performance gate may
surface M-19's RLS cost late if it was not measured in Phase 5 as planned.

---

# Phase 20 — Production hardening

**Spec phase:** 9 Launch · **Spec sections:** §15.7, §15.8, §12.6, §12.8, §17.4, §23.8, §23.9

**Objective.** Security headers, error handling that never leaks, performance against the §12.8
budgets, and the launch checklist closed.

**Dependencies.** Phase 19. **M-03, M-19 resolved. M-02 open.**

**Files/modules.** `next.config.ts` (CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`),
`src/app/error.tsx`, `src/app/not-found.tsx`, logging configuration, pagination audit.

**Database changes.** Index review against real query plans; migration `015` hardening pass (H-04).

**Tests.** Security headers present on every response. **No database error text ever reaches the
user** (§23.8). **Unauthorised record access returns 404** (M-03). No unbounded list query anywhere
— every list paginates 25 mobile / 50 desktop (§12.8). `/today` interactive under 1.5 s on 4G; any
list query under 400 ms server-side. Logs never contain tokens, keys, or full request bodies with
personal data (§15.8).

**Acceptance criteria.** §23.9 bullets 5–7: all `/docs` files reflect the built system;
`npm run build` passes with zero TypeScript and lint errors; the mobile create-customer flow
completes in under 60 seconds **on a real Android device**.

**Risks.** CSP versus Next.js inline scripts and Recharts — budget time for nonce configuration.
M-19 — RLS performance is the likeliest cause of missing the latency gates. **M-02 open**: the CSV
export surface for MANAGER is still undefined.

---

# Phase 21 — Deployment

**Spec phase:** 9 Launch · **Spec sections:** §21 (all), §23.9

**Objective.** Staging and production live on Vercel + Supabase **Mumbai**, the deploy sequence
exercised, backups verified by an actual tested restore, and the pilot started.

**Dependencies.** Phase 20. **TODO-BD-06 and TODO-BD-08 final; M-17, M-21, M-27, M-28 resolved,
including the backup destination.**

**Approved decisions applied here.**
- **TODO-BD-08** — **Supabase Mumbai `ap-south-1`**, for staging and production. Indian data
  residency is a requirement. **No other region.**
- **TODO-BD-06 — final** — `system_settings.cities` is seeded with the **ten Erode District
  revenue taluks**: Erode, Perundurai, Modakkurichi, Kodumudi, Gobichettipalayam, Sathyamangalam,
  Bhavani, Anthiyur, Thalavadi, Nambiyur. **Chennimalai is not among them** — it is a development
  block and firka within Perundurai taluk and belongs in `area`.
- **M-17** — the production migration command and the CI credentials it needs are pinned in
  `/docs/DEPLOYMENT.md`.
- **M-27** — a Vercel plan supporting hourly cron; all schedules converted IST→UTC.
- **M-21 — final** — the independent weekly `pg_dump` goes to **AWS S3, Mumbai `ap-south-1`**, in
  a **business-controlled AWS account**: dedicated backup bucket, **encryption enabled**,
  **versioning enabled**, **least-privilege IAM credentials**, weekly `pg_dump`, **automated
  retention with a 90-day minimum**, a **documented restore procedure**, and **at least one tested
  restore before production go-live**. Driven by a scheduled GitHub Actions workflow — Vercel Cron
  cannot run `pg_dump`. Full specification in `/docs/DEPLOYMENT.md` §7. **AWS resources are not
  provisioned in this pass.**

**Files/modules.** CI/CD workflow, `vercel.json`, `/docs/DEPLOYMENT.md` final, runbook.

**Database changes.** `017_seed` (OWNER user, system user, settings; **dev fixtures never run in
production**). Migrations applied to staging, verified, then production (§21.3).

**Tests.** Full suite in CI. Smoke tests after each deploy. **A restore from backup performed at
least once before go-live** (§21.4) — documented, with the date and the person who ran it.

**Acceptance criteria.** §23.9, all seven bullets. Development never connects to production
(§21.1). The production service-role key exists only in Vercel's production environment. The
deploy sequence is exactly §21.3: *test → migrate staging → verify → deploy staging → smoke →
migrate production → deploy production → smoke*.

**Risks.** **Provisioning outside `ap-south-1` is unrecoverable** — for the Supabase project and
for the S3 bucket alike. The backup lives outside the frozen stack by necessity (§21.4 requires
recovery **without vendor cooperation**), so its IAM credentials are a second secret surface and
must be least-privilege and rotated. **A backup nobody has restored from is not a backup** — the
tested restore is a launch gate, not a formality. First production migration is the highest-risk
single action in the project.

---

## Cross-phase standing risks

| Risk | Phases | Mitigation |
|---|---|---|
| RLS recursion on `users` (§25) | 5 | `SECURITY DEFINER` helpers only; never select `public.users` in a `public.users` policy |
| View bypassing RLS (§25) | 3, 14 | `security_invoker = true` asserted by an integration test |
| RLS performance at scale (M-19) | 5, 14, 20 | `(select fn())` InitPlan wrapping; **measure in Phase 5, not Phase 20** |
| Timezone correctness (B-10) | 3, 6, 12, 14, 18 | IST business-day helper in SQL **and** TS, behaviourally identical; boundary tests |
| `TODO-BD` values leaking into code (§24) | all | Resolution fixed the values, **not** the mechanism — `settings.service.ts` stays the only reader; grep for literals in review, especially `30000000` |
| The ADR-004 delete exception widening | 5, 10, 19 | Exactly one `for delete` policy in the schema; the no-DELETE suite asserts table by table |
| The ADR-005 upload carve-out widening | 12, 17 | Storage object uploads only; every other client-side Supabase write stays forbidden |
| Stale `final_order_value` after reopen (ADR-007) | 11, 14 | Cleared by the service; asserted by a Won Value integrity test |
| Scope creep beyond V1 (§2.3) | all | §4.2 rejected tables and §17.1 rejected infrastructure are closed lists |
| Import destroying alert trust (§25) | 15, 18 | `sla_notified_at` suppression tested on the cron path, not just the request path |
| Migration edited after apply (§21.2) | 3, 15, 21 | Migrations append-only once applied; an extension is a new numbered file (H-03) |
| Provisioning outside `ap-south-1` | 2, 21 | Region verified in the dashboard and recorded before any data is written — Supabase **and** the S3 backup bucket |
| Geographic units invented (TODO-BD-06) | 3, 8, 10, 13 | `cities` holds the ten revenue taluks only; blocks/firkas such as Chennimalai live in `area` as free text |
| Maintenance counters treated as tunable settings (ADR-014) | 3, 18 | Operational state, written only by the cron route, never editable at `/settings` |
| Audit events blurred into activities (C-1) | 11 | Visually and semantically distinct in the timeline; §10.1 keeps them separate |
| Export bypassing RLS scope (C-2) | 14, 20 | Export runs the same scoped query as the screen; ADMIN rejected server-side |
