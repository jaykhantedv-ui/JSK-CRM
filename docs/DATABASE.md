# Database

PostgreSQL 15+ on Supabase, region **Mumbai `ap-south-1`** (TODO-BD-08).
Authoritative schema: `CLAUDE_CODE_BUILD_SPEC.md` §5, §6. This document is a working reference —
**§5 wins any disagreement, except where an approved deviation is recorded below.**

**Status: built and verified.** All seventeen migrations apply cleanly from an empty database,
twice in a row, and are exercised by 154 integration tests against a real PostgreSQL 16 server
(ADR-018). `src/types/database.types.ts` is generated from that verified database.

**Approved corrections and deviations applied to this schema:** 2026-08-19, Project Owner.
Full reasoning in `/docs/SPEC_AUDIT.md`; ADRs in `/docs/DECISIONS.md` §B.

---

## Conventions (§5.0)

- Extensions: `pgcrypto`, `pg_trgm`.
- Business tables: `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not
  null default now()`, `updated_at timestamptz not null default now()`, `created_by uuid
  references public.users(id)`.
- Archivable tables add `archived_at timestamptz`, `archived_by uuid references public.users(id)`.
- **Nothing is ever hard-deleted**, with exactly one approved exception (`project_stakeholders`,
  ADR-004). Every read query filters `archived_at is null` unless it is explicitly the archive view.
- `updated_at` is maintained by the `touch_updated_at()` trigger.
- **Money is `bigint` paise** — never float, never rupees in the database.
- All timestamps are `timestamptz`, stored UTC. **All business-day logic converts to
  Asia/Kolkata explicitly** (B-10).
- `created_at` defaults to `now()` — **except on `opportunity_events`, which uses
  `clock_timestamp()`** so events written in one transaction stay orderable (ADR-019).

> **M-08 resolved.** §5.0's "every table has …" is not literally true of the DDL —
> `system_settings` has a `text` primary key and no `created_at`/`created_by`;
> `project_stakeholders` and `opportunity_events` have no `updated_at`; `import_rows` has no
> `updated_at`/`created_by`. **The per-table DDL in §5 is authoritative**; §5.0's sentence is
> descriptive, not normative.

---

## The thirteen tables (§4.1 + ADR-016)

| Table | Archivable | Deletable | Purpose |
|---|---|---|---|
| `users` | no (`is_active`) | **no** | Internal application users; mirrors Supabase `auth.users` |
| `outlets` | no (`is_active`) | **no** | **ADR-016.** A branch/showroom. Rows, not a text column |
| `user_outlets` | no (`revoked_at`) | **no** | **ADR-016.** A user's outlet scope — zero, one or many |
| `accounts` | **yes** | **no** | The permanent customer relationship (individual or firm) |
| `contacts` | **yes** | **no** | People — attached to an account, or independent |
| `projects` | **yes** | **no** | A physical site |
| `project_stakeholders` | no | **YES — ADR-004** | Many-to-many: who is involved in a project, in which role |
| `opportunities` | **yes** | **no** | One specific potential sale — the central table |
| `activities` | no (append-only) | **no** | Record of what happened |
| `opportunity_events` | no (append-only) | **no** | Audit history: stage, owner, won/lost |
| `system_settings` | no | **no** | Controlled values changeable without a deploy |
| `import_batches` | no | **no** | One row per CSV import run |
| `import_rows` | no | **no** | Staged rows with validation and duplicate analysis |

**Thirteen tables.** The spec's model is eleven; **ADR-016 adds `outlets` and `user_outlets`**,
approved before the migration was written, because `branch text not null default 'MAIN'` cannot
give an outlet an identity, an assignment or a deactivation — and the business needs all three
(two outlets now, five to ten expected; managers holding zero, one or several).

Both additions are **organizational structure, not CRM business records**: no money, no pipeline
stage, no ownership. §4.2's rejected tables stay rejected, and ADR-008's refusal of a merge-history
table stands. Adding a fourteenth still requires approval recorded in `/docs/DECISIONS.md` before
the migration is written.

### `branch` is retired (ADR-016, supersedes TODO-BD-12)

`users.branch`, `accounts.branch`, `projects.branch` and `opportunities.branch` **do not exist**.
On `users` the replacement is the `user_outlets` link; on the three business tables it is
`outlet_id uuid not null references public.outlets(id)`.

Two competing notions of "which shop is this?" were explicitly ruled out, so nothing in the schema
or the code may reintroduce `branch`.

### The one delete exception — ADR-004 (B-08 resolved)

`project_stakeholders` carries **the only `DELETE` policy in the schema**, scoped identically to
its `UPDATE` policy. The row is a **relationship/link**, not a business entity: no history, no
ownership, no money. `removeProjectStakeholder()` deletes it.

