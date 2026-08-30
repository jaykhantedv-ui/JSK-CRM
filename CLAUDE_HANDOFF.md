# JSK CRM — Handoff

**Written 2026-08-23, against commit `2a0d35bb60761852e8dc9fd2e33d6681bc97c30c`,
which is also what production runs.**

You are taking over a CRM that is **live and in daily use by real employees**, and
you are intended to be **the sole development and maintenance AI for this
repository** — nobody else is working on it in parallel, and nobody else is
checking the security model. Read this file and `PROJECT_STATE.md` before running
anything. Then read `CLAUDE.md` — it is the engineering contract for this
repository and it is not advisory.

Two things to internalise before you touch anything:

1. **Row-level security is the authorization boundary.** Not the navigation, not
   the route guard, not the button. Every rule must hold against a direct
   PostgREST call carrying the user's own JWT. If you find yourself fixing a
   permission in a component, you are fixing the wrong layer.
2. **This system is deployed on one machine that the business depends on.** There
   is no staging. A bad migration is a bad day for fourteen people. The commands
   at the end of this file are the ones that can hurt.

---

## 1. What this is

A standalone web CRM replacing handwritten sales books at a building-materials
retail business in Erode, Tamil Nadu — tiles, marble, granite, sanitaryware, CP
fittings. Mobile-first for salespeople in the showroom, desktop-oriented for
management.

The problem it exists to solve: salespeople forget follow-ups, and nobody can see
the pipeline. Every design decision follows from that — `/today` is a work queue
rather than analytics, and the dashboard is exception → explanation → action.

| | |
|---|---|
| **Production URL** | https://www.jskcrm.online |
| **GitHub** | `jaykhantedv-ui/JSK-CRM` |
| **Branch** | `claude/jsk-crm-final-completion-mr2e17` |
| **Server path** | `/opt/jsk-crm` |
| **Production commit** | **`2a0d35b`** — deployed, migration `032` applied |
| **Repo HEAD** | ahead of production by documentation-only commits |

### The source of truth

`CLAUDE_CODE_BUILD_SPEC.md` is the implementation specification. **If behaviour is
not described there, it is not in Version 1.** It is never edited; issues with it
go in `/docs/SPEC_AUDIT.md`. `CLAUDE.md` holds the engineering rules.

---

## 2. Architecture

Next.js 15 App Router + TypeScript strict, talking to a **self-hosted Supabase**
stack on one Ubuntu VPS, all of it in Docker Compose. No Vercel, no hosted
Supabase, no cloud account required (ADR-033).

```
                    Cloudflare edge (HTTPS terminates here)
                              │  outbound tunnel, nothing inbound
                    ┌─────────▼─────────┐
                    │ cloudflared       │  profile: tunnel
                    └─────────┬─────────┘
                    ┌─────────▼─────────┐
                    │ gateway (nginx)   │  ONE origin, port 8000
                    └──┬────┬────┬──────┘
        /auth/v1 ──────┘    │    └────── /storage/v1
                            │
         everything else ───┼───────────► app (Next.js standalone)
                     /rest/v1 ──────────► rest (PostgREST)
                            │
                    ┌───────▼───────────┐
                    │ db (PostgreSQL 15)│  supabase/postgres image
                    └───────────────────┘
```

**One origin serves both the CRM and Supabase.** nginx routes `/auth/v1`,
`/rest/v1` and `/storage/v1` to the Supabase containers and everything else to
the application, so `PUBLIC_URL` and `PUBLIC_SUPABASE_URL` are normally the same
value. Server-side code reaches Supabase at `SUPABASE_INTERNAL_URL`
(`http://gateway:8000`) because the public address is not resolvable from inside
Docker — that split is ADR-034, and it is why one session cookie name is pinned
in `src/lib/supabase/env.ts`.

### Docker services

| Service | Image | Notes |
|---|---|---|
| `db` | `supabase/postgres:15.8.1.060` | Volume `db-data`. Published on `127.0.0.1:54322` only |
| `auth` | `supabase/gotrue:v2.177.0` | `GOTRUE_DISABLE_SIGNUP: 'true'` — no self-registration, ever |
| `rest` | `postgrest/postgrest:v12.2.12` | See ADR-041: this version will not embed `users` into itself |
| `storage` | `supabase/storage-api:v1.19.3` | Volume `storage-data` |
| `gateway` | `nginx:1.27-alpine` | Published on `${PUBLISH_HOST:-127.0.0.1}:${SUPABASE_PORT}` |
| `app` | `jsk-crm-app:latest` (built here) | `output: standalone`, runs as uid 1001 |
| `tunnel` | `cloudflare/cloudflared:2025.8.1` | **Compose profile `tunnel`** — optional |

