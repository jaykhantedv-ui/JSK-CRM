# CLAUDE.md — Engineering Instructions for the JSK CRM

These are project rules, not suggestions. They apply to every session, every phase and every
file in this repository. Read this file and `CLAUDE_CODE_BUILD_SPEC.md` before writing code.

---

## 1. The source of truth

`CLAUDE_CODE_BUILD_SPEC.md` at the repository root is the **implementation source of truth**.

- If behaviour is not described in the spec, **it is not in Version 1**.
- If the spec and this file appear to disagree, the spec wins; raise the conflict.
- If the spec and an existing implementation disagree, the spec wins; fix the implementation
  or document the deviation in `/docs/DECISIONS.md` with a reason.
- **Never edit `CLAUDE_CODE_BUILD_SPEC.md`.** Issues with the spec are recorded in
  `/docs/SPEC_AUDIT.md` and resolved by the business owner, not by a code change.

Section references in this file (`§9.2`, `§15.4`, …) point at the spec.

## 2. No silent assumptions

When the spec is silent, ambiguous or self-contradictory:

1. **Stop.** Do not pick a value and move on.
2. Record the question in `/docs/SPEC_AUDIT.md` (or `/docs/DECISIONS.md` if it is a business
   decision) with the section reference and the options.
3. Ask for a decision in the phase summary.

An assumption that is not written down is a defect. If you must proceed to avoid blocking
unrelated work, implement the *mechanism*, leave the *value* configurable, and flag it in the
phase summary as an open item — never bury it in code.

## 3. `TODO-BD` values are never hard-coded — even now that they are decided

The spec marks twelve business decisions `TODO-BD-01` … `TODO-BD-12` (§24). **All twelve were
resolved by the Project Owner on 2026-08-19** and are recorded in `/docs/DECISIONS.md` §A.

**Resolution fixed the values. It did not licence a constant.**

- **Never hard-code a `TODO-BD` value.** Not in a constant, not in a default parameter, not in a
  migration literal outside the `system_settings` seed, not in a test fixture the application
  reads. `30000000` — the approved high-value threshold — must appear in exactly one place.
- Implement the **mechanism**; read the value from `system_settings` through the cached settings
  helper (`services/settings.service.ts`), which is the **only** reader.
- Settings keys: `cities` (the ten Erode District **revenue taluks**), `stage_probabilities`,
  `high_value_threshold_paise` (`30000000`), **`account_dormancy_days`**,
  **`opportunity_dormancy_days`**, `stage_stall_days`, `new_enquiry_sla_hours`,
  `owner_summary_schedule`, `material_types`, plus two operational-state keys written only by the
  maintenance cron — **`maintenance_consecutive_failures`**, **`maintenance_last_failure_at`**
  (§5.10 + ADR-010, ADR-014). **`dormancy_days` is retired** and must never be seeded.
- Reading any of these from a literal in application code is a bug.
- If a new threshold is needed, it is a new `system_settings` key plus a `/docs/DECISIONS.md`
  entry — not a constant.

## 4. Version 1 scope only

§2.3 lists what is explicitly out of scope. Do not build it, do not stub it, do not add
columns "ready for" it beyond exactly what §17.6 already specifies.

Out of scope in V1: accounting/GST/invoicing/inventory integration · commission · line-item
quotation engine · WhatsApp Business API, webhooks or message ingestion · marketing automation ·
AI/lead scoring/forecasting · slab-level stone inventory · sample tracking · multi-branch UI ·
offline mode · customer portal · SMS/push notifications.

Rejected tables (§4.2) stay rejected: `leads`, `companies`, `tasks`, `quotations`, `products`,
`notifications`, `attachments`. **Eleven tables, no more** (§4.1). Adding a twelfth table
requires explicit approval recorded in `/docs/DECISIONS.md` before the migration is written.

Rejected infrastructure (§17.1) stays rejected: microservices, GraphQL, Redis, message queues,
a separate API server, a native mobile app, real-time subscriptions, state-management libraries.

**The word "Revenue" must never appear in the UI** (§2.4). Use Pipeline Value, Won Value,
Weighted Pipeline.

## 5. The database enforces critical business rules

Constraints are the backbone of data quality. A service-layer bug must not be able to create
invalid data. These live in the schema and must never be relaxed to make code easier:

- `won_requires_value` · `won_requires_closed` · `lost_requires_reason` · `lost_requires_closed`
- `quoted_requires_quotation` — binding on **`quoted` only**, never `negotiation` or
  `verbal_confirmation` (ADR-006) · `next_action_pairing` · `nurture_needs_date` (§5.7)
