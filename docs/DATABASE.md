# Database

PostgreSQL 15+ on Supabase, region **Mumbai `ap-south-1`** (TODO-BD-08).
Authoritative schema: `CLAUDE_CODE_BUILD_SPEC.md` §5, §6. This document is a working reference —
**§5 wins any disagreement, except where an approved deviation is recorded below.**

**Nothing has been built yet.** Migrations are Phase 3 of `/docs/IMPLEMENTATION_PLAN.md`, and
Phase 3 does not start until the **Decision Gate** passes.

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

> **M-08 resolved.** §5.0's "every table has …" is not literally true of the DDL —
> `system_settings` has a `text` primary key and no `created_at`/`created_by`;
> `project_stakeholders` and `opportunity_events` have no `updated_at`; `import_rows` has no
> `updated_at`/`created_by`. **The per-table DDL in §5 is authoritative**; §5.0's sentence is
> descriptive, not normative.

---

## The eleven tables (§4.1)

| Table | Archivable | Deletable | Purpose |
|---|---|---|---|
| `users` | no (`is_active`) | **no** | Internal application users; mirrors Supabase `auth.users` |
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

**Eleven tables, no more.** ADR-008 explicitly declined a twelfth table for merge history.
Adding one requires approval recorded in `/docs/DECISIONS.md` before the migration is written.

### The one delete exception — ADR-004 (B-08 resolved)

`project_stakeholders` carries **the only `DELETE` policy in the schema**, scoped identically to
its `UPDATE` policy. The row is a **relationship/link**, not a business entity: no history, no
ownership, no money. `removeProjectStakeholder()` deletes it.

**No `archived_at` column is added**, so §5.6's three partial unique indexes stay exactly as
specified. A reviewer should be able to grep for `for delete` and find exactly one policy.
An integration test asserts DELETE fails on all ten other tables, for every role.

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

## Columns added beyond §5

Exactly one, under an approved ADR.

| Column | Table | Source | Why |
|---|---|---|---|
| `sla_notified_at timestamptz` | `opportunities` | **ADR-002** (B-05) | The §14.2 SLA reminder must fire once per opportunity, and the "event metadata" key it names cannot exist: §4.2 rejects a notifications table, the event enum has no notification value, and event rows cannot be updated. Without state the reminder re-sends **every hour, forever**. Null = not yet notified. **Not user-writable through any policy.** |

Nothing else is added. §5.5's "Do not add fields not listed" holds everywhere else, and §17.6's
future-proofing list is closed. One **constraint** is added beyond §5 — `account_reachable`
(ADR-013) — and two **settings keys** — the ADR-014 maintenance counters.

---

## Functions and triggers

| Object | Purpose | Approved resolution |
|---|---|---|
| `normalize_phone(text)` | Strips spaces, dashes, brackets, leading `+91`/`91`/`0`; returns the trailing 10 digits, or null if fewer than 10 remain | **Declared `IMMUTABLE` and genuinely deterministic** — regex/`translate` only, no locale- or configuration-dependent calls. Required by the generated columns (B-06). |
| `touch_updated_at()` | Sets `new.updated_at = now()` | Attached to every table with the column |
| `log_opportunity_event()` | Writes `opportunity_events` rows on insert, stage change and owner change | `SECURITY DEFINER`. **Reads `app.event_reason`** to attach the reason (ADR-001). **Resolves the actor as `coalesce(auth.uid(), new.created_by, <system user uuid>)`** (ADR-003). **Maintains `stage_changed_at`** on every stage change (H-01). Guarantees no path bypasses the audit. |
| `user_role()`, `is_manager_or_above()`, `is_owner_or_admin()`, **`can_reassign()`** | Role resolution inside RLS policies without recursion | `SECURITY DEFINER`, `stable`, `set search_path = public`. **`can_reassign() = MANAGER, OWNER` — ADMIN excluded** (H-05). Created **before** the business tables (B-04). |
| `owns_opportunity_on_account/project(uuid)`, **`can_see_account/project/opportunity/activity(uuid)`** | Work-context and visibility predicates | `SECURITY DEFINER` so they do not re-enter the policies they support (H-12). Created **after** the tables they reference (B-04). |
| `reassign_opportunity(...)` | Ownership change | `SECURITY DEFINER` RPC gated on `can_reassign()`. **The §15.5 fallback `with check` is invalid SQL and recursive and must never be written** (B-02). |

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

## Migration order — corrected

The §5.12 sequence with the approved corrections applied. **RLS is enabled in each table's own
migration** (H-04), not deferred to 015.