### Stack, frozen

Next.js 15 · TypeScript strict · Supabase (Postgres, Auth, Storage) ·
`@supabase/ssr` · Tailwind + shadcn/ui (owned in-repo) + lucide-react · Zod ·
react-hook-form · TanStack Query (lists only) · Recharts · date-fns · Resend ·
Vitest + Playwright.

**Adding any dependency outside that list needs a `/docs/DECISIONS.md` entry
written before it is installed** (CLAUDE.md §16). Two gaps were closed without
adding one: UTC→IST rendering uses `Intl.DateTimeFormat`, and magic-byte MIME
checking is a hand-rolled signature check.

### Repository map

```
CLAUDE_CODE_BUILD_SPEC.md   source of truth — never edited
CLAUDE.md                   engineering rules — read before writing code
/docs                       ARCHITECTURE · DATABASE · PERMISSIONS · DECISIONS
                            DEPLOYMENT · RUNBOOK · TESTING · SPEC_AUDIT · …
/supabase/migrations        001…032, append-only once applied
/supabase/seed              seed.sql (all envs, deliberately empty of users)
                            dev-fixtures.sql (development ONLY)
/deploy                     the office server: start, migrate, backup, restore,
                            health, bootstrap-owner, db-credentials, systemd
/src/app                    routes, Server Actions, /api/cron/*
/src/features               feature modules — never import across features
/src/services               ALL business logic
/src/lib                    supabase/{client,server,admin} · permissions ·
                            organization · money · phone · dates · errors
/tests                      unit · integration · e2e
```

---

## 3. Database

**Thirteen tables** (§4.1 plus ADR-016's `outlets` and `user_outlets`, plus
ADR-021's `sales_targets` = fourteen in `public` today; `docs/DATABASE.md` has the
authoritative list). Adding another requires approval recorded in
`/docs/DECISIONS.md` **before** the migration is written.

```
users · outlets · user_outlets · accounts · contacts · projects ·
project_stakeholders · opportunities · activities · opportunity_events ·
system_settings · sales_targets · import_batches · import_rows
```

Non-negotiables:

- **Money is `bigint` paise.** Never float, never rupees in the database. Rupee
  conversion happens only at the UI and CSV boundaries, in `lib/money.ts`.
- **Timestamps are `timestamptz` UTC, displayed Asia/Kolkata.** The business day
  is IST: bare `current_date` in SQL is wrong for 5.5 hours a day. Every
  overdue/due-today/period expression uses `(now() at time zone 'Asia/Kolkata')::date`.
- **Nothing is hard-deleted.** Archivable tables carry `archived_at`/`archived_by`;
  every read filters `archived_at is null`. There is **exactly one `DELETE`
  policy in the whole schema**, on `project_stakeholders` (ADR-004). Grep for
  `for delete` and find one. A second means the flow is wrong.
- **`activities` is append-only** with a 24-hour edit window for the author,
  enforced by the RLS UPDATE policy. Deletable by nobody, ever.
- **`opportunity_events` is written only by a database trigger** — no path can
  bypass the audit. No UPDATE and no DELETE policy for any role, including OWNER.
- Derived values (`is_overdue`, `days_in_stage`, `weighted_value`, `is_dormant`)
  are **computed in queries, never stored**.
- `v_opportunity_flags` and every other view is `security_invoker = true`. A view
  without it silently bypasses RLS and leaks every salesperson's pipeline.

### The twelve business decisions

§24 marks twelve `TODO-BD` values. All were resolved 2026-08-19 and recorded in
`/docs/DECISIONS.md` §A. **Resolution fixed the values; it did not licence a
constant.** `30000000` — the high-value threshold — appears in exactly one place,
a `system_settings` row, read through `services/settings.service.ts`. Reading any
of these from a literal in application code is a bug.

---

## 4. Authentication

- **No self-registration in any environment.** `GOTRUE_DISABLE_SIGNUP` is true.
- Users are created by an OWNER or ADMIN at **Settings → Organization → People**,
  which provisions a real Auth account through the admin API (ADR-009).
- The very first OWNER is a chicken-and-egg problem — creating a user requires
  being one. `deploy/bootstrap-owner.sh` breaks that **once** (ADR-039). It
  refuses if an active OWNER already exists.