**No `archived_at` column is added**, so §5.6's three partial unique indexes stay exactly as
specified. A reviewer should be able to grep for `for delete` and find exactly one policy.
`tests/integration/no-hard-delete.test.ts` asserts DELETE fails on **all twelve other tables, for
every role**, and that `authenticated` holds the DELETE privilege on nothing else.

Moving a user between outlets therefore sets `user_outlets.revoked_at` rather than deleting the
row: it keeps the no-hard-delete rule intact, keeps this the only DELETE policy, and leaves an
auditable record of when somebody's scope changed.

---

## Enums (§5.1)

All enum types exactly as §5.1 defines them.

> ⚠ **M-23 resolved — preserve exactly.** `opportunity_stage` values are **lowercase**
> (`'new'`, `'qualified'`, `'selection'`, `'quoted'`, `'negotiation'`, `'verbal_confirmation'`,
> `'won'`, `'lost'`, `'nurture'`) while **every other enum is UPPERCASE**. A `'WON'` typo fails at
> runtime, not compile time. **Always use the generated enum types; never handwritten string
> literals.**

Enums are structural — code branches on them, and adding a value requires a migration. Values the
business extends (cities, areas, material types) live in `system_settings` (§7.3).

---

## Constraints that carry business rules (§5.7)

**The database enforces the business rules.** A bug in the service layer cannot produce a won
opportunity with no value. **Never relax one of these to make code easier** (`CLAUDE.md` §5).
Exactly one was narrowed, and only because it contradicted the transition matrix.

| Constraint | Table | Rule |
|---|---|---|
| `won_requires_value` | opportunities | `stage <> 'won' or final_order_value is not null` |
| `won_requires_closed` | opportunities | `stage <> 'won' or closed_at is not null` |
| `lost_requires_reason` | opportunities | `stage <> 'lost' or lost_reason is not null` |
| `lost_requires_closed` | opportunities | `stage <> 'lost' or closed_at is not null` |
| **`quoted_requires_quotation`** | opportunities | **`stage <> 'quoted' or (quotation_ref, quoted_value, quotation_date all not null)` — narrowed, ADR-006** |
| `next_action_pairing` | opportunities | both next-action fields set, or both null |
| `nurture_needs_date` | opportunities | `stage <> 'nurture' or next_action_date is not null` |
| `contact_reachable` | contacts | phone or email must be present |
| **`account_reachable`** | **accounts** | **phone or email must be present — ADR-013, new** |
| `stakeholder_target` | project_stakeholders | `contact_id` or `account_id` must be present |
| `one_primary_per_project` | project_stakeholders | partial unique index — at most one primary per project |

### ADR-006 — `quoted_requires_quotation` narrowed to `quoted`

**H-10 resolved.** §9.2 permits `selection → negotiation` with no entry requirement, but the
original constraint covered `('quoted','negotiation','verbal_confirmation')` and rejected it.
**Salespeople must not be forced to invent quotation data merely to enter negotiation** —
fabricated quotation references are worse than a missing one, the same reasoning §25.3 applies to
fabricated next-action dates. §8.6's "entering `quoted` requires quotation fields" is preserved
exactly, and §9.3's side-effects table already listed the requirement under `quoted` alone.

> ✅ **Confirmed 2026-08-19.** Quotation fields are required **only when entering `quoted`**.
> They are **not** required for `negotiation` **or `verbal_confirmation`**. The constraint is:
>
> ```sql
> constraint quoted_requires_quotation check (
>   stage <> 'quoted'
>   or (quotation_ref is not null and quoted_value is not null and quotation_date is not null))
> ```
>
> An **integration regression test must prove `selection → negotiation` succeeds with no quotation
> information.** This unblocks migration 010.

Also enforced by index: at most one stakeholder row per `(project, contact)` and per
`(project, account)` where no contact is set.

### ADR-013 — `accounts` gains `account_reachable` (M-05 resolved)

`accounts` had no database-level "phone or email required" constraint, though §11.1 and §20.3 both
require one and `contacts` already enforced it. **Add it:**

```sql
constraint account_reachable check (phone is not null or email is not null)
```

**An account must have at least one contact method.** Service and UI validation still supply the
friendly message, but **database integrity is authoritative** — §5.7's principle now holds for the
most important table in the system, not just for `contacts`.

It goes in `005_accounts.sql`, not a later patch, because migrations are append-only once applied
(§21.2). `account_reachable` joins the constraint-name → message map in `lib/errors.ts`:
*"Add a phone number or an email for this customer."* A consequence worth stating: a historical
paper record with neither a phone nor an email **cannot be imported as an account**, which is the
intended behaviour — such a record answers none of §1.2's five questions.

---

## Columns changed beyond §5

Each under an approved ADR. Nothing else is added: §5.5's "Do not add fields not listed" holds
everywhere else, and §17.6's future-proofing list is closed.