- `contact_reachable` on `contacts`, **`account_reachable` on `accounts`** (ADR-013),
  `stakeholder_target` on `project_stakeholders`
- `one_primary_per_project` partial unique index (§5.6)
- `log_opportunity_event()` trigger on `opportunities` (§5.9)

If a constraint blocks a legitimate flow, the **flow** is wrong, or the constraint needs a spec
change — raise it, do not drop the constraint.

Derived values are **computed in queries, never stored**: `is_overdue`, `days_in_stage`,
`weighted_value`, `is_dormant`, `is_missing_next_action` (§5.7, §10.3).

## 6. RLS is the authorization boundary

- Every table has RLS enabled with explicit `SELECT` / `INSERT` / `UPDATE` policies (§15.2).
- **No `DELETE` policy on any table for any role**, with exactly one approved exception:
  `project_stakeholders` (ADR-004), whose rows are relationship links rather than business
  records. A reviewer should be able to grep for `for delete` and find **one** policy. A second
  one means the flow is wrong — raise it.
- Frontend filtering is **not** a control. A hidden button is **not** a control. Every
  permission must hold against a direct PostgREST call with a salesperson's JWT.
- Role lookups inside policies go through the `SECURITY DEFINER` helpers in §15.1
  (`user_role()`, `is_manager_or_above()`, `is_owner_or_admin()`, `owns_opportunity_on_*`).
  **Never write a policy on `public.users` that selects from `public.users`** — it recurses.
- `v_opportunity_flags` and every other view must be created with `security_invoker = true`.
  A view without it silently bypasses RLS and leaks every salesperson's pipeline (§25).
- Every RLS change ships with an integration test that proves the negative case, written as the
  *restricted* role. **Never verify a permission as OWNER** — OWNER passes everything (§23).

## 7. No client-side Supabase writes

- Reads: Server Components using the `@supabase/ssr` server client with the user's session.
- Writes: **Server Actions → services**. No `supabase.from(...).insert()` in a Client Component.
- The only permitted browser-side Supabase call that writes is a **Storage upload against a
  server-issued signed upload URL** — approved as **ADR-005**, because a 10 MB file (§15.6)
  exceeds the platform request-body limit. The URL is short-lived and is issued only after a
  server-side check that the caller can see the parent entity. The database row that references
  the file is still written by a Server Action. **This carve-out applies to nothing else.**
- The **service-role key never enters a client bundle**. `lib/supabase/admin.ts` throws if
  `typeof window !== 'undefined'`. It has exactly three callers: cron routes, the import
  executor, and the user-provisioning Server Action — the last only **after** a server-side
  OWNER/ADMIN check (§15.7 + **ADR-009**). Reversing that order is a privilege-escalation hole.
  A build-output grep for the key is part of the security suite (§19.4).

## 8. Business logic belongs in services

- All business logic lives in `src/services/*`. One rule, one place.
- Server Actions and route handlers do exactly four things: **authenticate → validate with Zod →
  call a service → map errors**. They contain no business rules.
- **No business rule is duplicated in a component.** A component may not decide whether a stage
  transition is legal, whether a value is high-value, or who may reassign.
- A feature folder (`src/features/x`) may import from `services`, `lib`, `components/ui` and
  `components/shared`. A feature folder **must never import from another feature folder** (§18).
- Services throw a typed `AppError { code, message, field?, details? }` (§16.2). A raw Postgres
  error must never reach the UI; check-constraint violations are mapped to friendly messages by
  constraint name.
- Multi-table writes go through a Postgres RPC (`SECURITY INVOKER`, so RLS still applies), not
  sequential client calls (§16.3): `createAccountWithOpportunity`, `logActivity`,
  `changeOpportunityStage`, `bulkReassign`, `executeImport`.

## 9. Money is bigint paise

- Money is stored as **`bigint` paise**. Never float. Never rupees in the database.
- Rupee conversion happens **only** at the UI and CSV boundaries, in `lib/money.ts`.
- **Never `parseFloat` a rupee string.** Parse from Supabase deliberately and convert explicitly.
- All display goes through `<MoneyText>`: Indian grouping, `₹4,20,000`, tabular numerals.

## 10. Timestamps are UTC, displayed Asia/Kolkata