- `handle_new_auth_user()` mirrors a new `auth.users` row into `public.users` as
  an active SALESPERSON. **The trigger deliberately ignores any role in the
  sign-up metadata**, so user creation can never become a role-escalation path;
  the role is applied afterwards, server-side.
- Deactivation (`is_active = false`) closes the **database** boundary, not just
  the login screen: `current_user_id()` filters on `is_active`, so every policy
  resolves to nothing for that person immediately.

---

## 5. Security model

### Three controls, and only one of them is authorization

| | Decides | Where | If you deleted it |
|---|---|---|---|
| Row-level security | what a query returns | `supabase/migrations/016, 028, 029, 031, 032` | everything breaks |
| Route authorization | whether a screen renders | `requireRole` in `auth.service.ts`, layout guards | costs a clear refusal, leaks nothing |
| Navigation | what is worth offering | `components/layout/nav-items.ts` | costs tidiness, leaks nothing |

**UI hiding is not security.** A hidden button is not a control and a filtered
list is not a control. Every permission must hold against `curl` with a
salesperson's JWT.

### Rules you must not break

- **Normal application pages never use service-role credentials to bypass RLS.**
  `lib/supabase/admin.ts` throws if `typeof window !== 'undefined'` and has
  exactly **three** permitted callers in `src/`, enforced by an ESLint boundary
  rule: the cron path (`automation.service.ts` and `src/app/api/cron/**`), the
  import executor, and the user-provisioning path in `user.service.ts` — that one
  only **after** a server-side OWNER/ADMIN check. Reversing that order is a
  privilege-escalation hole. `npm run check:bundle` greps the built client bundle
  for the key. Outside `src/`, `deploy/bootstrap-owner.sh` holds the service-role
  key too — it is an operator command on the server with no route into the
  application (ADR-039).
- **Reads** go through Server Components with the user's session. **Writes** go
  through Server Actions → services. No `supabase.from(...).insert()` in a Client
  Component. The one carve-out is a Storage upload against a server-issued signed
  URL (ADR-005), because a 10 MB file exceeds the request-body limit.
- **All business logic lives in `src/services/*`.** Server Actions and route
  handlers do exactly four things: authenticate → validate with Zod → call a
  service → map errors. No business rule is duplicated in a component.
- **A feature folder never imports from another feature folder** (§18).
- Every RLS change ships with an integration test proving the negative case,
  written **as the restricted role**. Verifying a permission as OWNER proves
  nothing — OWNER passes everything.

---

## 6. Authorization model

Four roles. The database enum is `user_role` with values `SALESPERSON`,
`MANAGER`, `OWNER`, `ADMIN`.

> **Terminology: the UI says "Sales Head", never "Manager".** The database role
> stays `MANAGER` — renaming the enum would rewrite every policy, helper and
> migration for a word. `ROLE_LABELS` in `src/lib/permissions.ts` is the single
> place the label lives, and no screen prints the raw enum. This is the same
> discipline §2.4 applies to the word "Revenue", which must never appear in the
> UI (use Pipeline Value, Won Value, Weighted Pipeline).

| | SALESPERSON | SALES HEAD (`MANAGER`) | ADMIN | OWNER |
|---|---|---|---|---|
| Own records | ✔ | ✔ | ✔ | ✔ |
| Direct reports' records | — | ✔ | ✔ | ✔ |
| Every operational record | — | — | ✔ | ✔ |
| Dashboard · Team · Reports · Export | — | ✔ | ✔ | ✔ |
| Import | — | — | ✔ | ✔ |
| People · branches · reporting structure | — | — | ✔ | ✔ |
| Archive · reassign · write business records | own | ✔ | **—** | ✔ |
| The §24 business rules (`system_settings`) | — | — | **—** | ✔ |
| Create, alter or deactivate an OWNER | — | — | **—** | ✔ |
| Roll back an import · set the company target | — | — | — | ✔ |

The line, in one sentence:

> **ADMIN can run the business. OWNER can run the business and control the
> system.** (ADR-042)

### Navigation, per role

| Role | Sees |
|---|---|
| SALESPERSON | Today · Customers · Contacts · Pipeline · Projects · My Day · My Targets |
| SALES HEAD | Today · Customers · Contacts · Pipeline · Projects · Team · Reports |
| ADMIN · OWNER | everything |

---

## 7. Organization model

**Two columns carry the whole organisation. There is no second model.**

