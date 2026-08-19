# Implementation Plan

**Source of truth:** `CLAUDE_CODE_BUILD_SPEC.md`. Section references (`§9.2`) point at it.
**Audit:** `/docs/SPEC_AUDIT.md` — 53 findings. Each phase below lists the findings that block it.
**Open business decisions:** `/docs/DECISIONS.md` — 12 `TODO-BD` items, none resolved in code.

---

## How this plan relates to §22

The spec defines **nine build phases** with formal gates in §23. This plan expands those into
**21 working phases** for sequencing and review. §22 and §23 remain authoritative: a spec phase is
complete only when its §23 criteria pass. The mapping:

| Spec phase (§22) | Gate (§23) | Working phases here |
|---|---|---|
| 1 Foundation | "a new dev can clone, run, log in, create a salesperson" | 1, 2, 3, 4, 7 |
| 2 Identity | §23.1, §23.2 | 8, 9, 13 (search half) |
| 3 Projects | §23.3 | 10 |
| 4 Sales | §23.4 | 11 |
| 5 Accountability | §23.5 | 12 |
| 6 Management | §23.6 | 14 |
| 7 Data | §23.7 | 15, 16, 17 |
| 8 Security & QA | §23.8 | 5 (written early), 19 |
| 9 Launch | §23.9 | 18, 20, 21 |

Phases 5 (RLS) and 6 (services) are **not** deferred: §22 requires policies to be written as each
table is created. Phase 5 establishes the pattern and the test harness; every later phase extends
both and re-runs the suite. Phase 19 is the adversarial audit of what was built, not the first
time security is considered.

**Every phase ends with §22.1 step 11: stop, summarise, wait for review.**

---

## Dependency graph

```
1 Foundation
└─2 Supabase config ─ TODO-BD-08 must be answered first (region is irreversible)
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

**Files/modules.** `package.json`, `next.config.ts`, `tsconfig.json` (strict), `tailwind.config.ts`,
`postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`,
`.env.example`, `.gitignore`, `src/app/layout.tsx`, `src/app/globals.css`, the empty §18 folder
tree with `.gitkeep`, `/tests/{unit,integration,e2e}`.

**Database changes.** None.

**Tests.** One trivial unit test proving Vitest runs. One Playwright smoke test proving the app
boots. `npm run build` clean.

**Acceptance criteria.**
- `npm install && npm run build && npm run lint && npm run test` all pass with zero errors.
- TypeScript `strict: true`, no `any` escape hatches configured.
- The §18 tree exists exactly; no extra top-level folders.
- Only §17.1 dependencies are installed. Any addition is recorded in `/docs/DECISIONS.md` **first**.
- An `import/no-restricted-paths` lint rule enforces §18's no-cross-feature-import rule
  (**M-30** — needs approval for the lint plugin).

**Risks.** Dependency creep — the shadcn CLI pulls in transitive packages; audit the lockfile
against §17.1 before committing. M-13 (`date-fns-tz` vs `Intl`) and M-14 (magic-byte sniffing)
should be decided here rather than mid-phase later.

---

# Phase 2 — Supabase configuration

**Spec phase:** 1 Foundation · **Spec sections:** §17.1, §17.4, §21.1, §21.2, TODO-BD-08

**Objective.** Local Supabase running under Docker, `supabase/config.toml` committed, a staging
project provisioned, and the migration workflow proven end to end on an empty database.

**Dependencies.** Phase 1. **Blocked on TODO-BD-08** for anything beyond local — the Supabase
region is chosen at project creation and **cannot be changed afterwards**. Local development can
proceed; do not provision staging or production until the residency question is answered.

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
- `.env.example` documents every §17.4 variable plus the M-28 additions; `.env.local` is ignored.
- The service-role key is not referenced anywhere under `src/app` (lint rule or grep in CI).
- Type generation is a documented, repeatable script.

**Risks.** **TODO-BD-08** is a hard gate on provisioning. Docker availability in CI (**M-20**).
Committing a real key to `.env.example` — the file must contain placeholders only.

---

# Phase 3 — Database migrations and database helpers

**Spec phase:** 1–5 (migrations 001–013) · **Spec sections:** §5 (all), §6, §10.3, §17.6

**Objective.** The complete eleven-table schema, all enums, all constraints, all indexes, the
`touch_updated_at` and `log_opportunity_event` triggers, `normalize_phone`, the
`v_opportunity_flags` view, and the `system_settings` seed — applied cleanly to an empty database
in the §5.12 order.

**Dependencies.** Phase 2. **Blocked on B-04, B-06, B-07, B-10, H-01, H-03, M-08, M-23.**

**Files/modules.**
```
supabase/migrations/
  001_extensions_and_helpers.sql   pgcrypto, pg_trgm, normalize_phone() [IMMUTABLE — B-06], touch_updated_at()
  002_enums.sql                    all 19 enum types (§5.1) — note lowercase opportunity_stage (M-23)
  003_users.sql                    users + touch trigger + handle_new_auth_user() [H-07 defines it]
  004_import.sql                   import_batches, import_rows
  005_accounts.sql                 accounts WITHOUT referred_by_contact_id FK (B-07)
  006_contacts.sql                 contacts
  007_accounts_fk.sql              alter table accounts add constraint … references contacts
  008_projects.sql                 projects
  009_project_stakeholders.sql     + three partial unique indexes
  010_opportunities.sql            + seven check constraints, eight indexes
  011_activities.sql               activities
  012_opportunity_events.sql       + log_opportunity_event() trigger [B-03 actor, H-01 stage_changed_at]
  013_system_settings.sql          + seed rows (§5.10) — moved earlier than §22 implies (H-03)
  0xx_flags_view.sql               v_opportunity_flags WITH (security_invoker = true) [B-10 timezone]