| Column | Table | Source | Why |
|---|---|---|---|
| `sla_notified_at timestamptz` | `opportunities` | **ADR-002** (B-05) | The §14.2 SLA reminder must fire once per opportunity, and the "event metadata" key it names cannot exist: §4.2 rejects a notifications table, the event enum has no notification value, and event rows cannot be updated. Without state the reminder re-sends **every hour, forever**. Null = not yet notified. **Not user-writable through any policy.** |
| `outlet_id uuid not null` | `accounts`, `projects`, `opportunities` | **ADR-016** | Replaces `branch text`. `not null` on purpose: a record belonging to no outlet would be invisible to every manager, which is the accountability gap the CRM exists to close. |
| *(removed)* `branch text` | `users`, `accounts`, `projects`, `opportunities` | **ADR-016** | Free text cannot carry identity, assignment or deactivation. |

One **constraint** is added beyond §5 — `account_reachable` (ADR-013) — and two **settings keys**,
the ADR-014 maintenance counters.

**No length checks were added.** §5 specifies exactly two — `accounts.name >= 2` and
`activities.summary >= 3` — and only those two exist. A first pass added them to `users.full_name`,
`contacts.full_name`, `projects.name` and `opportunities.title`; they were removed, because a
constraint the spec did not ask for is scope the spec did not ask for.

---

## Functions and triggers

| Object | Purpose | Approved resolution |
|---|---|---|
| `normalize_phone(text)` | Strips spaces, dashes, brackets, leading `+91`/`91`/`0`; returns the trailing 10 digits, or null if fewer than 10 remain | **Declared `IMMUTABLE` and genuinely deterministic** — regex/`translate` only, no locale- or configuration-dependent calls. Required by the generated columns (B-06). |
| `touch_updated_at()` | Sets `new.updated_at = now()` | Attached to every table with the column |
| `system_user_id()` | The fixed uuid of the automated-write actor | `IMMUTABLE`. Exists so the uuid appears in SQL once and never as a constant in application code (ADR-003). |
| `log_opportunity_event()` | Writes `opportunity_events` on insert, stage change, owner change and archive/restore | `SECURITY DEFINER`. **Reads `app.event_reason`** for the reason (ADR-001). **Resolves the actor as `coalesce(auth.uid(), new.created_by, system_user_id())`** (ADR-003). Emits `REOPENED` for `won → qualified` (ADR-007) and `ARCHIVED`/`RESTORED` (M-24). The single writer, so no path bypasses the audit. |
| `current_user_id()` | The caller's id, **only while `is_active`** | `SECURITY DEFINER`. Every ownership test in every policy goes through this rather than `auth.uid()`, so deactivation takes effect at the database boundary instead of when the JWT expires up to an hour later. |
| `user_role()`, `is_owner()`, `is_owner_or_admin()`, `is_manager_or_above()` | Role resolution inside RLS without recursion | `SECURITY DEFINER`, `stable`, `set search_path = ''`. **`is_manager_or_above() = MANAGER, OWNER` — ADMIN excluded** (ADR-017, which subsumes H-05: with ADMIN out, a separate `can_reassign()` would be a redundant alias). |
| `manages_outlet(uuid)`, `manages_user(uuid)` | Outlet scope (ADR-016) | OWNER is true for every outlet **by role**, deliberately not by membership — enumerating outlets for the owner would silently narrow their access the day an outlet is added. A MANAGER with an empty scope manages nothing. |
| `owns_opportunity_on_account/project(uuid)`, `can_read_account/project/opportunity(uuid)`, `can_write_project(uuid)` | Work-context and parent-entity visibility | `SECURITY DEFINER` so they do not re-enter the policies they support (H-12). Created **after** the tables they reference (B-04). They mirror the SELECT policies exactly; changing one without the other is a defect. |
| `guard_record_scope()` | Refuses an outlet move or an archive by somebody not entitled to it | `BEFORE UPDATE` on `accounts`, `projects`, `opportunities`. A trigger rather than a `WITH CHECK`, because the rule compares OLD to NEW and a policy subquerying its own table would recurse. Returns early when `auth.uid()` is null, so service-role callers — which already bypass RLS — are not blocked. |
| `reassign_opportunity(...)` | Ownership change | **Not yet written** — it arrives with the reassignment feature. Reassignment is already *denied* to a salesperson by the `opportunities` UPDATE policy, whose `WITH CHECK` the row fails once `owner_id` is somebody else. **The §15.5 fallback `with check` is invalid SQL and recursive and must never be written** (B-02). |

Generated columns: `accounts.phone_normalized`, `accounts.email_normalized`,
`contacts.phone_normalized` — `generated always as (…) stored`.

### ADR-001 — how the event reason is written

The service sets a **transaction-local GUC** before the write —
`set_config('app.event_reason', <reason>, true)` — and the trigger reads it. `true` scopes the
setting to the transaction so it cannot leak across a pooled connection. The trigger must ignore a
stale value when no reason was set.