| | |
|---|---|
| `users.manager_id` | **Defines the reporting hierarchy.** A self-reference on `users`. |
| `user_outlets` | **Defines outlet assignment.** Rows, with `revoked_at` — never deleted. |

- **A salesperson's Sales Head is derived automatically from `manager_id`.** They
  are never asked to pick one when creating a customer, opportunity or activity.
  Revathi creates an opportunity → owner = Revathi, sales head = Pankaj (from
  `manager_id`), outlet = Revathi's assignment.
- **A record follows its OWNER's sales head, not its branch.** A deal Revathi
  files at another branch is still Pankaj's to see; a deal filed at Pankaj's
  branch by another team's salesperson is not.
- Outlet scope did not go away — it decides which branches a person may **file
  against**, **compare in reporting**, and **move a record between**. It is no
  longer a read grant.

### The legal reporting ladder

```
SALESPERSON → MANAGER (Sales Head) → ADMIN → OWNER → nobody
```

Enforced by `guard_user_hierarchy()` in migration 031, which refuses: an illegal
pairing on the row being written; an illegal pairing on the rows reporting **to**
it (demoting a sales head who still has a team); a self-manager; a cycle; and
anybody but OWNER/ADMIN changing who they report to. `guard_owner_role()` in 032
additionally refuses anybody but an OWNER creating, altering or deactivating an
OWNER.

Migration 032 renamed the triggers `users_guard_1_owner_privilege` and
`users_guard_2_hierarchy_shape` — **PostgreSQL fires BEFORE triggers in name
order**, and the privilege refusal has to be the one that answers.

### The current organisation

```
Jay Khanted (OWNER)
  Vinay Kumar Jain (ADMIN)
    Pankaj      — Sales Head 1
      Revathi
    Jainendra   — Sales Head 2
      Thamarai
      Ashokji
      Deivanai
      Kathirvel
    Dhanendran  — Sales Head 3
      Anandh
      Ankur Tiwari
      Sathya
      Selvi
```

**Sales heads report to the ADMIN, never directly to the OWNER.** All three work
out of one branch — which is exactly why outlet scope could not be the read rule
and `manager_id` had to be (ADR-040).

### Outlets — the pilot

| Branch | State |
|---|---|
| **Moolakarai Branch** | **ACTIVE.** Everyone in the pilot is assigned here. |
| **Chithode Branch** | **Not configured.** No outlet row exists — it has not been created, not merely closed. Nobody is assigned to it and it appears in no selector. |

Production has **one outlet**, Moolakarai, confirmed by the verified backup taken
during the `2a0d35b` deployment. Production has **15 rows in `public.users`** —
consistent with the fourteen people above plus the ADR-003 system actor, though
the composition is an inference from the count rather than something the
deployment report stated. Confirm on Settings → Organization → People.

When Chithode is eventually opened it is created at Settings → Organization →
Branches. A **closed** branch appears only on that screen, where it is
administered: `listAuthorizedOutlets()` — the single branch-selector helper —
offers active branches only.

---

## 8. User management

Settings → Organization has three screens: **Branches**, **People**, **Reporting
Structure**.

- **People** lists name, email, role, reports-to, branch, status, with **Edit** and
  **Remove** per row.
- **Edit** (`/settings/organization/people/[id]/edit`) changes name, role, Sales
  Head, branches and status. Saving is an `UPDATE` keyed on the id — it cannot
  produce a duplicate. Email is deliberately not editable: it is the Auth
  account's identity.
- **"Remove" deactivates. It is not a delete, and there is no delete.** `users`
  has no `DELETE` policy for any role, including the owner — `accounts.owner_id`
  and `opportunity_events.actor_id` both reference it, so deleting a person takes
  their work with them or orphans it. **Restore** puts them back.
- Nobody can remove themselves; the owner's row cannot be touched by an ADMIN.
- **Reporting Structure is the authorization model, drawn.** A person in the
  wrong place there is a person seeing the wrong pipeline. It is the fastest way
  to diagnose a visibility complaint.
- New people are created with a **temporary password** the administrator reads
  out. Nothing is seeded, no credential is invented.

---

## 9. Backup and restore

- `deploy/backup.sh` — nightly. `pg_dump` **inside the db container** as
  `supabase_admin` (the platform superuser; `postgres` is an ordinary role in
  this image and cannot read RLS-protected tables), custom format,
  `aes-256-cbc/pbkdf2/600k`, sha256 sidecar, decrypt-check before publishing.