src/types/database.types.ts        generated
src/lib/dates.ts                   IST business-day helpers mirroring the SQL (B-10)
```

**Database changes.** Everything in §5. Deviations forced by the audit, each documented inline in
the migration and in `/docs/DATABASE.md`: `normalize_phone` declared `immutable`;
`referred_by_contact_id` FK deferred to 007; `013` applied before the RLS phase because Phases
12/14 read it; every date expression written `(now() at time zone 'Asia/Kolkata')::date`.

**Tests (integration, Vitest + local Supabase).**
- `supabase db reset` applies 001→013 cleanly to an empty database, twice in a row.
- Every check constraint rejects its invalid case: won without value, won without `closed_at`,
  lost without reason, lost without `closed_at`, quoted without quotation fields, next-action
  half-set, nurture without date, contact with neither phone nor email, stakeholder with neither
  target.
- `one_primary_per_project` rejects a second primary.
- `log_opportunity_event()` writes exactly one row on insert, on stage change, on owner change,
  and both rows when stage and owner change in one statement.
- `stage_changed_at` advances on stage change and only then (H-01).
- `normalize_phone`: `+91 98765-43210`, `098765 43210`, `919876543210`, `9876543210` → `9876543210`;
  `12345` → null.
- `v_opportunity_flags` has `security_invoker = true` (assert against `pg_class.reloptions`).
- Timezone: an opportunity due "today IST" is due today when queried at 23:00 UTC (B-10).

**Acceptance criteria.** §23.9 first bullet — "migrations apply cleanly to an empty database".
Eleven tables, no more (§4.1). Every column in §5 present, no column not in §5 (§5.5's
"Do not add fields not listed"). Generated types compile.

**Risks.** This phase is where seven audit findings land at once; resolving them piecemeal
mid-migration produces an inconsistent schema. **Get B-04, B-06, B-07, B-10 and H-03 answered
before the first migration is written.** The circular `accounts ↔ contacts` FK (§25) is handled
but easy to reintroduce by pasting §5.3 verbatim. Migration files are append-only once applied to
any shared environment (§21.2).

---

# Phase 4 — Authentication and users

**Spec phase:** 1 Foundation · **Spec sections:** §3.2, §5.2, §12.2, §15.3, §15.8, §17.2

**Objective.** Email/password login via Supabase Auth, httpOnly cookie sessions via
`@supabase/ssr`, role-based landing redirects, and OWNER/ADMIN user management — with no
self-registration.

**Dependencies.** Phase 3. **Blocked on H-07** (service-role for `auth.admin.createUser`) and
**M-01** (where ADMIN lands).

**Files/modules.** `src/app/(auth)/login/page.tsx`, `src/middleware.ts` (session refresh + route
guards), `src/app/(app)/layout.tsx`, `src/app/settings/users/*`,
`src/services/user.service.ts`, `src/lib/permissions.ts`, `src/features/auth/*`.

**Database changes.** None (003 already applied). `handle_new_auth_user()` behaviour is finalised
here.

**Tests.**
- Unit: role → landing route mapping for all four roles (M-01).
- Integration: a deactivated user cannot log in; an active salesperson can; `user_role()` returns
  null for `is_active = false`.
- E2E: login, logout, session persistence across reload, unauthenticated access to every `(app)`
  route redirects to `/login` (§19.4).
- Security: the sign-up endpoint is disabled — self-registration returns an error (§3.2).

**Acceptance criteria.** §22 Phase 1 gate: *"a new dev can clone, run, log in as the seeded OWNER,
and create a salesperson who can log in."* Sessions are httpOnly cookies, never `localStorage`.
Route guards are middleware-level, not component-level.

**Risks.** H-07 — user provisioning needs the service-role key, which §15.7 restricts; the
provisioning action must verify OWNER/ADMIN **server-side before** touching the admin client, or
it is a privilege-escalation hole. M-25 — deactivation does not revoke live sessions. M-12 —
login rate limiting.

---

# Phase 5 — RLS and permissions

**Spec phase:** 1–5 (written per table), audited in 8 · **Spec sections:** §3.1, §3.2, §15 (all), §19.2

**Objective.** The RLS helper functions, the policy pattern, and the integration-test harness that
every later phase extends. After this phase, adding a table without policies and negative tests is
a phase failure.

**Dependencies.** Phases 3, 4. **Blocked on B-02, H-04, H-05, H-06, H-12, M-15.**

**Files/modules.**
```
supabase/migrations/
  014a_rls_helpers_role.sql     user_role, is_manager_or_above, is_owner_or_admin, can_reassign [H-05]
  014b_rls_helpers_context.sql  owns_opportunity_on_*, can_see_account/project/opportunity/activity [H-12]
                                — after 010/011 (B-04)
  015_rls_policies.sql          audit/hardening pass; per-table policies live in each table's migration (H-04)
  0xx_reassign_opportunity.sql  SECURITY DEFINER RPC (B-02, preferred by §15.5)
src/lib/permissions.ts          UI-level capability map — mirrors RLS, never substitutes for it
tests/integration/rls/*.test.ts one file per table
```

**Database changes.** `enable row level security` on all eleven tables **in each table's own
migration**. `SELECT`/`INSERT`/`UPDATE` policies per §15.3–§15.5. **No `DELETE` policy anywhere**
(H-06: `users_admin_all for all` must be enumerated instead). All helpers `SECURITY DEFINER`,
`stable`, `set search_path = public`, `revoke execute from anon`, `grant execute to authenticated`.
Every helper call wrapped as `(select public.fn(...))` in policies for InitPlan caching (M-19).

**Tests (§19.2 — the most important tests in the project).** Seeded users of each role, and
**every assertion made as the restricted role, never as OWNER** (§23).
- Salesperson A cannot SELECT / UPDATE / INSERT-on-behalf-of salesperson B's records.
- Salesperson **can** read an account they do not own when they own an opportunity on it (§15.4)
  — and can read the account's contacts and projects by the same route (H-12).
- Salesperson cannot change `owner_id` by any route: direct UPDATE, PostgREST, and the RPC (B-02).
- ADMIN cannot reassign (H-05); MANAGER and OWNER can.
- No role can DELETE from any table, including `users` (H-06).
- A salesperson cannot escalate their own role via profile update (§15.3).
- `v_opportunity_flags` returns only the caller's rows for a salesperson (§25).
- Archived records excluded from active queries, included for authorised roles.

**Acceptance criteria.** §23.8 bullets 2–4. Every capability row in §3.1 has at least one passing
positive test and one passing negative test. Policy performance measured against a seeded dataset
before Phase 14 depends on it (M-19).

**Risks.** **RLS recursion on `users`** — §25 names it as the most likely early blocker; the
`SECURITY DEFINER` helpers are the answer and must not be bypassed. B-02's fallback SQL is broken
and must not be used. H-04 — if RLS is not enabled per table now, every intermediate deployment is
exposed. M-19 — subquery-bound policies are the main threat to §12.8's 400 ms budget.

---

# Phase 6 — Core services and business logic

**Spec phase:** 2–7 (foundation laid here) · **Spec sections:** §16 (all), §17.2, §17.3, §18, §8.11

**Objective.** The service layer's spine before any feature uses it: the error contract, Zod
schema conventions, the Server Action → service boundary, money and phone and date libraries, the
transition matrix, and the cached settings reader.

**Dependencies.** Phases 3, 5.

**Files/modules.**
```
src/lib/errors.ts               AppError { code, message, field?, details? } + constraint-name → message map (§16.2)
src/lib/money.ts                paise ↔ rupees, Indian grouping, no parseFloat (§17.3)
src/lib/phone.ts                normalisation mirroring the SQL function exactly (§5.3)
src/lib/dates.ts                Asia/Kolkata business day, relative recency (B-10, M-13)
src/lib/opportunity/transitions.ts   the §9.2 matrix as a constant map
src/services/settings.service.ts     cached read of system_settings — the ONLY reader (§5.10)
src/services/*.service.ts            signatures from §16.1, unimplemented bodies typed
src/features/*/schemas.ts            Zod schemas shared client/server
```

**Database changes.** None. RPC scaffolding for §16.3's five transactional operations is written
in the phase that owns each one.

**Tests (unit, §19.1).**
- Money: paise↔rupee round-trips, `₹4,20,000` formatting, zero, large values, negative rejected.
- Phone: `+91`, `0`, `91`, spaces, dashes, brackets, too-short, non-numeric — and **parity with
  the SQL `normalize_phone`** over the same fixture table.
- Transition matrix: **every** valid and invalid pair from §9.2, exhaustively (81 combinations).
- Dates: overdue/due-today across the IST↔UTC boundary (B-10), month boundaries, DST-free but
  offset-sensitive cases.
- Error mapping: every constraint name in §5.7 maps to a friendly message; an unmapped Postgres
  error becomes `INTERNAL` and never leaks its text (§23.8).

**Acceptance criteria.** No business rule exists in a component. No `system_settings` value is
read anywhere but through `settings.service.ts`. No hard-coded threshold anywhere (§24).
Every service throws `AppError`, never a raw Postgres error.

**Risks.** Drift between `lib/phone.ts` and the SQL `normalize_phone` — the parity test is the
control. M-23 — lowercase stage literals; use generated enum types, never string literals.

---

# Phase 7 — Shared UI and design system

**Spec phase:** 1 Foundation · **Spec sections:** §12.1, §12.3, §12.5, §12.6, §12.7, §2.4

**Objective.** The AppShell, navigation, and the §12.5 component inventory — built once, before
any feature screen, so no feature invents its own card, badge or empty state.

**Dependencies.** Phase 1 (Phase 6 for `MoneyText`).

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

**Risks.** M-03 — the Forbidden component's copy contradicts the not-found requirement in §23.1;
decide before building it. Scope creep into a component library beyond the §12.5 inventory.

---

# Phase 8 — Accounts / customers

**Spec phase:** 2 Identity · **Spec sections:** §5.3, §8.1, §8.4, §8.9, §11.1, §12.4, §23.1

**Objective.** Account CRUD, the Customer 360 screen, and the primary mobile create flow —
customer + opportunity + activity in one transaction, under 60 seconds.

**Dependencies.** Phases 5, 6, 7. Phase 11's opportunity insert is needed by §11.1's transaction;
build the RPC here and the opportunity UI in Phase 11.

**Files/modules.** `src/services/account.service.ts`, `src/features/accounts/*`,
`src/app/(app)/accounts/{page,new/page,[id]/page,[id]/edit/page}.tsx`, Server Actions.

**Database changes.** RPC `create_account_with_opportunity` (`SECURITY INVOKER`, §16.3) inserting
account → opportunity → activity, with the trigger writing `CREATED`.

**Tests.** Unit: title auto-generation (§8.4), defaults. Integration: the RPC is atomic — a
failure at the activity insert leaves no account; RLS negative cases from Phase 5 re-run for
accounts. E2E: §19.3 scenarios 1 and 15 (the 375×812 flow under 60 seconds).

**Acceptance criteria.** §23.1, all ten bullets — with **M-16 corrected**: a salesperson sees
their own accounts *plus* accounts where they own an opportunity. Customer 360 shows next action,
Won Value, Pipeline Value, last contact and **exactly three** recent activities (§12.4). Address,
GSTIN, source and audit fields live in the Details tab, not above the fold.

**Risks.** M-05 — no database constraint enforces "phone or email" on accounts; the rule is
service-layer only. M-04 — §11.1 marks next action required, contradicting §8.3. The 60-second
target is a real constraint: 6–7 fields maximum (§12.1).

---

# Phase 9 — Contacts

**Spec phase:** 2 Identity · **Spec sections:** §5.4, §4.4, §11.4, §23.2

**Objective.** Contacts as *additional* people — never forced, attachable to an account or
standalone, with `linked_account_id` for a contact who is also a customer.

**Dependencies.** Phase 8.

**Files/modules.** `src/services/contact.service.ts`, `src/features/contacts/*`,
`src/app/(app)/contacts/{page,[id]/page}.tsx` (plus `/contacts/new` — **M-11**).

**Database changes.** None (006 applied). The `referred_by_contact_id` FK from 007 becomes usable.

**Tests.** Integration: `contact_reachable` rejects neither-phone-nor-email; RLS — a salesperson
reads contacts of an account they can see (H-12). E2E: standalone architect contact; contact
linked to an account that is also a customer.

**Acceptance criteria.** §23.2, all four bullets. **A homeowner account works with no contact
record** — the UI must never force contact creation (§5.4).

**Risks.** H-12 — the contacts SELECT policy needs `can_see_account()`, which §15.1 does not
define. M-11 — no `/contacts/new` route in §12.2.

---

# Phase 10 — Projects and project stakeholders

**Spec phase:** 3 Projects · **Spec sections:** §5.5, §5.6, §4.4, §11.2, §11.4, §23.3

**Objective.** Projects under an account, and the multi-stakeholder model working end to end —
including the §4.4 worked example with three stakeholders and three opportunities on one project.

**Dependencies.** Phase 9. **Blocked on B-08** (`removeProjectStakeholder` has no legal
implementation).

**Files/modules.** `src/services/project.service.ts`, `src/features/projects/*`,
`src/app/(app)/projects/{page,new/page,[id]/page}.tsx`, `StakeholderChips` wiring.

**Database changes.** None (008, 009 applied), unless B-08 is resolved by adding
`archived_at`/`archived_by` to `project_stakeholders` — which would also require rewriting the
three partial unique indexes to include `and archived_at is null`.

**Tests.** Integration: second primary stakeholder rejected by the partial unique index and
mapped to a friendly message (§11.2); a stakeholder referencing a contact, an account, and both;
`setPrimaryStakeholder` as two statements in one transaction (**M-09**). E2E: §19.3 scenarios 2
and 3; §23.3's "project detail lists **multiple** opportunities" — verify visually, it is the
model's key behaviour (§11.3).

**Acceptance criteria.** §23.3, all six bullets. The UI says **"People on this project"**, never
"stakeholders" (§11.4). Filters by construction stage and city work.

**Risks.** B-08 blocks the remove operation entirely. M-09 — the non-deferrable unique index will
bite a single-statement update. §5.5's "Do not add fields not listed" is easy to violate here.

---

# Phase 11 — Opportunities and pipeline

**Spec phase:** 4 Sales · **Spec sections:** §5.7, §5.9, §8.5–§8.7, §9 (all), §11.3, §11.7–§11.9, §23.4

**Objective.** The central table working: creation from account and from project, the stage
transition matrix, won/lost, reopen, assignment/reassignment, the audit trail, and the desktop
kanban.

**Dependencies.** Phases 8, 10. **Blocked on B-01, B-02, B-03, H-10, H-11, M-24.**

**Files/modules.** `src/services/opportunity.service.ts`, `src/lib/opportunity/transitions.ts`
(from Phase 6), `src/features/opportunities/*`,
`src/app/(app)/opportunities/{page,board/page,[id]/page}.tsx`, stage/won/lost/reassign modals.

**Database changes.** RPC `change_opportunity_stage` (§16.3); RPC `reassign_opportunity`
(`SECURITY DEFINER`, B-02); RPC `bulk_reassign`; the reason-passing mechanism for
`opportunity_events` (B-01).

**Tests.**
- Unit: the full transition matrix (already in Phase 6) wired into `changeOpportunityStage`.
- Integration: entering `quoted` without quotation fields rejected **by the database**; `won`
  requires `final_order_value`; `lost` requires `lost_reason`; `nurture` requires a date; every
  stage and owner change writes an `opportunity_events` row; backward transition stores its
  reason (B-01); a salesperson cannot change `owner_id` through the RPC.
- E2E: §19.3 scenarios 4, 7, 8, 9, 10, 11, 12.

**Acceptance criteria.** §23.4, all ten bullets. `project_id` stays **optional** (§8.5,
TODO-BD-01). Winning sets `accounts.status = 'ACTIVE'`, clears next action, and **prompts —
never auto-creates** — a follow-on opportunity (§9.3, §11.8). Nurture is excluded from Pipeline
Value everywhere. **There is no `follow_up` stage and there must never be one** (§9.1).

**Risks.** B-01 blocks reason capture — the audit trail is incomplete without it. H-10 makes a
matrix-legal transition constraint-illegal. H-11 leaves reopen semantics undefined, including
stale `final_order_value` leaking into Won Value. M-23 — lowercase enum literals.

---

# Phase 12 — Activities and next actions

**Spec phase:** 5 Accountability · **Spec sections:** §5.8, §8.3, §8.10, §10 (all), §11.5, §11.6, §13.2, §23.5

**Objective.** The three-tap activity sheet, the append-only timeline with a 24-hour author edit
window, next-action management, and `/today`.

**Dependencies.** Phase 11. **Blocked on B-10** (every `/today` tile is a date computation) and
**M-15** (`/today` must filter by owner, not rely on RLS).

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
- E2E: §19.3 scenarios 5 and 6.

**Acceptance criteria.** §23.5, all seven bullets. Three taps from an opportunity to a logged
activity. Site visit exposes measurements, location and photo upload (Phase 17 supplies upload).
Overdue renders red with "Overdue by N days". **Logging is never hard-blocked for a missing next
action** — the Missing Next Action list is the control (§8.3, §25.3).

**Risks.** B-10 — off-by-one-day on every tile for 5.5 hours daily. M-15 — a manager's `/today`
would show the whole company. M-07 — `v_opportunity_flags` booleans are NULL, not false, when
`next_action_date is null`.

---

# Phase 13 — Search and duplicate detection

**Spec phase:** 2 Identity · **Spec sections:** §8.9, §11.10, §5.3, §5.4, §12.2, §23.1

**Objective.** Permission-scoped global search in the §11.10 order, and advisory duplicate
detection that warns and never blocks.

**Dependencies.** Phases 8, 9. Trigram indexes from Phase 3.

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

**Dependencies.** Phases 11, 12. **Blocked on B-10, M-10, M-15, M-18.**

**Files/modules.** `src/services/dashboard.service.ts` (one exported function per §13.1 metric),
`src/features/dashboard/*`, `src/app/(app)/{dashboard,team,team/[userId],reports}/page.tsx`,
Recharts wrappers.

**Database changes.** Reporting RPCs/views as needed for grouped aggregates, all
`security_invoker`. No stored derived values (§5.7).

**Tests.** Unit: **every** §13.1 metric against fixture arrays — Pipeline Value excludes nurture,
won and lost and archived; Weighted Pipeline uses `system_settings.stage_probabilities`, never a
literal; **Win Rate returns null (displayed `—`) when the denominator is 0**. Integration:
salesperson sees only their own data in every tile; every manager exception tile links to a list
filtered identically to the tile's own query. Performance: tiles under 400 ms at 20,000
opportunities (§23.6 — **M-18**, the fixture does not exist yet).

**Acceptance criteria.** §23.6, all seven bullets. Pipeline Value equals a manual sum.
**The word "revenue" appears nowhere** (§2.4). The owner dashboard contains **no more** than the
§13.4 blocks — "Deliberately small. Do not add tiles." Salespeople never see team totals, win
rate or leaderboards (§13.2).

**Risks.** M-19 — this is where RLS subquery cost meets the 400 ms gate. M-18 — no perf fixture
specified. M-10 — `dormancy_days` means two different things. Tile scope creep beyond §13.4.

---

# Phase 15 — Import workflow

**Spec phase:** 7 Data · **Spec sections:** §20 (all), §5.11, §11.11, §23.7

**Objective.** The seven-step import wizard for accounts and contacts, with per-row duplicate
decisions, notification suppression, and 7-day rollback.

**Dependencies.** Phases 8, 9, 13. **Blocked on H-08** (atomicity vs progress) and **H-09**
(nightly job defeats rollback).

**Files/modules.** `src/services/import.service.ts`, `src/features/import/*`,
`src/app/(app)/import/*`, CSV templates, `src/app/api/import/*` (service-role executor).

**Database changes.** `execute_import` as a database function (§20.5), plus whatever H-08's
resolution requires.

**Tests.** Unit: every §20.3 validation rule, including case/space/underscore-tolerant enum
parsing and the in-file duplicate ERROR. Integration: rows in `DUPLICATE_*` with no decision
**block execution**; `LINK_EXISTING` writes `legacy_ref` on the existing record and **never
overwrites its fields**; every created row carries `is_imported`, `import_batch_id`, `legacy_ref`;
rollback archives (never deletes) and refuses when a record was edited. E2E: §19.3 scenario 14.

**Acceptance criteria.** §23.7 bullets 1–5. **Import fires no notifications** — §25 names this as
the failure that permanently destroys trust in alerts. OWNER and ADMIN only; 5 MB / 5,000 rows.
Projects and opportunities templates are **designed but not built** (§20.2, TODO-BD-10).

**Risks.** H-08 — the specified transaction model and progress reporting cannot both hold, and
5,000 rows may exceed the serverless timeout. H-09 — the nightly maintenance job can silently
disqualify rollback. Notification suppression must survive the cron path, not just the request.

---

# Phase 16 — Archive and merge

**Spec phase:** 7 Data · **Spec sections:** §8.8, §8.9, §16.1, §12.2, §23.1, §23.7

**Objective.** Archive/restore across all archivable entities with a preview of what will be
archived, the `/archive` screen, and manual account merge.

**Dependencies.** Phases 8–12. **Blocked on H-02** (merge reversibility is not implementable) and
**M-06** (does archiving an account archive its children?).

**Files/modules.** Archive/restore in each `*.service.ts`, `mergeAccounts` in
`account.service.ts`, `src/app/(app)/archive/page.tsx`, merge preview UI.

**Database changes.** Whatever H-02's resolution requires. No new table without approval (§4.1).

**Tests.** Integration: archived records disappear from active lists, dashboards and pipeline
value; remain readable and searchable for MANAGER/OWNER/ADMIN; restore returns them with all
relationships and activities intact; **no role can DELETE**. Merge preserves every activity and
is recorded in the audit trail (§23.7 — blocked by H-02).

**Acceptance criteria.** §23.1 bullet 6, §23.7 bullet 6. Archiving an account **reports what it
will archive before doing so** (§8.8).

**Risks.** H-02 — "always reversible via the audit trail" has no implementation with eleven
tables. M-06 — the cascade rule contradicts itself. Merge is the single most destructive
operation in the system and it is manual, previewed and MANAGER/OWNER-only for that reason.

---

# Phase 17 — Storage and quotation files

**Spec phase:** 7 Data / 8 Security · **Spec sections:** §15.6, §17.5, §8.6, §11.5, §19.4

**Objective.** The private `crm-files` bucket, path-prefix-based access policies, signed URLs, and
uploads attached to activities and opportunities.

**Dependencies.** Phases 11, 12. **Blocked on B-09** (client-side upload carve-out) and
**M-14** (magic-byte verification).

**Files/modules.** `supabase/migrations/016_storage.sql`, `src/services/storage.service.ts`,
upload components in `features/activities` and `features/opportunities`.

**Database changes.** Bucket `crm-files` (private). Storage policies calling the H-12 visibility
helpers, keyed off the `{entity_type}/{entity_id}/` path prefix.

**Tests.** Integration: a user without visibility of the parent entity cannot read the object
(§19.4); a signed URL expires after 60 seconds; a disguised executable is rejected by magic-byte
check, not by extension; >10 MB rejected. E2E: site-visit photo upload; **upload failure does not
block the activity** (§11.5).

**Acceptance criteria.** §23.8 bullet 6. No public URLs anywhere. Path convention exactly
`crm-files/{account|project|opportunity|activity}/{id}/{uuid}-{filename}`.

**Risks.** B-09 — 10 MB exceeds the platform request-body limit, so the browser must upload
directly against a signed upload URL; this is an explicit exception to "no client-side Supabase
writes" and needs approval. H-12 — Storage policies need visibility helpers that do not exist.

---

# Phase 18 — Cron jobs and email

**Spec phase:** 9 Launch · **Spec sections:** §14 (all), §16.4, §17.4, §21

**Objective.** Five cron routes with bearer-token auth and a service-role client, and the
`NotificationService` Resend implementation — nothing else automated (§14.8).

**Dependencies.** Phases 12, 14. **Blocked on B-03, B-05, H-09, M-26, M-27.**

**Files/modules.** `src/app/api/cron/{new-opportunity-sla,daily-digest,manager-digest,
owner-summary,maintenance}/route.ts`, `src/services/integrations/{types.ts,notification.ts,
whatsapp.ts}`, `vercel.json`.

**Database changes.** Whatever B-05's dedup-state resolution requires.

**Tests.** Integration: each route rejects a missing or wrong `CRON_SECRET`; the daily digest
skips users with all three lists empty and **never sends a group email**; per-user failure is
logged and the loop continues (§14.3); the SLA reminder does not re-send (B-05); nightly
maintenance logs every `last_activity_at` correction it makes — **do not suppress that log**
(§14.6). Unit: IST→UTC cron expression conversion (M-27).

**Acceptance criteria.** All seven §14 automations behave exactly as specified, including failure
behaviour. Every route returns `{ processed, sent, failed, durationMs }`. Routes excluded from the
sitemap. `AccountingIntegration` and `InventoryIntegration` remain **type declarations with no
implementation and no stub** (§16.4).

**Risks.** B-05 — without dedup state the SLA email re-sends hourly forever. H-09 — the
maintenance job interferes with import rollback. M-26 — a settings-driven schedule cannot drive a
static Vercel cron; use an hourly trigger with an in-route gate. M-27 — hourly cron needs a Pro
plan; all times are UTC. Resend requires a verified sender domain (M-28).

---

# Phase 19 — Complete testing

**Spec phase:** 8 Security & QA · **Spec sections:** §19 (all), §23.8

**Objective.** The full suite green: unit, integration/RLS, the fifteen E2E scenarios, and the
security suite — as an adversarial audit of everything built, not a first pass.

**Dependencies.** Phases 1–18. **Blocked on M-18, M-20.**

**Files/modules.** `/tests/unit`, `/tests/integration`, `/tests/e2e`, CI workflow, seeded role
fixtures, a 20,000-opportunity performance fixture.

**Database changes.** Test seed and reset tooling only.

**Tests.** Everything in §19.1–§19.4. The security suite specifically:
direct PostgREST calls with salesperson credentials attempting cross-user reads · role escalation
via profile update · **service-role key absent from the built client bundle, verified by grepping
the build output** · Storage object access without entity visibility · unauthenticated access to
every route · session expiry · disguised-executable upload · SQL injection through search.

**Acceptance criteria.** §23.8, all seven bullets. **All fifteen E2E scenarios pass**, including
scenario 13 — a salesperson cannot reach another's opportunity "via direct URL **or via a direct
Supabase query from the browser console**". Every security test attacks the **API, not the UI**:
"a hidden button is never a control" (§19.4). No failing test is skipped or deleted (§22.1).

**Risks.** M-20 — CI needs Docker for local Supabase; this is the most important suite in the
project and it must run on every commit, not locally-only. M-18 — the performance gate needs a
fixture that does not exist. E2E flakiness against seeded state; reset per spec file.

---

# Phase 20 — Production hardening

**Spec phase:** 9 Launch · **Spec sections:** §15.7, §15.8, §12.6, §12.8, §17.4, §23.8, §23.9

**Objective.** Security headers, error handling that never leaks, performance against the §12.8
budgets, and the launch checklist closed.

**Dependencies.** Phase 19.

**Files/modules.** `next.config.ts` (CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`),
`src/app/error.tsx`, `src/app/not-found.tsx`, logging configuration, pagination audit.

**Database changes.** Index review against real query plans; migration `015` hardening pass.

**Tests.** Security headers present on every response. **No database error text ever reaches the
user** (§23.8). No unbounded list query anywhere — every list paginates 25 mobile / 50 desktop
(§12.8). `/today` interactive under 1.5 s on 4G; any list query under 400 ms server-side. Logs
never contain tokens, keys, or full request bodies with personal data (§15.8).

**Acceptance criteria.** §23.9 bullets 5–7: all nine `/docs` files reflect the built system;
`npm run build` passes with zero TypeScript and lint errors; the mobile create-customer flow
completes in under 60 seconds **on a real Android device**.

**Risks.** CSP versus Next.js inline scripts and Recharts — budget time for nonce configuration.
M-19 — RLS performance is the likeliest cause of missing the latency gates.

---

# Phase 21 — Deployment

**Spec phase:** 9 Launch · **Spec sections:** §21 (all), §23.9, TODO-BD-06, TODO-BD-08

**Objective.** Staging and production live on Vercel + Supabase, the deploy sequence exercised,
backups verified by an actual tested restore, and the pilot started.

**Dependencies.** Phase 20. **Blocked on TODO-BD-06** (`system_settings.cities` must be populated
before go-live) and **TODO-BD-08** (region — decided at provisioning, irreversible).
**M-21** (independent `pg_dump`) has no specified destination.

**Files/modules.** CI/CD workflow, `vercel.json`, `/docs/DEPLOYMENT.md` final, runbook.

**Database changes.** `017_seed` (OWNER user + settings; **dev fixtures never run in production**).
Migrations applied to staging, verified, then production (§21.3).

**Tests.** Full suite in CI. Smoke tests after each deploy. **A restore from backup performed at
least once before go-live** (§21.4) — documented, with the date and the person who ran it.

**Acceptance criteria.** §23.9, all seven bullets. Development never connects to production
(§21.1). The production service-role key exists only in Vercel's production environment. The
deploy sequence is exactly §21.3: *test → migrate staging → verify → deploy staging → smoke →
migrate production → deploy production → smoke*.

**Risks.** TODO-BD-08 is irreversible after provisioning. M-21 — the independent backup needs
infrastructure outside the stack, and §21.4 requires the business to be able to recover **without
vendor cooperation**. M-27 — Vercel plan limits for cron. First production migration is the
highest-risk single action in the project.

---

## Cross-phase standing risks

| Risk | Phases | Mitigation |
|---|---|---|
| RLS recursion on `users` (§25) | 5 | `SECURITY DEFINER` helpers only; never select `public.users` in a `public.users` policy |
| View bypassing RLS (§25) | 3, 14 | `security_invoker = true` asserted by an integration test |
| RLS performance at scale (M-19) | 5, 14, 20 | `(select fn())` InitPlan wrapping; measure in Phase 5, not Phase 20 |
| Timezone correctness (B-10) | 3, 12, 14, 18 | IST business-day helper in SQL **and** TS; boundary tests |
| `TODO-BD` values leaking into code (§24) | all | `settings.service.ts` is the only reader; grep for literals in review |
| Scope creep beyond V1 (§2.3) | all | §4.2 rejected tables and §17.1 rejected infrastructure are closed lists |
| Import destroying alert trust (§25) | 15, 18 | Notification suppression tested on the cron path, not just the request path |
| Migration edited after apply (§21.2) | 3, 21 | Migrations append-only once applied to any shared environment |