This preserves `opportunity_events` as append-only for everyone: **no INSERT policy, no UPDATE
policy, no DELETE policy**, and the trigger remains the single writer. It is also how
`ARCHIVED`, `RESTORED` and `REOPENED` events get written (M-24) — enum values that previously had
no writer at all.

### ADR-003 — the system user

One dedicated row in `public.users`, seeded with a fixed uuid, is the `actor_id` for service-role
automated writes (cron, import). It is seeded **`is_active = false`** so `user_role()` returns null
and it can never authenticate or pass a policy, and it is **excluded from `/team`, workload
reporting, user lists and every digest**.

Without it, `actor_id not null` aborts every automated write that touches `stage` or `owner_id`,
because service-role clients have no `auth.uid()`.

---

## The flags view (§10.3)

`v_opportunity_flags` computes `is_active`, `in_pipeline`, `is_overdue`, `is_due_today`,
`is_missing_next_action`, `is_unassigned`, `days_in_stage`, `days_since_activity` from
`opportunities where archived_at is null`.

> **Must be created with `security_invoker = true`. Set that option explicitly.** A default view
> silently bypasses row-level security and leaks every salesperson's pipeline to every other
> salesperson (§10.3, §25). Asserted by an integration test against `pg_class.reloptions`.

Two approved corrections to the spec's view SQL:

- **B-10 — timezone.** The spec's view uses bare `current_date` and `::date`, which evaluate in the
  database session timezone (UTC on Supabase). Between 00:00 and 05:30 IST every date-derived flag
  is a day stale. **Use `(now() at time zone 'Asia/Kolkata')::date` and
  `(ts at time zone 'Asia/Kolkata')::date`.** Bare `current_date` must not appear in business-day
  logic anywhere. `TZ=Asia/Kolkata` sets the **Node** timezone and does not affect Postgres.
- **M-07 — three-valued logic.** `is_overdue` and `is_due_today` are `true and null → NULL`, not
  false, when `next_action_date is null`. **Wrap in `coalesce(…, false)`** so a missing next action
  reads as *not overdue* rather than unknown, and `count(*) filter (where not is_overdue)` cannot
  silently under-count.

Dormancy and stall thresholds come from `system_settings` and are applied in the query layer, not
baked into the view.

**Derived values are computed in queries, never stored**: `is_overdue`, `days_in_stage`,
`weighted_value` (`estimated_value × stage_probability ÷ 100`), `is_dormant` (§5.7).

---

## `system_settings` seed — approved values

| Key | Seeded value | Decision |
|---|---|---|
| `cities` | **The ten Erode District revenue taluks** (below) | **TODO-BD-06 — final** |
| `stage_probabilities` | `{"new":10,"qualified":25,"selection":40,"quoted":60,"negotiation":75,"verbal_confirmation":90,"nurture":5,"won":100,"lost":0}` | — |
| `high_value_threshold_paise` | **`30000000`** (₹3,00,000) | **TODO-BD-02 — changed from the ₹2,00,000 placeholder** |
| **`account_dormancy_days`** | `30` | **TODO-BD-03 / ADR-010 — new key** |
| **`opportunity_dormancy_days`** | `30` | **TODO-BD-03 / ADR-010 — new key** |
| `stage_stall_days` | `{"new":3,"qualified":14,"selection":21,"quoted":10,"negotiation":14,"verbal_confirmation":10}` | TODO-BD-03 |
| `new_enquiry_sla_hours` | `48` | — |
| `owner_summary_schedule` | `{"cadence":"daily","hour":19}` | TODO-BD-05 |
| `material_types` | `[]` | TODO-BD-04 |
| **`maintenance_consecutive_failures`** | `0` | **ADR-014 — new key** |
| **`maintenance_last_failure_at`** | `null` | **ADR-014 — new key** |

### Geography — `cities` holds revenue taluks (TODO-BD-06, final)

```
Erode District  (Tamil Nadu, India)
  └─ revenue taluk        ← system_settings.cities       (the ten below)
       └─ firka / development block / town / village
                          ← accounts.area, projects.area (free text in V1)
```

| # | Revenue taluk | | # | Revenue taluk |
|---|---|---|---|---|
| 1 | Erode | | 6 | Sathyamangalam |
| 2 | Perundurai | | 7 | Bhavani |
| 3 | Modakkurichi | | 8 | Anthiyur |
| 4 | Kodumudi | | 9 | Thalavadi |
| 5 | Gobichettipalayam | | 10 | Nambiyur |

**`Chennimalai` is NOT a revenue taluk.** It is a **development block and a firka within
Perundurai taluk**, and belongs in `area`, never in `cities`. *(This corrects the previous
documentation pass, which listed it among the taluks.)*

Lower-level units are **not** enumerated in V1: `accounts.area` and `projects.area` stay free
text. **Do not invent geographic units.** A controlled `areas` list, if ever wanted, is a new
settings key plus a `/docs/DECISIONS.md` entry.