- The archive is **validated inside the db container** — the office server has no
  PostgreSQL client tools and should never need them (ADR-038). The dump is moved
  with `docker compose cp`, never through an exec pipe, which once truncated a
  220 KB archive to 95 KB.
- `deploy/backup.sh --verify` additionally restores into a **scratch database**
  and checks it: 14 tables, 42 policies, foreign keys, indexes, row counts,
  `pg_trgm`/`pgcrypto`, the trigram indexes, `search_crm()`, and **zero
  pg_restore diagnostics**. The scratch database is dropped afterwards.
- `deploy/restore.sh --scratch | --live`. `--live` demands the words
  `RESTORE-LIVE` typed out. Both run `scripts/restore-prepare.sql`, which creates
  what the archive cannot carry: the platform roles, the `auth`/`storage`/
  `extensions` schemas and the two extensions. **Skipping it restores a database
  that reports success and has lost all 42 policies** (ADR-037).
- Schedules: backup `21:00` daily, verify `Sun 22:00` (systemd timers, UTC).
- `BACKUP_PASSPHRASE` lives in `deploy/env/production.env` and in the business
  safe. **Without it the backups are unreadable.**

---

## 10. Cloudflare Tunnel

`cloudflared` dials **outward** to Cloudflare. Nothing is exposed inbound, no
router configuration is needed, and HTTPS terminates at Cloudflare's edge.

It is a **Compose profile** (`tunnel`), started only by `deploy/start.sh --tunnel`.
`CLOUDFLARE_TUNNEL_TOKEN` is deliberately **not** written as `${VAR:?}` in
`docker-compose.yml`: Compose interpolates every service before it applies profile
filters, so a required-variable marker there breaks `up`, `config`, `ps` and
`down` for a local stack that does not run the tunnel at all. The token is checked
in `deploy/start.sh --tunnel`, which is the only path that needs it, and passed as
`TUNNEL_TOKEN` so it stays out of the process arguments `docker inspect` shows.

---

## 11. Important migrations

| | |
|---|---|
| `003` | `users`, the ADR-003 system actor, `handle_new_auth_user()` |
| `004` | `outlets` + `user_outlets` (ADR-016 — replaced a `branch text` column) |
| `013` | `log_opportunity_event()` — the audit trigger, the single writer |
| `015` / `016` | The RLS helpers and **all policies**, read as one document |
| `017` | `v_opportunity_flags`, `security_invoker = true` |
| `021` | `sales_targets` (ADR-021) |
| `022` | Management analytics RPCs, `assert_management_access()`, `scoped_outlet_ids()` |
| `028` / `029` | Outlet scope evaluated **once per query** instead of once per row — 792 ms → 4.8 ms on 20,005 opportunities |
| **`031`** | **`users.manager_id`**, `guard_user_hierarchy()`, `scoped_owner_ids()`; every scoped policy moved from `outlet_id in scoped_outlet_ids()` to `owner_id in scoped_owner_ids()` |
| **`032`** | `system_settings` write → `is_owner()`; `guard_owner_role()`; trigger rename for firing order |

**Never edit a migration that has been applied to production. Write a new one.**
Never modify the production schema through a dashboard.

---

## 12. Architectural decisions worth knowing

Full text in `/docs/DECISIONS.md`. The ones that will bite you if you do not know
them:

| ADR | |
|---|---|
| **ADR-016** | Outlets are rows, not a text column |
| **ADR-017** | ADMIN got no business data — **superseded on the read rule by ADR-040** |
| **ADR-033** | The office server: self-hosted Supabase in Docker on one machine |
| **ADR-034** | Public and internal Supabase URLs, one pinned session cookie |
| **ADR-037** | The restore target must be *prepared*; the drill measures against the source |
| **ADR-038** | The archive is validated inside the db container; every dependency names itself |
| **ADR-039** | The first OWNER is bootstrapped by a one-time operator command |
| **ADR-040** | **The reporting line is the read boundary**; a MANAGER is a "Sales Head" |
| **ADR-041** | **The organisation is assembled in the application, not embedded by PostgREST** |
| **ADR-042** | **The administrator runs the business; the owner controls the system** |

---

## 13. Recent fixes — what was actually wrong

These are recent, real, and the reasons the current code looks the way it does.

**Production owner bootstrap (ADR-039, `4f8374f`).** No self-registration + an
empty seed + provisioning that requires being an OWNER = a deployment nobody
could sign into. `deploy/bootstrap-owner.sh` breaks it once, using the same three
steps the application uses (Auth admin API → mirroring trigger → role applied
afterwards). It refuses when an active OWNER exists.

