# Architecture

Derived from `CLAUDE_CODE_BUILD_SPEC.md` §16–§18, with the approved decisions of 2026-08-19
(Project Owner) applied. **Nothing has been built yet.**

ADRs referenced here are in `/docs/DECISIONS.md` §B; the findings behind them are in
`/docs/SPEC_AUDIT.md`.

---

## 1. Shape of the system

One Next.js application talking to one Supabase project in **Mumbai `ap-south-1`**. No separate
API server, no queue, no cache tier, no microservices.

```
Android phone / desktop browser
        │  httpOnly cookie session (@supabase/ssr)
        ▼
Next.js 15 App Router  (Vercel)
  ├─ Server Components ──── reads ──────┐
  ├─ Client Components ─ forms, filters │  anon key + user JWT
  ├─ Server Actions ─▶ services ─ writes┤  → RLS applies to every statement
  └─ /api/cron/*  ── service-role ──────┤  → RLS bypassed, CRON_SECRET required
                                         ▼
                              Supabase Postgres (ap-south-1)
                                RLS = the authorization boundary
                                check constraints = business-rule backbone
                                triggers = the audit trail
                              Supabase Auth · Supabase Storage (private)
        │                                │
        └─ signed upload URL ────────────┘   ADR-005: the ONE client-side write
                                         │
                                   Resend (email)
```

---

## 2. The stack — chosen and frozen (§17.1)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router + TypeScript strict | One codebase; Server Components keep mobile JS small |
| Database | Supabase Postgres, **`ap-south-1` (Mumbai)** | RLS is the permission model; **Indian data residency is required (TODO-BD-08)** |
| Auth | Supabase Auth (email + password) | No custom crypto; integrates with RLS via `auth.uid()`; **its built-in rate limiting satisfies §15.8 — no Redis (C-5)** |
| Data access | `@supabase/ssr` server client with the user session | RLS enforced on every query automatically |
| UI | **Tailwind CSS v4** (CSS-first, no `tailwind.config.ts` — ADR-015) + shadcn/ui + lucide-react | Components owned in-repo |
| Validation | Zod, schemas shared client/server | One definition |
| Forms | react-hook-form + zodResolver | |
| Client state | TanStack Query (lists/filters only) | No Redux, no Zustand |
| Charts | Recharts | Four chart types needed |
| Dates | date-fns + **`Intl.DateTimeFormat`** for `Asia/Kolkata` | M-13 — no new dependency |
| Storage | Supabase Storage, private bucket | |
| Email | Resend behind `NotificationService` | Swappable; needs a verified sender (M-28) |
| Cron | Vercel Cron → `/api/cron/*` | **A plan supporting hourly cron is required** (M-27) |
| Hosting | Vercel + Supabase Mumbai | TODO-BD-08 resolved |
| Testing | Vitest + Playwright | Integration suite needs Docker in CI (M-20) |

**Rejected:** microservices · GraphQL · Redis · message queues · a separate API server · a native
mobile app · real-time subscriptions · state-management libraries.

**Two additions considered and declined**, keeping the stack frozen:
- **M-13** — `date-fns-tz` is **not** installed. UTC→`Asia/Kolkata` rendering uses
  `Intl.DateTimeFormat` with `timeZone`.
- **M-14** — `file-type` is **not** installed. Magic-byte MIME verification is a hand-rolled
  signature check for the four allowed types (JPEG, PNG, WebP, PDF).

**One addition approved** — **M-30**: an ESLint import-boundary rule
(`import/no-restricted-paths` or equivalent), dev-dependency only, to enforce §18's
no-cross-feature-import rule. Without it the rule is a convention that will be violated silently.

Any further addition requires a `/docs/DECISIONS.md` entry with the reason, recorded **before**
it is installed (§17.1).

---

## 3. Rendering strategy (§17.2)

- **Server Components for reads** — dashboards, detail pages, lists.
- **Client Components for forms, filters and the activity sheet.**
- **Mutations through Server Actions calling services.**
- **No client-side Supabase writes** — with exactly one approved exception.

### ADR-005 — the one exception

**Browser → server-issued signed upload URL → private Supabase Storage.** §15.6 allows 10 MB
files; the platform's serverless request-body limit is 4.5 MB, so routing the bytes through a
Server Action is impossible. The signed URL is **short-lived** and is issued **only after a
server-side check that the caller can see the parent entity**. **The database row that references
the file is still written by a Server Action.**

This carve-out applies to **Storage object uploads only** and must not widen. It also makes
§11.5's "upload failure does not block the activity — the activity saves and the upload retries"
implementable, because the upload is a separate call.

**No optimistic UI in V1** (§12.6).

---

## 4. Layering