The key is named `cities` because §5.10 names it so; it is not renamed. It holds taluks.

### The maintenance counters are state, not configuration (ADR-014)

`maintenance_consecutive_failures` and `maintenance_last_failure_at` hold the §14.6
"failed twice consecutively" state, which needed a home once ADR-002 solved only the
per-opportunity SLA case. The maintenance route updates **both after every execution**;
**the OWNER is notified when the count reaches 2**; **a successful run resets it to 0**.
**No notifications table** — §4.2's rejection stands.

They are **operational state in a configuration table** — that is the deviation ADR-014 approves.
They are written only by the cron route (service-role) and **must not be editable at `/settings`**.

**`dormancy_days` is retired and must not be seeded.** ADR-010 splits it because §14.6 used it for
`accounts.status = 'DORMANT'` while §13.1 used it for the **Dormant opportunity** exception — one
value serving two business meanings that will not stay equal.

Read via a cached server helper (`services/settings.service.ts`). **Never hard-code any of these
values in application code** — resolution fixed the values, not the mechanism (§24, `CLAUDE.md` §3).
`30000000` in particular must never appear as a literal.

---

## Migration order — as built

The §5.12 sequence with the approved corrections applied. **RLS is enabled in each table's own
migration** (H-04); the policies are collected in 016 so the authorization model reads as one
document, and 016 re-asserts RLS and fails loudly if a table ever arrives without it.

```
001_extensions_and_helpers   pgcrypto, pg_trgm (schema `extensions`)
                             normalize_phone() IMMUTABLE (B-06), touch_updated_at()
002_enums                    all enum types — lowercase opportunity_stage preserved (M-23)
003_users                    users + touch trigger + system_user_id() + the seeded system actor
                             (ADR-003) + handle_new_auth_user() (ADR-009) + RLS on
                             NO `branch` column (ADR-016)
004_outlets                  outlets + user_outlets + partial unique index + RLS on   [ADR-016]
005_import                   import_batches, import_rows + RLS on
006_accounts                 accounts WITHOUT referred_by_contact_id (B-07)
                             + account_reachable (ADR-013) + outlet_id (ADR-016) + RLS on
007_contacts                 contacts + RLS on
008_accounts_fk              alter table accounts add referred_by_contact_id … references contacts (B-07)
009_projects                 projects + outlet_id + RLS on
010_project_stakeholders     + three partial unique indexes + RLS on
011_opportunities            + check constraints (quoted_requires_quotation narrowed, ADR-006)
                             + sla_notified_at (ADR-002) + outlet_id + indexes + RLS on
012_activities               activities + RLS on
013_opportunity_events       + log_opportunity_event(): app.event_reason GUC (ADR-001),
                               system-actor fallback (ADR-003), REOPENED (ADR-007),
                               ARCHIVED/RESTORED (M-24) + RLS on
014_system_settings          + seed rows incl. the ADR-014 maintenance counters — BEFORE its
                               consumers (H-03) + RLS on
015_rls_helpers              current_user_id(), user_role(), is_owner(), is_owner_or_admin(),
                             is_manager_or_above(), manages_outlet(), manages_user(),
                             owns_opportunity_on_*(), can_read_*/can_write_project(),
                             guard_record_scope() + execute grants (B-04, H-05, H-12)
016_rls_policies             all policies + grants + the RLS-enabled assertion (H-04)
017_views                    v_opportunity_flags, security_invoker = true, IST dates (B-10),
                             coalesce on the flag booleans (M-07)
```

**Master Phase 2 adds three:**

```
018_system_maintained_columns   touch_stage_changed_at(), touch_last_activity_at(),
                                apply_won_account_status() — the three denormalised columns move
                                from "the service remembers" to "the database maintains" (ADR-020)
019_crm_rpcs                    raise_not_found(), create_account_with_opportunity() (§11.1),
                                log_activity() (§10.2), change_opportunity_stage() (§9.3),
                                reassign_opportunity() (§11.9, closes B-02), bulk_reassign()
                                — every one SECURITY INVOKER, so RLS still decides (§16.3)
020_search_and_duplicates       like_escape(), search_crm() (§11.10),
                                find_account_duplicates() (§8.9) — SECURITY INVOKER, so a record
                                the caller cannot open is never in the result
```

The similarity thresholds of §8.9 are **parameters** of `find_account_duplicates`, not literals in
the migration: `lib/duplicates.ts` holds them once and passes them in, so the numbers cannot drift
apart. The transition matrix is likewise **not** restated in SQL — it lives in
`lib/opportunity/transitions.ts` and is validated there (CLAUDE.md §13); the check constraints
remain the backstop.

`accounts` and `contacts` are mutually referential; **006 → 007 → 008 breaks the cycle. Do not
attempt a single migration for both** (§5.12, §25).