**Organization hierarchy (ADR-040, `7bf50fd`).** Three sales heads out of one
branch meant `outlet_id in scoped_outlet_ids()` gave each of them the other two's
entire pipeline. Added `manager_id` and moved every scoped policy to
`owner_id in scoped_owner_ids()`. ADMIN gained read of every operational record.

**PostgREST self-reference (ADR-041, `c541cd0`).** Both organisation screens died
with `PGRST200 — Could not find a relationship between 'users' and 'users'`. The
foreign key exists and the schema cache was reloaded; **PostgREST 12.2.12 simply
does not expose a self-referencing relationship as embeddable.** Fixed by
removing the dependency: `loadOrganization()` issues three plain RLS-bounded
queries and `lib/organization.ts` joins them in memory. Hinted embeds between two
*different* tables are unaffected and are still used — `auth.service.ts` does one
on every request.

**People edit / remove / deactivation (`2745e4f`).** Edit and Remove per row.
Removing deactivates. Fixed along the way: `updateUser`'s self-edit guards
compared submitted values against nothing, so an owner correcting their own name
was refused — an edit form posts every field it renders.

**ADMIN access and the security fixes (ADR-042, `2a0d35b` — DEPLOYED).** ADR-040 widened
ADMIN in the database and the route guards and left four **service**-layer gates
on `isManagerOrAbove()`. The route said yes, the service threw, and Dashboard,
Team and Reports rendered a Server Components error. All four now defer to
`requireManagementAccess()`. Auditing that turned up two real defects, both
reproduced as SQL as ADMIN with no interface involved:

```sql
-- every §24 business rule was writable by an administrator
update public.system_settings set value = '99999999'
 where key = 'high_value_threshold_paise';                     -- SUCCEEDED

-- FULL PRIVILEGE ESCALATION, in two statements
update public.users set role='OWNER', manager_id=null where id=<any>;  -- SUCCEEDED
update public.users set is_active=false where role='OWNER';            -- SUCCEEDED
```

Both closed by migration `032`, **which is applied to production**. Nothing had
stopped the demotion except coincidence: the fixture owner had a direct report, so
the hierarchy guard fired first — clearing `manager_id` in the same statement went
straight through.

The deployment itself, as the operator reported it: a verified backup taken
immediately beforehand with its restore verification succeeding, `git pull` from
`2745e4f` to `2a0d35b`, migration `032` applied successfully, the application
image rebuilt, the app eventually healthy (see §14), and the production smoke
test passing 32 / 32 against https://www.jskcrm.online.

**Verified encrypted backups (ADR-037, ADR-038).** Several rounds: the dump was
taken by a role that RLS blocked; the archive was truncated by an exec pipe; the
validator called a `pg_restore` the host does not have and exited 127 with no
name attached. All fixed, all covered by an 83-check drill.

**Cloudflare production tunnel.** `${VAR:?}` on a profiled service broke `up` for
the local stack; the guard moved to `deploy/start.sh --tunnel`.

---

## 14. Known limitations and unresolved issues

**`deploy/start.sh` can print `UNHEALTHY` while the app is still starting — this
issue is CURRENT, and was seen on the `2a0d35b` deployment,** whose report records
the application becoming healthy *eventually* rather than at once. `start.sh` brings up `gateway` and `app` with `up -d` and
**no `--wait`** (unlike the `db`/`auth`/`storage` steps, which do use it), then
immediately runs `deploy/health.sh`. The app container's `HEALTHCHECK` has a 20 s
`start-period`, so `docker compose ps` shows `health: starting` while `health.sh`
has already failed its `curl` to `/api/health` and printed
`FAIL application is not answering on port 3000` → `UNHEALTHY`.

> **It is a race, not a fault.** Wait ten seconds and run `deploy/health.sh`
> again; it returns `HEALTHY`, which is what happened on the `2a0d35b`
> deployment. Do not roll back on this alone — confirm with a second run and with
> `docker compose ps` first. The one-line fix, when somebody wants it, is
> `--wait` on the `gateway app` line of `deploy/start.sh`.

Other current limitations:

- **`ADMIN` writes no business data.** It reads everything and administers people
  and branches, but archiving and reassigning stay with the sales heads
  (`isManagerOrAbove()` gates both). This was a deliberate call in ADR-042 — the
  brief asked for access to pages, not for write access — and it is one predicate
  to change if the business wants it. **Raise it; do not widen it quietly.**