- All timestamps are `timestamptz`, stored UTC (§8.11).
- All display is `Asia/Kolkata`, dates as `dd MMM yyyy`, recency shown relatively.
- **The business day is Asia/Kolkata, not the database session timezone.** Bare `current_date`
  and `timestamptz::date` in SQL evaluate in the session timezone (UTC on Supabase) and are
  wrong for 5.5 hours every day. Use `(now() at time zone 'Asia/Kolkata')::date` and
  `(ts at time zone 'Asia/Kolkata')::date` in every overdue / due-today / days-in-stage /
  period-boundary expression. See `/docs/SPEC_AUDIT.md` B-10. This has an explicit unit test
  (§19.1, "date/overdue calculations across timezone boundaries").

## 11. No hard deletes

- Nothing is ever hard-deleted. Archivable tables carry `archived_at` / `archived_by`.
- **Every read query filters `archived_at is null`** unless it is explicitly the archive view.
- Archived records keep all relationships and activities, contribute nothing to pipeline value,
  and can be restored (§8.8).
- "Remove" in the UI means archive. If a table has no `archived_at` column and the spec asks for
  removal, that is a spec gap — raise it, do not add a `DELETE` policy.

## 12. Activities are append-only with a 24-hour edit window

- `activities` is append-only history: **what happened**.
- Editable **by the author** (`performed_by = auth.uid()`) for **24 hours** from `created_at`,
  enforced by the RLS `UPDATE` policy — not by the UI (§5.8, §8.10).
- **Immutable thereafter. Deletable by nobody, ever.** There is no `DELETE` policy.
- Corrections after 24 hours are appended as a new activity of type `NOTE`.
- `activities.account_id` is **always** populated, even when logging from an opportunity, so the
  Customer 360 timeline is one indexed query.
- Reassignment never rewrites history: activities keep their original `performed_by` (§8.1).

## 13. Opportunity events are append-only

- `opportunity_events` is the audit trail: **what the system recorded about the record**.
- Written by the database trigger on `opportunities` so no path can bypass the audit (§5.9).
- **No `UPDATE` and no `DELETE` policy for any role, including OWNER.** Historical stage changes
  are never deleted or rewritten (§9.2).
- Stage transitions are validated against the constant map in `lib/opportunity/transitions.ts`
  and rejected with `INVALID_TRANSITION`. Backward moves require a `reason`, which reaches the
  event row through the transaction-local `app.event_reason` GUC (**ADR-001**) — the trigger stays
  the single writer.
- The matrix carries one approved addition: **`won → qualified`**, reopen-only, MANAGER/OWNER-only
  (**ADR-007**). Reopening clears `final_order_value` and `closed_at`, preserves the historical
  `WON` event, and **does not change `accounts.status`** — the account may hold other won
  opportunities.
- `activities` and `opportunity_events` are deliberately separate and must not be merged.

## 14. No fake integrations

- §16.4 declares four integration interfaces. Only `WhatsAppIntegration.buildDeepLink` and
  `NotificationService.sendEmail` have implementations in V1.
- `AccountingIntegration` and `InventoryIntegration` are **type declarations with no
  implementation and no stub**. **Do not write fake adapters**, mock clients, or
  "coming soon" handlers.
- §14.8 is not automated in V1: auto-assignment · auto-closing stale opportunities ·
  auto-merging duplicates · auto-reassignment · any message to a customer · per-event
  create/edit notifications.

## 15. No fake data presented as production functionality

- Dashboard tiles and reports are computed from real queries against real tables. Never a
  hard-coded number, never a placeholder chart series, never a "sample" row that ships.
- Seed and fixture data lives in `/supabase/seed/dev-fixtures.sql` and is **development only**.
  It never runs against staging or production.
- If a metric cannot be computed yet, render the specified empty/loading/error state (§12.6) —
  not an invented value. Win Rate with a zero denominator displays `—`, never `0%` (§13.1).
- An unimplemented screen shows nothing rather than a mock. Do not demo a phase with fixtures
  and describe it as working.

## 16. No unnecessary libraries

The stack in §17.1 is **chosen and frozen**: Next.js 15 App Router + TypeScript strict ·
Supabase Postgres + Auth + Storage · `@supabase/ssr` · Tailwind + shadcn/ui + lucide-react ·
Zod · react-hook-form + zodResolver · TanStack Query (lists/filters only) · Recharts · date-fns ·
Resend · Vercel Cron · Vitest + Playwright.

- Adding **any** dependency outside this list requires a `/docs/DECISIONS.md` entry with the
  reason, recorded **before** it is installed (§17.1).