```
app/            routes, Server Actions, cron route handlers
  └─ authenticate → validate with Zod → call a service → map errors.  No business rules here.
features/       feature modules: components, hooks, schemas
  └─ may import services, lib, components/ui, components/shared
  └─ MUST NEVER import from another feature folder (§18) — enforced by lint (M-30)
services/       ALL business logic. One rule, one place.
  └─ throws AppError; calls lib/supabase/server or an RPC
lib/            supabase clients · money · phone · dates · errors · permissions · validation
                opportunity/transitions
types/          database.types.ts (generated) · domain.ts
```

**No business rule is duplicated in a component** (§16). A component may not decide whether a
stage transition is legal, whether a value is high-value, or who may reassign.

**`settings.service.ts` is the only reader of `system_settings`.** Resolving the twelve `TODO-BD`
items fixed the *values*; it did not licence a constant. `30000000` (the approved high-value
threshold) must never appear as a literal anywhere. Reads are wrapped in React's `cache`, so one
request reads the table once however many components ask — no cache infrastructure, per §17.1.

**Built in Master Phase 1:** `settings`, `auth`, `user` (provisioning, ADR-009) and `outlet`
(ADR-016) services, plus the shared `lib/*` foundation. The account, contact, project,
opportunity, activity, dashboard and import services arrive with their features.

---

## 5. The three Supabase clients (§15.7)

| Client | Key | Used by | RLS |
|---|---|---|---|
| `lib/supabase/client.ts` | anon | Browser components (reads, and the ADR-005 signed-URL upload) | Applies |
| `lib/supabase/server.ts` | anon + user session | Server Components, Server Actions, services | **Applies** |
| `lib/supabase/admin.ts` | **service-role** | Cron routes · the import executor · **user provisioning (ADR-009)** | **Bypassed** |

All three are typed against the generated `Database`, so a query naming a column that does not
exist fails `tsc` rather than at runtime. That is not cosmetic: it is what caught the ambiguous
`user_outlets` embed — the table references `users` twice, as the member and as `created_by`, so
the embed needs an explicit foreign-key hint.

- The **anon key** is safe to expose. RLS is what protects the data.
- The **service-role key must never be imported into any file under `app/` that ships to the
  client.** `admin.ts` carries a runtime guard that throws if `typeof window !== 'undefined'`, and
  the security suite greps the build output for the key (§19.4).
- **ADR-009 (H-07)** — user provisioning is the third permitted caller. §15.7 said "cron routes and
  the import executor only", but §12.2 puts user management inside the app at `/settings/users`
  and creating an auth user server-side requires the admin API. The **OWNER/ADMIN authorization
  check runs before the admin client is touched** — reversing that order is a privilege-escalation
  hole, and it carries a dedicated negative test.

---

## 6. Transactions (§16.3)

Multi-table writes use a **Postgres RPC** rather than sequential client calls.

| RPC | Security | Writes |
|---|---|---|
| `create_account_with_opportunity` | INVOKER | account → opportunity → activity (+ the `CREATED` event via trigger) |
| `log_activity` | INVOKER | activity → `accounts.last_activity_at` → `opportunities.last_activity_at` → next-action decision |
| `change_opportunity_stage` | INVOKER | opportunity update (+ the stage event via trigger, reason via GUC) |
| **`reassign_opportunity`** | **DEFINER** | `owner_id` — checks **`can_reassign()`** itself (ADR / B-02, H-05) |
| `bulk_reassign` | **DEFINER** | many opportunities, same gate |
| `execute_import` | service-role | the whole batch, atomically (ADR-012) |

`SECURITY INVOKER` is the default so RLS still applies. The two `DEFINER` exceptions exist because
the table policy denies `owner_id` changes outright — §15.5 itself states *"Prefer the RPC — it is
easier to test and audit."*

### ADR-001 — the audit reason channel