- **`/my-day` vs `/today`** — the brief listed both with no stated difference.
  `/today` is *what is waiting on me* across every horizon; `/my-day` is *what I
  planned today and what I logged today*. Recorded as **SPEC_AUDIT B-14**, open
  for confirmation. If it was a duplicate name, delete `src/app/(app)/my-day` and
  the two nav entries — nothing depends on it.
- **The forbidden-reporting-shapes list contradicts itself** — "Salesperson →
  Sales Head relationship" is listed as forbidden while the same brief requires
  it. Read as a duplicate of "no salesperson under a salesperson". Recorded as
  **SPEC_AUDIT B-15**.
- **No staging environment.** One machine, live users.
- **E2E (Playwright) specs are written and skipped** unless
  `E2E_SUPABASE_READY=1` with real credentials, because the development
  environment cannot run GoTrue (ADR-018). Their database half runs on every
  commit in the integration suite, which is where the authorization rules are
  actually proved.
- **Out of scope in V1 (§2.3) — do not build, stub, or add columns for:**
  accounting/GST/invoicing/inventory · commission · a line-item quotation engine ·
  WhatsApp Business API or webhooks · marketing automation · AI/lead scoring ·
  slab-level inventory · sample tracking · multi-branch UI · offline mode ·
  customer portal · SMS/push.

---

## 15. Deployment procedure

**There is no CI/CD to production. Deployment is these commands, on the server,
run by a person who has read what changed.**

```bash
cd /opt/jsk-crm

# 1. ALWAYS, before anything that touches the schema.
deploy/backup.sh --verify          # backs up AND proves the backup restores

# 2. Bring the code across.
git pull

# 3. Look before you leap.
deploy/migrate.sh --status         # what is applied, what is pending

# 4. Apply only what is pending. Each migration runs in ONE transaction
#    together with its ledger row.
deploy/migrate.sh

# 5. Rebuild and restart the application.
deploy/start.sh --build            # add --tunnel if the tunnel is not running

# 6. Confirm.
deploy/health.sh                   # if UNHEALTHY, see §14 — wait and re-run
deploy/db-credentials.sh --test    # three roles, three services, over the network
scripts/smoke.sh https://www.jskcrm.online
```

Then sign in and check the screens the change touched.

**If the change has no migration** (most application fixes), steps 3 and 4 are a
no-op and `deploy/migrate.sh` reports "already up to date" — but run them anyway,
because that is how you find out you were wrong about there being no migration.

---

## 16. Rollback and recovery

**Application rollback** — no schema change involved:

```bash
cd /opt/jsk-crm
git log --oneline -5
git checkout <previous-good-commit>
deploy/start.sh --build
deploy/health.sh
```

**A migration went wrong.** Migrations are append-only and each runs in one
transaction, so a *failed* migration leaves nothing behind and is retried whole.
A migration that **succeeded and was wrong** is a new migration that corrects it —
never an edit to the applied one, never a manual `psql` change.

**Full data recovery** — the machine or the data is lost:

```bash
cd /opt/jsk-crm
ls -lt /var/backups/jsk-crm/            # or the external drive
export BACKUP_PASSPHRASE='<from the safe>'
deploy/restore.sh --scratch /var/backups/jsk-crm/<file>.dump.enc   # prove it first
deploy/restore.sh --live    /var/backups/jsk-crm/<file>.dump.enc   # asks for RESTORE-LIVE
```

**Nobody can sign in / the owner is locked out:**

```bash
deploy/bootstrap-owner.sh --status
deploy/bootstrap-owner.sh --email owner@example.com --name 'Full Name' --confirm-production
```

It refuses if an active OWNER exists. A **deactivated** owner does not count as
active — which is deliberate, and is the way back from the escalation that ADR-042
closed.

---

## 17. Commands that must never be run casually