- Prefer the platform: shadcn components are owned in-repo and edited, not wrapped in a new
  abstraction library. `Intl` before a formatting package.
- Two gaps were closed on 2026-08-19 **without** adding a dependency: UTC→Asia/Kolkata rendering
  uses **`Intl.DateTimeFormat`** (`date-fns-tz` is **not** installed, M-13), and magic-byte MIME
  verification is a **hand-rolled signature check** for the four allowed types — JPEG, PNG, WebP,
  PDF (`file-type` is **not** installed, M-14).
- One dev-dependency addition is approved: an **ESLint import-boundary rule**
  (`import/no-restricted-paths` or equivalent) enforcing §18's no-cross-feature-import rule
  (M-30). It ships nothing to the browser.
- Login rate limiting uses **Supabase Auth's built-in** limits — **no Redis**, no distributed
  rate-limiting infrastructure (C-5).

## 17. No architecture changes without explicit approval

- Do not change the rendering strategy (§17.2), the service/Server-Action boundary, the
  eleven-table model, the RLS-as-authorization model, the money representation, or the
  repository structure (§18) without written approval recorded in `/docs/DECISIONS.md`.
- **Never rewrite working functionality without a stated reason** (§22.1).
- Never edit a migration that has been applied to production — write a new one (§21.2). Never
  modify production schema through the Supabase dashboard.

## 18. Tests are required for critical business logic and permissions

Not optional, not deferred to a later phase.

- **Unit (Vitest):** phone normalisation · money/paise conversion · the *complete* stage
  transition matrix, every valid and invalid pair · duplicate confidence scoring · every
  dashboard metric function · date/overdue calculations across timezone boundaries (§19.1).
- **Integration (Vitest + local Supabase):** check constraints, triggers, partial unique
  indexes, and **every RLS rule** — these are the most important tests in the project (§19.2).
- **E2E (Playwright):** the fifteen scenarios in §19.3, all of them.
- **Security (§19.4):** every test attacks the **API, not the UI** — direct PostgREST calls with
  salesperson credentials, role escalation via profile update, service-role key absent from the
  build output, Storage access without entity visibility, unauthenticated access to every route,
  session expiry, disguised-executable upload, SQL injection through search.
- **Run the full suite each phase. Fix every failure. Never skip, `.skip`, or delete a failing
  test to make a phase pass** (§22.1 step 8).
- Do not chase a coverage percentage; the fifteen E2E scenarios plus the RLS suite are the gate.

## 19. Working method — every phase

From §22.1, applied without exception:

1. Inspect the existing repository before writing anything.
2. State what will be implemented and which acceptance criteria (§23) are targeted.
3. Write migrations. Apply locally. Verify with `supabase db diff`.
4. Implement services with Zod schemas.
5. Implement UI.
6. Implement/verify RLS policies for the tables touched — **in the same phase as the table**.
7. Write unit + integration tests.
8. Run the full suite. Fix every failure.
9. Update `/docs/*` to reflect what was actually built.
10. Summarise changes, deviations from the spec (with reasons), and open TODOs.
11. **Stop. Wait for review before the next phase.**

## 20. Repository map

```
CLAUDE_CODE_BUILD_SPEC.md   source of truth — never edited
CLAUDE.md                   this file
/docs                       PRODUCT_REQUIREMENTS · DATABASE · ARCHITECTURE · PERMISSIONS
                            API · TESTING · DECISIONS · SETUP · DEPLOYMENT
                            IMPLEMENTATION_PLAN · SPEC_AUDIT
/supabase/migrations        001_… 017_… (§5.12) — append-only once applied
/supabase/seed              seed.sql (all envs), dev-fixtures.sql (development only)
/src/app                    routes, Server Actions, /api/cron/*
/src/components             ui (shadcn) · shared · layout
/src/features               feature modules — never import across features
/src/services               ALL business logic
/src/lib                    supabase/{client,server,admin} · money · phone · dates · errors · permissions
/src/types                  database.types.ts (generated) · domain.ts
/tests                      unit · integration · e2e
```

## 21. Definition of done for a phase

Migrations applied · services implemented with Zod schemas · UI working · **RLS policies for
every table touched, written and tested** · unit + integration tests written **and passing** ·
`npm run build` clean with zero TypeScript and lint errors · `/docs/*` updated to match what was
actually built · the phase's §23 acceptance criteria verified **as the restricted role** · a
written summary of changes, deviations and open TODOs.

Anything short of that is not done.