`opportunity_events` is append-only for everyone: no INSERT policy, no UPDATE policy, no DELETE
policy. The service therefore cannot attach a reason directly. It sets a **transaction-local GUC**
— `set_config('app.event_reason', <reason>, true)` — and the trigger reads it. The trigger stays
the single writer, so **no path can bypass the audit** (§5.9's stated goal). The same channel
writes `ARCHIVED`, `RESTORED` and `REOPENED` events, which previously had no writer at all (M-24).

### ADR-003 — the automated actor

Service-role clients have no `auth.uid()`, and `opportunity_events.actor_id` is `not null`. A
dedicated **system user** row in `public.users` (seeded `is_active = false`) is the actor for
automated writes. Automated changes are therefore visibly attributed to the system rather than
silently to a person.

### ADR-013 — `accounts` contactability is enforced in the database

M-05: `accounts` had no "phone or email required" constraint although §11.1 and §20.3 both require
one and `contacts` already enforced it. A check constraint `account_reachable` is added, so §5.7's
principle — a service-layer bug cannot create invalid data — holds for the most important table in
the system. Service and UI validation still supply the friendly message; **database integrity is
authoritative.**

### ADR-014 — maintenance failure state lives in `system_settings`

§14.6 requires alerting the OWNER when the maintenance job "fails twice consecutively", which
needs state across cron invocations. Two keys — `maintenance_consecutive_failures` and
`maintenance_last_failure_at` — hold it. The route updates both after **every** execution, alerts
at 2, and resets on success. **No notifications table** (§4.2's rejection stands). The deviation
is one of *kind*: `system_settings` holds configuration, and these are operational state. They are
written only by the cron route and are not editable at `/settings`.

### ADR-012 — import atomicity

§20.5 required both "one transaction per batch" and "progress reported per 100 rows"; a
transaction is invisible until it commits, so both cannot hold. **Atomicity is preserved and live
progress is dropped** — the guarantee that protects data integrity wins over the cosmetic one.
Progress is reported on completion.

---

## 7. Error contract (§16.2)

Services throw `AppError { code, message, field?, details? }` with codes `VALIDATION_FAILED` ·
`NOT_FOUND` · `FORBIDDEN` · `INVALID_TRANSITION` · `DUPLICATE_WARNING` · `CONSTRAINT_VIOLATION` ·
`CONFLICT` · `INTERNAL`.

Postgres check-constraint violations are caught and **mapped to friendly messages by constraint
name** — `won_requires_value` → *"Enter the confirmed order value before marking this won."*

> **A raw database error must never reach the UI** (§16.2, §12.6, §23.8).
> **Unauthorised record access returns 404**, never a message confirming the record exists (M-03).

---

## 8. Money and dates (§17.3, §8.11)

- `bigint` paise in the database; conversion only in `lib/money.ts`, only at UI and CSV boundaries.
- **Never `parseFloat` a rupee string.** All display goes through `<MoneyText>`.
- **M-29** — PostgREST serialises `bigint` as a JSON number, so §17.3's "parse as string" does not
  happen by itself. Values here (≤ ₹90,000 crore) are far below 2^53, so no data is at risk; cast
  in the select where an explicit string is wanted.
- Timestamps stored UTC, rendered `Asia/Kolkata` via `Intl.DateTimeFormat`.

### B-10 — the business day is Asia/Kolkata

Bare `current_date` and `::date` in SQL evaluate in the **database session timezone**, which is UTC
on Supabase. Between 00:00 and 05:30 IST every date-derived value is a day stale — "Due Today"
shows yesterday, "Overdue" under-counts, and the 02:00 IST maintenance job computes against the
wrong boundary. `TZ=Asia/Kolkata` sets the **Node** timezone only and does not affect Postgres.

**Every business-day expression uses `(now() at time zone 'Asia/Kolkata')::date` and the
equivalent conversion for stored timestamps.** `lib/dates.ts` and the SQL helpers must be
**behaviourally identical**, with boundary tests on both sides (§19.1).

---

## 9. Integration interfaces — declare, do not implement (§16.4)

```ts
export interface AccountingIntegration { isEnabled(): boolean }
export interface InventoryIntegration  { isEnabled(): boolean }
export interface WhatsAppIntegration   { isEnabled(): boolean; buildDeepLink(phone: string, text?: string): string }
export interface NotificationService   { sendEmail(to: string, subject: string, html: string): Promise<void> }
```

Only `WhatsAppIntegration.buildDeepLink` (`https://wa.me/91{phone}`) and
`NotificationService.sendEmail` (Resend) have implementations in V1.

> `AccountingIntegration` and `InventoryIntegration` are **type declarations with no
> implementation and no stub. Do not write fake adapters.** TODO-BD-09 confirms: no
> accounting-software integration in V1; the handoff is manual, via `order_reference` free text.

---

## 10. Cron (§14.7)

Five routes under `/api/cron/*`. Each requires a `CRON_SECRET` bearer token, uses the service-role
client, is excluded from the public sitemap, and returns
`{ processed, sent, failed, durationMs }`. **Never block, never crash the cron route** — log
failures per item and continue.

Two platform constraints and their approved resolutions:

- **ADR-011 (M-26)** — Vercel Cron schedules are **static in `vercel.json`**, so a settings-driven
  schedule cannot drive them. The owner summary runs on an **hourly trigger with an in-route
  gate** that reads `owner_summary_schedule` (daily, 19:00 Asia/Kolkata per TODO-BD-05) and sends
  only in the matching hour. **Changing the setting still requires no deploy**, which is the rule
  §24 exists to protect. The gate evaluates the hour in **Asia/Kolkata**, not UTC.
- **M-27** — cron expressions are **UTC** and must be converted from IST; a Vercel plan supporting
  **hourly** cron and five jobs is required.

**ADR-002 (B-05)** — the SLA reminder deduplicates on `opportunities.sla_notified_at`, sending
**at most once per opportunity**. Without it the reminder re-sends every hour forever, which is
the alert-fatigue failure §25 warns about.

**H-09** — nightly maintenance must **not** make imported records look user-edited; records still
inside the 7-day rollback window are excluded from the maintenance update.

**ADR-014** — the maintenance route persists its own health in `system_settings`:
`maintenance_consecutive_failures` and `maintenance_last_failure_at`, updated after every run,
alerting the OWNER once at two consecutive failures and resetting on success. The update belongs
in a `finally` — a run that throws before reaching it leaves the state stale.

---

## 11. Future-proofing already in the schema (§17.6)

`branch` columns (multi-branch later — TODO-BD-12: columns retained, **no UI, no filtering, no
RLS in V1**) · `order_reference` (accounting handoff — TODO-BD-09) · `is_imported` / `legacy_ref` /
`import_batch_id` (migration lineage) · append-only `activities` and `opportunity_events`.

> **Nothing further is added "for the future."** The one column added beyond §5 is
> `opportunities.sla_notified_at`, and it serves a V1 requirement (ADR-002), not a future one.

---

## 12. Repository structure (§18)

```
CLAUDE_CODE_BUILD_SPEC.md · CLAUDE.md · README.md · .env.example
/docs        PRODUCT_REQUIREMENTS · DATABASE · ARCHITECTURE · PERMISSIONS · API
             TESTING · DECISIONS · SETUP · DEPLOYMENT · IMPLEMENTATION_PLAN · SPEC_AUDIT
/supabase    /migrations  /seed  /platform (local runtime only, ADR-018)  config.toml
/scripts     db.sh · gen-types.mjs · check-no-service-key.sh
/src/app     (auth)/login · (app)/{today,dashboard,accounts,contacts,projects,opportunities,
             team,reports,import,settings,archive,search} · api/cron/*
/src/components   /ui (shadcn) · /shared · /layout
/src/features     accounts · contacts · projects · opportunities · activities · dashboard · import
/src/services     settings · auth · user · outlet · /integrations         [built]
                  account · contact · project · opportunity · activity
                  dashboard · import                                       [later phases]
/src/lib          /supabase{client,server,admin,middleware,env} · money · phone · dates
                  errors · permissions · validation · /opportunity/transitions
/src/types        database.types.ts (generated) · domain.ts
/tests            /unit /integration /e2e
```

---

## 12a. The local database runtime (ADR-018)

Where the Supabase container images cannot be pulled, migrations, the integration and RLS suites,
and type generation all run against a **real PostgreSQL 16 server**, with the platform objects the
application depends on created by `supabase/platform/000_supabase_platform.sql` — **not a
migration**, and never run against a Supabase project.

- Migrations are applied by the **Supabase CLI** (`supabase migration up --db-url`), so ordering
  and the `supabase_migrations` ledger are exercised for real.
- Types come from **`@supabase/postgres-meta`** — the same generator the `supabase gen types`
  container runs — invoked as a library.
- Tests impersonate a user the way PostgREST does: `set role authenticated` plus
  `set_config('request.jwt.claims', …)`.

**What it cannot verify** — and what is therefore still open — is Supabase Auth itself, Storage
policies, and PostgREST request handling. See `/docs/SETUP.md`.

---

## 13. Architectural invariants

These do not change without approval recorded in `/docs/DECISIONS.md` (§17.1, `CLAUDE.md` §17):

1. **RLS is the authorization boundary.** Frontend filtering is not a control.
2. **The database enforces critical business rules.** Check constraints are not conveniences.
   Exactly one was narrowed (ADR-006), and only because it contradicted the transition matrix;
   one was added (ADR-013, `account_reachable`).
3. **No hard deletes** — with exactly one approved exception, `project_stakeholders` (ADR-004).
4. **Append-only history.** `activities` (24-hour author edit window) and `opportunity_events`
   (no update, no delete, for anyone; the reason arrives via the ADR-001 GUC).
5. **Business logic lives in services.** Actions authenticate, validate, delegate, map errors.
6. **Money is bigint paise.**
7. **Timestamps UTC, business day Asia/Kolkata** — explicitly converted, never session-default.
8. **Thirteen tables** — the spec's eleven plus `outlets` and `user_outlets` (ADR-016), which are
   organizational structure rather than CRM records. ADR-008 declined a table for merge history and
   §4.2's rejected tables stay rejected.
11. **Outlet scope is enforced in the database** (ADR-016). A manager's reach is
    `user_outlets`, never a role name and never a string comparison. `branch` is retired.
12. **ADMIN has no automatic business-data visibility** (ADR-017).
9. **No client-side Supabase writes** — with exactly one approved exception, the ADR-005 signed
   Storage upload.
10. **No `TODO-BD` value hard-coded anywhere.** Resolution fixed the values, not the mechanism.