| Command | Why |
|---|---|
| `docker compose down -v` | **Deletes the `db-data` volume. The entire database. Every customer, opportunity and activity.** There is no undo but a restore. |
| `docker volume rm …` | Same. |
| `npm run db:reset` / `db:reset:fixtures` | Drops and rebuilds. **Local development only.** Pointed at production it destroys everything and loads dev fixtures. |
| `supabase db reset` | Same. |
| `deploy/restore.sh --live` | Replaces the live database with a backup. Everything since that backup is gone. |
| `psql` against production to "just fix" a row | Bypasses services, RLS, triggers and the audit trail. Every write goes through the application or a migration. |
| Editing an applied migration | Development and production silently diverge. Write a new one. |
| `git push --force` on this branch | Other checkouts and the server's history break. |
| Changing `deploy/env/production.env` | Holds `POSTGRES_PASSWORD`, `JWT_SECRET`, `SERVICE_ROLE_KEY`, `BACKUP_PASSPHRASE`. Rotating `JWT_SECRET` signs everyone out; **losing `BACKUP_PASSPHRASE` makes every backup unreadable.** |
| `deploy/start.sh --build` mid-shift | Restarts the app. Brief downtime for people using it. |

### Reading the production commit — do this first, every session

Production runs `2a0d35b` with migrations `001`–`032` applied. **Do not assume
the repository HEAD is what is deployed** — documentation and unmerged work move
ahead of it. Confirm before you reason about production:

```bash
ssh <server> 'cd /opt/jsk-crm && git rev-parse --short HEAD && git log --oneline -1'
ssh <server> 'cd /opt/jsk-crm && deploy/migrate.sh --status'
```

Then update `PROJECT_STATE.md` if what you find differs from what it says. That
file is only worth anything if the next person can trust it.

---

## 18. Current next priorities

`2a0d35b` is deployed and migration `032` is applied, so nothing outstanding puts
the live system at risk. What remains is confirmation and two open questions.

1. **Confirm the organisation on screen.** Settings → Organization → Reporting
   Structure should match §7 exactly — it is the authorization model drawn, and a
   person in the wrong place is a person seeing the wrong pipeline. Then
   spot-check as Vinay (ADMIN): Dashboard, Team and Reports load, and `/settings`
   shows the Organization links but **not** the business-rules card.
2. **Confirm the backup timers are firing** — `systemctl list-timers 'jsk-crm*'`
   — and that a `.dump.enc` from last night exists. The backup taken during the
   `2a0d35b` deployment was verified, so the mechanism is known good; what is
   unconfirmed is that the nightly schedule is installed and running.
3. **Settle SPEC_AUDIT B-14 and B-15** with the business owner — `/my-day` versus
   `/today`, and the self-contradicting bullet in the reporting-shape rules.
4. **Decide whether ADMIN should archive and reassign** (§14). One predicate.
5. **Optional, low risk:** add `--wait` to the `gateway app` line of
   `deploy/start.sh` so a deployment stops reporting `UNHEALTHY` before the
   application has finished starting (§14).
6. **Chithode Branch** when the business is ready to work it: create it at
   Settings → Organization → Branches, assign people to it, and it starts
   appearing in their selectors. Nothing in the code needs changing for a second
   branch — that is what ADR-016 bought.

---

## 19. You are the only one working on this

**The Claude Code account reading this is intended to be the sole development and
maintenance AI for this repository.** No other assistant is expected to be
working on it in parallel, which changes what you can take for granted.

- **Nobody else is checking the security model.** Row-level security is the
  boundary. Every change to it ships with an integration test written **as the
  restricted role** — verifying a permission as OWNER proves nothing, because
  OWNER passes everything. The audit suite is
  `tests/integration/authorization-audit.test.ts`; extend it rather than trusting
  a screen.
- **Nobody else is keeping the documentation true.** `/docs/DECISIONS.md` records
  every architectural decision with its reasoning and the alternatives rejected.
  `/docs/SPEC_AUDIT.md` records every place the specification is silent,
  ambiguous or self-contradictory. **An assumption that is not written down is a
  defect** (CLAUDE.md §2) — implement the mechanism, leave the value
  configurable, and record the question.
- **Keep this file and `PROJECT_STATE.md` current**, especially the deployed
  commit and the applied migration. They describe a production system that
  fourteen people depend on.
- **Follow CLAUDE.md §19's working method every phase**: inspect the repository,
  state what will be implemented and which §23 acceptance criteria are targeted,
  write and apply the migration, implement the service with Zod schemas,
  implement the UI, write and verify RLS for every table touched **in the same
  phase as the table**, write unit and integration tests, run the full suite and
  fix every failure, update `/docs/*`, then summarise changes, deviations and open
  TODOs — and stop for review.
- **Never skip, `.skip` or delete a failing test to make a phase pass.**
- When something in the specification and something in the code disagree, the
  specification wins and the code is fixed — or the deviation is recorded in
  `/docs/DECISIONS.md` with a reason. `CLAUDE_CODE_BUILD_SPEC.md` is never edited.
