# Architecture

Derived from `CLAUDE_CODE_BUILD_SPEC.md` §16–§18. **Nothing here has been built yet.**

---

## 1. Shape of the system

One Next.js application talking to one Supabase project. No separate API server, no queue, no
cache tier, no microservices.

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
                              Supabase Postgres
                                RLS = the authorization boundary
                                check constraints = business-rule backbone
                                triggers = the audit trail
                              Supabase Auth · Supabase Storage (private)
                                         │
                                   Resend (email)
```

---

## 2. The stack — chosen and frozen (§17.1)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router + TypeScript strict | One codebase; Server Components keep mobile JS small |
| Database | Supabase Postgres | RLS is the permission model; managed backups |
| Auth | Supabase Auth (email + password) | No custom crypto; integrates with RLS via `auth.uid()` |
| Data access | `@supabase/ssr` server client with the user session | RLS enforced on every query automatically |
| UI | Tailwind + shadcn/ui + lucide-react | Components owned in-repo |
| Validation | Zod, schemas shared client/server | One definition |
| Forms | react-hook-form + zodResolver | |
| Client state | TanStack Query (lists/filters only) | No Redux, no Zustand |
| Charts | Recharts | Four chart types needed |
| Dates | date-fns, `Asia/Kolkata` | |
| Storage | Supabase Storage, private bucket | |
| Email | Resend behind `NotificationService` | Swappable |
| Cron | Vercel Cron → `/api/cron/*` | No queue infrastructure at this scale |
| Hosting | Vercel + Supabase | TODO-BD-08 (data residency) |
| Testing | Vitest + Playwright | |

**Rejected:** microservices · GraphQL · Redis · message queues · a separate API server · a native
mobile app · real-time subscriptions · state-management libraries.

**Any addition to this list requires a `/docs/DECISIONS.md` entry with the reason, recorded
before it is installed** (§17.1).

Two gaps already need a decision rather than a silent install: UTC→`Asia/Kolkata` rendering
(`date-fns` alone cannot do it) and magic-byte MIME verification —
`/docs/SPEC_AUDIT.md` M-13, M-14.

---

## 3. Rendering strategy (§17.2)

- **Server Components for reads** — dashboards, detail pages, lists.
- **Client Components for forms, filters and the activity sheet.**
- **Mutations through Server Actions calling services.**
- **No client-side Supabase writes.**

One explicit carve-out, pending approval: a **Storage upload from the browser against a
server-issued signed upload URL**. §15.6 allows 10 MB files, which exceeds the platform's
request-body limit, so routing the bytes through a Server Action is not possible. The database row
that references the file is still written by a Server Action.
(`/docs/SPEC_AUDIT.md` **B-09**, `CLAUDE.md` §7.)

**No optimistic UI in V1** (§12.6).

---

## 4. Layering

```
app/            routes, Server Actions, cron route handlers
  └─ authenticate → validate with Zod → call a service → map errors.  No business rules here.
features/       feature modules: components, hooks, schemas
  └─ may import services, lib, components/ui, components/shared
  └─ MUST NEVER import from another feature folder (§18)
services/       ALL business logic. One rule, one place.
  └─ throws AppError; calls lib/supabase/server or an RPC
lib/            supabase clients · money · phone · dates · errors · permissions · transitions
types/          database.types.ts (generated) · domain.ts
```

**No business rule is duplicated in a component** (§16). A component may not decide whether a
stage transition is legal, whether a value is high-value, or who may reassign.

Shared needs move to `components/shared` or `services` — never a cross-feature import. This needs
a lint rule to be real (`/docs/SPEC_AUDIT.md` M-30).

---

## 5. The three Supabase clients (§15.7)

| Client | Key | Used by | RLS |
|---|---|---|---|
| `lib/supabase/client.ts` | anon | Browser components (reads, and the signed-URL upload) | Applies |
| `lib/supabase/server.ts` | anon + user session | Server Components, Server Actions, services | **Applies** |
| `lib/supabase/admin.ts` | **service-role** | Cron routes, the import executor, user provisioning | **Bypassed** |

- The **anon key** is safe to expose. RLS is what protects the data.
- The **service-role key must never be imported into any file under `app/` that ships to the
  client.** `admin.ts` carries a runtime guard that throws if `typeof window !== 'undefined'`, and
  the security suite greps the build output for the key (§19.4).
- User provisioning as a third service-role caller is an exception to §15.7's "cron and import
  only" and needs approval (`/docs/SPEC_AUDIT.md` **H-07**).

---

## 6. Transactions (§16.3)

Multi-table writes use a **Postgres RPC (`SECURITY INVOKER`, so RLS still applies)** rather than
sequential client calls. Required for:

| RPC | Writes |
|---|---|
| `create_account_with_opportunity` | account → opportunity → activity (+ the `CREATED` event via trigger) |
| `log_activity` | activity → `accounts.last_activity_at` → `opportunities.last_activity_at` → next-action decision |
| `change_opportunity_stage` | opportunity update (+ the stage event via trigger) |
| `bulk_reassign` | many opportunities (+ owner events via trigger) |
| `execute_import` | the whole batch |

Two exceptions to `SECURITY INVOKER` are already implied by the spec and the audit:
`reassign_opportunity` is `SECURITY DEFINER` because the table policy denies `owner_id` changes
outright (§15.5 — *"Prefer the RPC"*), and `execute_import` runs under the service-role client
(§20.5).

---

## 7. Error contract (§16.2)

Services throw `AppError { code, message, field?, details? }` with codes `VALIDATION_FAILED` ·
`NOT_FOUND` · `FORBIDDEN` · `INVALID_TRANSITION` · `DUPLICATE_WARNING` · `CONSTRAINT_VIOLATION` ·
`CONFLICT` · `INTERNAL`.

Postgres check-constraint violations are caught and **mapped to friendly messages by constraint
name** — `won_requires_value` → *"Enter the confirmed order value before marking this won."*

> **A raw database error must never reach the UI** (§16.2, §12.6, §23.8).

---

## 8. Money and dates (§17.3, §8.11)

- `bigint` paise in the database; conversion only in `lib/money.ts`, only at UI and CSV boundaries.
- **Never `parseFloat` a rupee string.** All display goes through `<MoneyText>`.
- Timestamps stored UTC, rendered `Asia/Kolkata`.
- ⚠ **The business day is Asia/Kolkata, not the database session timezone.** Bare `current_date`
  and `::date` in SQL evaluate in UTC on Supabase and are a day stale between 00:00 and 05:30 IST.
  Every date expression uses `(now() at time zone 'Asia/Kolkata')::date`. `TZ=Asia/Kolkata` sets
  the Node timezone only and does not affect Postgres. (`/docs/SPEC_AUDIT.md` **B-10**.)

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
> implementation and no stub. Do not write fake adapters.**

---

## 10. Cron (§14.7)

Five routes under `/api/cron/*`. Each requires a `CRON_SECRET` bearer token, uses the service-role
client, is excluded from the public sitemap, and returns
`{ processed, sent, failed, durationMs }`. **Never block, never crash the cron route** — log
failures per user and continue.

Two platform constraints the spec does not mention (`/docs/SPEC_AUDIT.md` M-26, M-27): Vercel Cron
schedules are **static in `vercel.json`** and expressed in **UTC**, so IST times must be converted
and a settings-driven schedule (TODO-BD-05) must be implemented as an hourly trigger with an
in-route gate; hourly schedules and more than two jobs require a Pro plan.

---

## 11. Future-proofing already in the schema (§17.6)

`branch` columns (multi-branch later) · `order_reference` (accounting handoff) ·
`is_imported` / `legacy_ref` / `import_batch_id` (migration lineage) · append-only `activities`
and `opportunity_events` with structured outcomes.

> **Nothing further is added "for the future."**

---

## 12. Repository structure (§18)

```
CLAUDE_CODE_BUILD_SPEC.md · CLAUDE.md · README.md · .env.example
/docs        PRODUCT_REQUIREMENTS · DATABASE · ARCHITECTURE · PERMISSIONS · API
             TESTING · DECISIONS · SETUP · DEPLOYMENT · IMPLEMENTATION_PLAN · SPEC_AUDIT
/supabase    /migrations  /seed  config.toml
/src/app     (auth)/login · (app)/{today,dashboard,accounts,contacts,projects,opportunities,
             team,reports,import,settings,archive,search} · api/cron/*
/src/components   /ui (shadcn) · /shared · /layout
/src/features     accounts · contacts · projects · opportunities · activities · dashboard · import
/src/services     account · contact · project · opportunity · activity · dashboard · import
                  settings · /integrations
/src/lib          /supabase{client,server,admin} · money · phone · dates · errors · permissions
/src/types        database.types.ts (generated) · domain.ts
/src/hooks
/tests            /unit /integration /e2e
```

---

## 13. Architectural invariants

These do not change without approval recorded in `/docs/DECISIONS.md` (§17.1, `CLAUDE.md` §17):

1. **RLS is the authorization boundary.** Frontend filtering is not a control.
2. **The database enforces critical business rules.** Check constraints are not conveniences.
3. **No hard deletes.** Ever, by anyone.
4. **Append-only history.** `activities` (24-hour author edit window) and `opportunity_events`
   (no update, no delete, for anyone).
5. **Business logic lives in services.** Actions authenticate, validate, delegate, map errors.
6. **Money is bigint paise.**
7. **Timestamps UTC, displayed Asia/Kolkata.**
8. **Eleven tables.**
9. **No client-side Supabase writes** (one signed-upload carve-out, pending approval).
10. **No `TODO-BD` value hard-coded anywhere.**