```
001_extensions_and_helpers   pgcrypto, pg_trgm, normalize_phone() IMMUTABLE (B-06), touch_updated_at()
002_enums                    all enum types — lowercase opportunity_stage preserved (M-23)
003_users                    users + trigger + handle_new_auth_user() + RLS
                             enumerated SELECT/INSERT/UPDATE, NO "for all", NO delete (H-06)
004_import                   import_batches, import_rows + RLS
005_accounts                 accounts WITHOUT referred_by_contact_id FK (B-07)
                             + account_reachable check constraint (ADR-013) + RLS
006_contacts                 contacts + RLS
007_accounts_fk              alter table accounts add constraint … references contacts (B-07)
008_projects                 projects + RLS
009_project_stakeholders     + three partial unique indexes + RLS incl. the ADR-004 DELETE policy
010_opportunities            + check constraints (quoted_requires_quotation narrowed, ADR-006)
                             + sla_notified_at (ADR-002) + indexes + RLS
011_activities               activities + RLS (24-hour author edit window)
012_opportunity_events       + log_opportunity_event(): app.event_reason GUC (ADR-001),
                               system-user actor (ADR-003), stage_changed_at (H-01)
                             + RLS: no UPDATE, no DELETE, for anyone
013_system_settings          + seed rows incl. the ADR-014 maintenance counters — BEFORE its consumers (H-03)
0xx_rls_helpers_role         user_role, is_manager_or_above, is_owner_or_admin, can_reassign (B-04, H-05)
0xx_rls_helpers_context      owns_opportunity_on_*, can_see_* (B-04, H-12)
0xx_reassign_opportunity     SECURITY DEFINER RPC gated on can_reassign() (B-02)
0xx_flags_view               v_opportunity_flags, security_invoker = true, IST dates (B-10), coalesce (M-07)
0xx_system_user_seed         the automated-write actor, is_active = false (ADR-003)
015_rls_policies             AUDIT / HARDENING pass — policies already exist per table (H-04)
016_storage                  Supabase Storage bucket + policies using can_see_* (H-12)
017_seed                     owner user, settings, sample data (dev only)
```

`accounts` and `contacts` are mutually referential; **005 → 006 → 007 breaks the cycle. Do not
attempt a single migration for both** (§5.12, §25).

### The five ordering corrections

1. **B-07** — §5.3's DDL declares `referred_by_contact_id … references public.contacts(id)`
   **inline**, which cannot execute at 005. Create the column bare in 005; add the FK by
   `alter table` in 007. **Do not paste §5.3 verbatim.**
2. **B-04** — helper functions are split. `owns_opportunity_on_*` and `can_see_*` are `language sql`
   bodies selecting from tables PostgreSQL validates at creation time, so they cannot exist before
   those tables. Role helpers go first, context helpers after.
3. **B-06** — `normalize_phone()` must be `IMMUTABLE` or the generated columns in 005/006 fail with
   *"generation expression is not immutable"*.
4. **H-03** — `013_system_settings` is applied **before** the services that read it. §22's
   assignment of 013 to Phase 7 contradicted Phases 5–6's need for it. Phase assignments must
   never contradict numeric migration order, and **an extension of an applied migration is always
   a new numbered file** (§21.2), never an edit.
5. **H-04** — RLS is enabled per table, in that table's migration. A single 015 as the first place
   RLS exists would leave every intermediate environment fully readable and writable by any
   authenticated user. 015 becomes an audit/hardening pass.

**Never edit a migration that has been applied to any shared environment — write a new one**
(§21.2). Never modify schema through the Supabase dashboard.

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

**M-19 resolved — performance.** The work-context RLS helpers are `EXISTS` subqueries evaluated
per candidate row. **Wrap each call as `(select public.fn(...))`** in policies so PostgreSQL caches
it as an InitPlan, and confirm the supporting indexes are used. This is the main threat to §12.8's
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

Every schema question is closed. For the record:

| Ref | Answer |
|---|---|
| **H-10 sub** | `quoted_requires_quotation` binds **`quoted` only** — not `negotiation`, not `verbal_confirmation`. |
| **M-05** | **Yes** — `account_reachable` added to `accounts` (ADR-013). |
| **H-11 sub** | **`accounts.status` is not changed** when a won opportunity is reopened — the account may hold other WON opportunities. Service-layer, no schema impact. |
| **§14.6 state** | `maintenance_consecutive_failures` + `maintenance_last_failure_at` in `system_settings` (ADR-014). |
| **TODO-BD-06 seed** | The ten revenue taluks above; Chennimalai corrected to a block/firka under Perundurai. |