**Not yet written**, because no phase to date builds it: the Storage bucket and its policies
(§15.6). The `reassign_opportunity` RPC (B-02) **is now written**, in 019 — it arrived with the
feature, as planned. Reassignment was already *denied* to a salesperson by the `opportunities`
UPDATE policy; the RPC is the manager-side path, and it exists as an RPC rather than a plain
update because ADR-001's reason GUC and the update itself must share one transaction. Dev seed data lives in `/supabase/seed/dev-fixtures.sql`, not in a migration.

### The ordering corrections

1. **B-07** — §5.3's DDL declares `referred_by_contact_id … references public.contacts(id)`
   **inline**, which cannot execute at 006. Create the column by `alter table` in 008.
   **Do not paste §5.3 verbatim.**
2. **B-04** — helper functions are split by dependency. `owns_opportunity_on_*` and `can_read_*`
   select from tables PostgreSQL validates at creation time, so they cannot exist before those
   tables. They live in 015, after every table.
3. **B-06** — `normalize_phone()` must be `IMMUTABLE` or the generated columns in 006/007 fail with
   *"generation expression is not immutable"*.
4. **H-03** — `014_system_settings` is applied **before** the services that read it.
5. **H-04** — RLS is enabled per table, in that table's migration. A single late migration as the
   first place RLS exists would leave every intermediate state unprotected. 016 keeps the policies
   and re-asserts the flag.

### A third defect, found in Master Phase 2 — recency never moved for shared accounts

`accounts.last_activity_at` was to be written by the service. It cannot be: a salesperson may log
an activity against an account they do not own (the §3.2 work-context rule, permitted by
`activities_insert`), but `accounts_update` requires ownership or outlet management, so the
service's update matched **zero rows and silently succeeded**. Recency on Customer 360 — and every
dormancy query built on it — would have stopped moving for exactly the collaborative accounts
where activity matters most. Fixed by the SECURITY DEFINER trigger in 018; see **ADR-020**, which
also covers `stage_changed_at` and the `won → accounts.status` side effect for the same reason.

### Two defects found by running the migrations

Both were caught by the integration suite on a real database, and both would have shipped if the
SQL had only been read rather than executed. They are recorded because they are exactly what
runtime verification is for.

1. **`log_opportunity_event()` rejected every stage change.** The event type came from a `CASE`
   whose branches are all string literals, which resolves to `text` — and PostgreSQL has no
   implicit text-to-enum cast. The first stage change any user made would have failed. Fixed by
   casting the `CASE` result to `opportunity_event_type`.
2. **`guard_record_scope()` blocked service-role writes.** The trigger enforces the outlet and
   archive rules for user sessions, but it fired for callers with no `auth.uid()` too — cron
   routes and the import executor — which already bypass RLS by design. Fixed by returning early
   when `auth.uid()` is null.

**Never edit a migration that has been applied to any shared environment — write a new one**
(§21.2). These corrections were made **before** any shared environment existed. Never modify
schema through the Supabase dashboard.

---

## Relationships (§6)

| From | To | Cardinality | FK | On delete |
|---|---|---|---|---|
| accounts | users | many→1 | `owner_id` | restrict |
| accounts | contacts | 1→many | `contacts.account_id` | set null |
| accounts | contacts | many→1 | `accounts.referred_by_contact_id` | set null (added in 007) |
| contacts | accounts | many→1 | `linked_account_id` | set null |
| projects | accounts | many→1 | `account_id` | restrict |
| project_stakeholders | projects | many→1 | `project_id` | cascade |
| project_stakeholders | contacts / accounts | many→1 | nullable pair | cascade |
| opportunities | accounts | many→1 | `account_id` | restrict |
| opportunities | projects | many→1 | `project_id` | set null |
| opportunities | users | many→1 | `owner_id` (nullable = unassigned) | restrict |
| activities | accounts | many→1 | `account_id` (**always populated**) | cascade |
| activities | opportunities | many→1 | `opportunity_id` | cascade |
| opportunity_events | opportunities | many→1 | `opportunity_id` | cascade |

Since nothing is hard-deleted (bar ADR-004's link rows), the `on delete` clauses are defensive.

> **One project has many opportunities. Never write code that assumes one opportunity per
> project** (§6).

`activities.account_id` is **always** populated, even when logging against an opportunity, so the
Customer 360 timeline is a single indexed query (§5.8).

**TODO-BD-01 resolved:** `opportunities.project_id` stays **optional for all opportunities,
including high-value ones**. No mandatory-project rule, no threshold, no settings key.

---

## Indexing summary

Every archivable table indexes `owner_id`, and hot filters are **partial indexes** on
`where archived_at is null`. Trigram GIN indexes back name search on `accounts.name`,
`contacts.full_name` and `projects.name`. `opportunities` additionally indexes
`(owner_id, stage)`, `next_action_date`, `(stage, stage_changed_at)`, `expected_close_date`,
plus `opp_unassigned` and `opp_missing_next_action`.

`outlet_id` is indexed on all three outlet-scoped tables, partial on `archived_at is null`, because
it is now in the read path of every manager query.

**M-19 applied — performance.** Argument-free helpers are called as `(select public.fn())` in every
policy so PostgreSQL evaluates them once per query as an InitPlan rather than once per row. Helpers
taking a row column — `manages_outlet(outlet_id)`, `can_read_account(account_id)` — are called
directly, because wrapping a correlated reference defeats the point. This is the main threat to §12.8's
400 ms and §23.6's 20,000-opportunity gate, and it is **measured in Phase 5, not discovered in
Phase 20**.

---

## Notes carried forward

- **M-22** — `import_rows.duplicate_of` stays polymorphic with no FK and no discriminator; the
  entity type is read from `import_batches.entity`. Documented, not changed: adding a discriminator
  would alter a spec'd table for a staging record with a 7-day life.
- **M-29** — PostgREST serialises `bigint` as a JSON number, so §17.3's "parse as string" does not
  happen by itself. Values here (≤ ₹90,000 crore) are far below 2^53, so no data is at risk. Where
  an explicit string is wanted, cast in the select. `lib/money.ts` remains the only conversion
  point and **never `parseFloat`s a rupee string**.
- **M-09** — `setPrimaryStakeholder()` runs as **two statements in one transaction** (clear, then
  set); the partial unique index is not deferrable and a single statement can transiently violate
  it depending on row order.

## Open database questions — none

### P1-05 — closed by ADR-019

`opportunity_events.created_at` defaults to **`clock_timestamp()`**, not `now()`.

`now()` is transaction start time, so with §16.3 running `changeOpportunityStage`, `logActivity`
and `bulkReassign` as single transactions, several events routinely shared one timestamp and
`(opportunity_id, created_at desc)` — the index §5.9 specifies precisely so the trail can be read
in order — could not separate them. `clock_timestamp()` records when each event actually happened.

This is the **only** column in the schema that uses it, and the difference is deliberate:
everywhere else `created_at` means *when this row's transaction began*, and on the audit trail it
means *when this event occurred*. Nothing else about the audit model changed.

### Closed### Closed

For the record:

| Ref | Answer |
|---|---|
| **H-10 sub** | `quoted_requires_quotation` binds **`quoted` only** — not `negotiation`, not `verbal_confirmation`. |
| **M-05** | **Yes** — `account_reachable` added to `accounts` (ADR-013). |
| **H-11 sub** | **`accounts.status` is not changed** when a won opportunity is reopened — the account may hold other WON opportunities. Service-layer, no schema impact. |
| **§14.6 state** | `maintenance_consecutive_failures` + `maintenance_last_failure_at` in `system_settings` (ADR-014). |
| **TODO-BD-06 seed** | The ten revenue taluks above; Chennimalai corrected to a block/firka under Perundurai. |


---

## Master Phase 3 — management intelligence (migrations 021, 022)

### 021 — `sales_targets`, the fourteenth table

Approved as **ADR-021** before the migration was written (CLAUDE.md §4). The reason it could not be
a `system_settings` key is not stylistic: `system_settings_select` grants every authenticated user
read on every row, so a target stored there would publish the company's figure — and every
salesperson's individual figure — to every salesperson through one PostgREST call.

| Column | Notes |
|---|---|
| `period_month` | `date`, always a month start. `target_period_is_month_start` enforces it. |
| `outlet_id` | Null = company-wide. |
| `user_id` | Null = the whole outlet. `target_user_requires_outlet` forbids a person without a branch. |
| `target_paise` | `bigint`, `>= 0`. **Zero is how a target is withdrawn** — there is no DELETE. |

Three **partial** unique indexes, one per scope. A plain three-column unique constraint would not
work: `null` is distinct from `null` in a unique index, so duplicate company rows would be legal.

RLS reads scope straight off `outlet_id` — `null` → `is_owner()`, otherwise
`manages_outlet(outlet_id)`. SALESPERSON and ADMIN match neither branch. `guard_target_scope()`
mirrors `guard_record_scope()`: the UPDATE policy's WITH CHECK only proves the caller manages the
**destination** branch, so without the trigger a manager of two branches could re-point one
branch's target at the other and erase it from the first branch's reporting.

**No DELETE policy.** The schema still holds exactly one, on `project_stakeholders` (ADR-004), and
`tests/integration/service-contracts.test.ts` asserts that.

### 022 — the management analytics functions

Thirteen aggregate functions plus two helpers, all **SECURITY INVOKER** so RLS is evaluated exactly
as it is for a table read (ADR-022).

| Function | Answers |
|---|---|
| `assert_management_access()` | Refuses SALESPERSON and ADMIN at the database boundary. |
| `scoped_outlet_ids()` | Which branches may this caller compare. OWNER → every **active** branch, by role. |
| `management_pipeline_by_stage` | Count, value and weighting per stage. |
| `management_exceptions` | The eight counts of §13.3 Panel A, in one row. |
| `management_period_summary` | Won, lost, new enquiries, quoted value for a period. |
| `management_team_workload` | One row per salesperson in scope, including those with nothing. |
| `management_outlet_comparison` | One row per branch in scope. |
| `management_lost_reasons` | Count and value by reason. |
| `management_quote_conversion` | Reached-quoted, won-after-quote, and wins that never were quoted. |
| `management_quotation_turnaround` | Qualified→quoted days, **plus what it could not measure**. |
| `management_won_by_month` | The trend series, bucketed at Asia/Kolkata, empty months as zeros. |
| `management_at_risk` | The at-risk set, paginated, with the raw signals for `classifyRisk()`. |
| `management_customer_sales` / `management_project_sales` | Rollups per customer and per project. |
| `management_site_visits` | `activities` where `type = 'SITE_VISIT'`. **No site-visits table exists.** |

Four properties worth knowing before editing the file:

1. **Every body is `plpgsql`, not `sql`.** The gate has to run whether or not the query matches a
   row. As a WHERE predicate in a `language sql` body it is subject to the planner — against a
   caller who can see nothing, the scan yields nothing and the gate may never be evaluated.
   `perform` on the first line is unconditional.
2. **No threshold is written in the file.** Stall days, dormancy days, the high-value threshold and
   the stage probabilities all arrive as parameters from `services/settings.service.ts`.
3. **Period boundaries arrive as instants** from `lib/dates.ts`. Where SQL buckets by month it does
   so explicitly at `Asia/Kolkata`.
4. **`p_limit` is capped at 1000**, which is `max_rows` in `supabase/config.toml`. PostgREST
   truncates beyond that silently, so a higher ceiling would be a lie. `EXPORT_ROW_LIMIT` is the
   same number for the same reason; if `max_rows` changes, both change with it.

Grants are made **function by function**. A blanket `grant execute on all functions in schema
public` re-exposed the SECURITY DEFINER trigger functions migration 018 had deliberately revoked —
`tests/integration/service-contracts.test.ts` caught it.


---

## Migrations 023–027 — Master Phase 4

| # | File | What it adds | Why a new number |
|---|---|---|---|
| 023 | `merge_event_type.sql` | `MERGED` on `opportunity_event_type` | PostgreSQL refuses to **use** a new enum value inside the transaction that added it, and the CLI applies each file in its own transaction. Alone, so 025 can cast to it. |
| 024 | `storage.sql` | Private `crm-files` bucket · `safe_uuid`, `can_read_activity`, `can_read_storage_path`, `can_write_storage_path` · policies on `storage.objects` · `opportunities.quotation_file_paths` · **`v_opportunity_flags` recreated** | New objects |
| 025 | `operations_rpcs.sql` | `import_rollback_days` · `archive_account` / `restore_account` · `count_live_account_children` · `merge_accounts` · `execute_import` · `rollback_import` · trigger extended for `MERGED` | New objects |
| 026 | `contacts_import_columns.sql` | `contacts.is_imported`, `legacy_ref`, `import_batch_id` + indexes | **Defect fix, forward.** 007 had been applied; H-03 and §21.2 require a new number |
| 027 | `maintenance.sql` | `maintenance_excluded_batches` · `run_maintenance` | New objects |

### Storage authorization is the path prefix

`crm-files/{account|project|opportunity|activity}/{id}/{uuid}-{filename}`

`can_read_storage_path()` splits the name, refuses anything whose second segment is not a uuid or
whose first is not one of the four kinds — **there is no default-allow branch** — and otherwise
delegates to the same `can_read_*` helper the table policies use. A file is therefore visible to
exactly the people who can see the entity it hangs off, and the service that issues signed URLs
cannot drift away from that rule because it is not the one enforcing it.

`can_write_storage_path()` is deliberately the **same** rule rather than §15.6's literal "any
authenticated user may INSERT": a user who cannot see an opportunity has no business writing into
its folder, and the object would then be readable by everyone entitled to that record.

**No DELETE policy on `storage.objects`.** A reviewer grepping the schema for `for delete` still
finds exactly one policy, on `project_stakeholders` (ADR-004).

### Two things worth knowing before editing this schema

**`v_opportunity_flags` is `select o.*`, and PostgreSQL expands that star at creation time.** A
column added to `opportunities` afterwards does **not** appear in the view — silently, with no
error anywhere. Migration 024 recreates the view in the same file that adds
`quotation_file_paths`. Any future column on `opportunities` must do the same, or every screen
reading through the flags view will be missing it.

**`now()` is transaction start time.** `rollback_import` decides "has this been edited?" with
`updated_at > completed_at`, which is exact across transactions and deliberately equal within one —
the import's own writes must not count as edits. A test that imports and edits inside a single
transaction has to backdate `completed_at` to reproduce the gap that exists in reality.
