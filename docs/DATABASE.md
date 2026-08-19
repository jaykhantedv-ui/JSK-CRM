# Database

PostgreSQL 15+ on Supabase. Authoritative schema: `CLAUDE_CODE_BUILD_SPEC.md` §5, §6.
This document is a working reference — **§5 wins any disagreement.**

**Nothing here has been built yet.** Migrations are Phase 3 of `/docs/IMPLEMENTATION_PLAN.md`.

---

## Conventions (§5.0)

- Extensions: `pgcrypto`, `pg_trgm`.
- Business tables: `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not
  null default now()`, `updated_at timestamptz not null default now()`, `created_by uuid
  references public.users(id)`.
- Archivable tables add `archived_at timestamptz`, `archived_by uuid references public.users(id)`.
- **Nothing is ever hard-deleted.** Every read query filters `archived_at is null` unless it is
  explicitly the archive view.
- `updated_at` is maintained by the `touch_updated_at()` trigger, attached to every table that has
  the column.
- **Money is `bigint` paise** — never float, never rupees in the database.
- All timestamps are `timestamptz`, stored UTC.

> **§5.0's "every table has …" is not literally true of the DDL.** `system_settings` has a `text`
> primary key and no `created_at`/`created_by`; `project_stakeholders` and `opportunity_events`
> have no `updated_at`; `import_rows` has no `updated_at`/`created_by`. The per-table DDL in §5 is
> authoritative. (`/docs/SPEC_AUDIT.md` M-08.)

---

## The eleven tables (§4.1)

| Table | Archivable | Purpose |
|---|---|---|
| `users` | no (`is_active`) | Internal application users; mirrors Supabase `auth.users` |
| `accounts` | **yes** | The permanent customer relationship (individual or firm) |
| `contacts` | **yes** | People — attached to an account, or independent |
| `projects` | **yes** | A physical site |
| `project_stakeholders` | **no** ⚠ | Many-to-many: who is involved in a project, in which role |
| `opportunities` | **yes** | One specific potential sale — the central table |
| `activities` | no (append-only) | Record of what happened |
| `opportunity_events` | no (append-only) | Audit history: stage, owner, won/lost |
| `system_settings` | no | Controlled values changeable without a deploy |
| `import_batches` | no | One row per CSV import run |
| `import_rows` | no | Staged rows with validation and duplicate analysis |

⚠ `project_stakeholders` is neither archivable nor deletable, yet `removeProjectStakeholder()` is
in the service contract — `/docs/SPEC_AUDIT.md` **B-08**.

**Eleven tables, no more.** Adding a twelfth requires approval recorded in `/docs/DECISIONS.md`
before the migration is written (§4.1, `CLAUDE.md` §4).

---

## Enums (§5.1)

19 enum types: `user_role` · `account_type` · `account_status` · `stakeholder_role` ·
`influence_level` · `contact_channel` · `project_type` · `construction_stage` · `project_status` ·
`opportunity_stage` · `product_category` · `quantity_unit` · `quotation_status` · `lost_reason` ·
`activity_type` · `activity_purpose` · `activity_outcome` · `next_action_type` · `lead_source` ·
`opportunity_event_type` · `import_status` · `import_row_status`.

> ⚠ **`opportunity_stage` values are lowercase** (`'new'`, `'qualified'`, `'selection'`, `'quoted'`,
> `'negotiation'`, `'verbal_confirmation'`, `'won'`, `'lost'`, `'nurture'`) while **every other
> enum is UPPERCASE**. This is a real typo hazard across the codebase. Always use the generated
> enum types, never string literals. (`/docs/SPEC_AUDIT.md` M-23.)

Enums are used where values are **structural** — code branches on them, and adding a value
requires a migration. Values the business may extend without a code change (cities, areas, brand
names) live in `system_settings` (§7.3).

---

## Constraints that carry business rules (§5.7)

**The database enforces the business rules.** A bug in the service layer cannot produce a won
opportunity with no value, or a quoted opportunity with no quotation reference. **Never relax one
of these to make code easier** (`CLAUDE.md` §5).

| Constraint | Table | Rule |
|---|---|---|
| `won_requires_value` | opportunities | `stage <> 'won' or final_order_value is not null` |
| `won_requires_closed` | opportunities | `stage <> 'won' or closed_at is not null` |
| `lost_requires_reason` | opportunities | `stage <> 'lost' or lost_reason is not null` |
| `lost_requires_closed` | opportunities | `stage <> 'lost' or closed_at is not null` |
| `quoted_requires_quotation` | opportunities | `quoted`/`negotiation`/`verbal_confirmation` require `quotation_ref`, `quoted_value`, `quotation_date` |
| `next_action_pairing` | opportunities | both next-action fields set, or both null |
| `nurture_needs_date` | opportunities | `stage <> 'nurture' or next_action_date is not null` |
| `contact_reachable` | contacts | phone or email must be present |
| `stakeholder_target` | project_stakeholders | `contact_id` or `account_id` must be present |
| `one_primary_per_project` | project_stakeholders | partial unique index — at most one primary per project |

> ⚠ `quoted_requires_quotation` covers `negotiation`, but §9.2 permits `selection → negotiation`
> with no quotation entry requirement in §9.1. That transition is currently impossible.
> (`/docs/SPEC_AUDIT.md` **H-10**.)

Also enforced by index: at most one stakeholder row per `(project, contact)` and per
`(project, account)` where no contact is set.

---

## Functions and triggers

| Object | Purpose | Notes |
|---|---|---|
| `normalize_phone(text)` | Strips spaces, dashes, brackets, leading `+91`/`91`/`0`; returns the trailing 10 digits, or null if fewer than 10 remain | ⚠ **Must be declared `IMMUTABLE`** — it is used in a generated column, which PostgreSQL rejects otherwise (`/docs/SPEC_AUDIT.md` **B-06**) |
| `touch_updated_at()` | Sets `new.updated_at = now()` | Attached to every table with the column |
| `log_opportunity_event()` | Writes `opportunity_events` rows on insert, stage change and owner change | `SECURITY DEFINER`. **Guarantees no path can bypass the audit.** ⚠ `actor_id` is `not null` but `auth.uid()` is null for service-role writes (**B-03**); the reason text has no write path (**B-01**); `stage_changed_at` is not maintained (**H-01**) |
| `user_role()`, `is_manager_or_above()`, `is_owner_or_admin()` | Role resolution inside RLS policies without recursion | `SECURITY DEFINER`, `stable`, `set search_path = public`. See `/docs/PERMISSIONS.md` |
| `owns_opportunity_on_account(uuid)`, `owns_opportunity_on_project(uuid)` | Work-context read grant | ⚠ Reference `opportunities`, so they cannot be created before migration 010 (**B-04**) |

Generated columns: `accounts.phone_normalized`, `accounts.email_normalized`,
`contacts.phone_normalized` — `generated always as (…) stored`.

---

## The flags view (§10.3)

`v_opportunity_flags` computes `is_active`, `in_pipeline`, `is_overdue`, `is_due_today`,
`is_missing_next_action`, `is_unassigned`, `days_in_stage`, `days_since_activity` from
`opportunities where archived_at is null`.

> **Must be created with `security_invoker = true`. Set that option explicitly.** A default view
> silently bypasses row-level security and leaks every salesperson's pipeline to every other
> salesperson (§10.3, §25). This is asserted by an integration test.

Two corrections the implementation must apply:

- ⚠ **Timezone.** The view uses bare `current_date` and `::date`, which evaluate in the database
  session timezone (UTC), not the Asia/Kolkata business day. Between 00:00 and 05:30 IST every
  date-derived flag is a day stale. Use `(now() at time zone 'Asia/Kolkata')::date` and
  `(ts at time zone 'Asia/Kolkata')::date`. (`/docs/SPEC_AUDIT.md` **B-10**.)
- ⚠ **Three-valued logic.** `is_overdue` and `is_due_today` are `true and null → NULL`, not false,
  when `next_action_date is null`. Type them `boolean | null`, or wrap in `coalesce(…, false)`.
  (`/docs/SPEC_AUDIT.md` M-07.)

Dormancy and stall thresholds come from `system_settings` and are applied in the query layer, not
baked into the view.

**Derived values are computed in queries, never stored**: `is_overdue`, `days_in_stage`,
`weighted_value` (`estimated_value × stage_probability ÷ 100`), `is_dormant` (§5.7).

---

## `system_settings` seed (§5.10)

| Key | Purpose | Seed | Decision |
|---|---|---|---|
| `cities` | Controlled list for account/project city | `[]` | **TODO-BD-06 — must be filled before go-live** |
| `stage_probabilities` | Stage → % for weighted pipeline | `{"new":10,"qualified":25,"selection":40,"quoted":60,"negotiation":75,"verbal_confirmation":90,"nurture":5,"won":100,"lost":0}` | — |
| `high_value_threshold_paise` | Manager escalation threshold | `20000000` (₹2,00,000) | TODO-BD-02 |
| `dormancy_days` | Days without activity before flagged dormant | `30` | TODO-BD-03 |
| `stage_stall_days` | Days in one stage before flagged stalled | `{"new":3,"qualified":14,"selection":21,"quoted":10,"negotiation":14,"verbal_confirmation":10}` | TODO-BD-03 |
| `new_enquiry_sla_hours` | Hours before an untouched new opportunity is flagged | `48` | — |
| `owner_summary_schedule` | Cadence + hour for the owner email | `{"cadence":"daily","hour":19}` | TODO-BD-05 |
| `material_types` | Marble/granite list for `material_notes` autocomplete | `[]` | TODO-BD-04 |

Read via a cached server helper (`services/settings.service.ts`).
**Never hard-code any of these values in application code** (§5.10, `CLAUDE.md` §3).

---

## Migration order (§5.12)

```
001_extensions_and_helpers   pgcrypto, pg_trgm, normalize_phone() [IMMUTABLE], touch_updated_at()
002_enums                    all enum types
003_users                    users + trigger + handle_new_auth_user()
004_import                   import_batches, import_rows  (referenced by later FKs)
005_accounts                 accounts — WITHOUT the referred_by_contact_id FK
006_contacts                 contacts
007_accounts_fk              add accounts.referred_by_contact_id FK
008_projects                 projects
009_project_stakeholders     project_stakeholders + partial unique indexes
010_opportunities            opportunities + all check constraints
011_activities               activities
012_opportunity_events       opportunity_events + log_opportunity_event() trigger
013_system_settings          system_settings + seed rows
014_rls_helpers              user_role(), is_manager_or_above(), owns_opportunity_on()
015_rls_policies             enable RLS + all policies (§15)
016_storage                  Supabase Storage buckets + policies
017_seed                     owner user, settings, sample data (dev only)
```

`accounts` and `contacts` are mutually referential; **005 → 006 → 007 breaks the cycle. Do not
attempt a single migration for both** (§5.12, §25).

### Four ordering corrections the audit found

1. **B-07** — the `accounts` DDL block in §5.3 declares `referred_by_contact_id … references
   public.contacts(id)` **inline**, which cannot execute at 005. Create the column bare in 005;
   add the FK by `alter table` in 007. Do not paste §5.3 verbatim.
2. **B-04** — `014_rls_helpers` cannot run before 010: `owns_opportunity_on_*` are `language sql`
   functions selecting from `opportunities`, and PostgreSQL validates SQL function bodies at
   creation. Split into role helpers (safe early) and work-context helpers (after 010).
3. **H-03** — §22 assigns `013_system_settings` to Phase 7, but `stage_probabilities`,
   `dormancy_days` and `stage_stall_days` are needed by Phases 5–6 (flags, exception tiles,
   weighted pipeline). It must be applied earlier. §22 also assigns 012 to Phase 4 and 011 to
   Phase 5 — impossible, since migrations apply in numeric order.
4. **H-04** — `015_rls_policies` as the single place RLS is enabled contradicts §22's own
   instruction to write policies as each table is created, and would leave every intermediate
   deployment fully readable by any authenticated user. Policies belong in each table's migration;
   015 becomes an audit/hardening pass.

**Never edit a migration that has been applied to any shared environment — write a new one**
(§21.2). Never modify schema through the Supabase dashboard.

---

## Relationships (§6)

| From | To | Cardinality | FK | On delete |
|---|---|---|---|---|
| accounts | users | many→1 | `owner_id` | restrict |
| accounts | contacts | 1→many | `contacts.account_id` | set null |
| accounts | contacts | many→1 | `accounts.referred_by_contact_id` | set null |
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

Since nothing is ever hard-deleted, the `on delete` clauses are defensive rather than operational.

> **One project has many opportunities. Never write code that assumes one opportunity per
> project** (§6).

`activities.account_id` is **always** populated, even when logging against an opportunity, so the
Customer 360 timeline is a single indexed query (§5.8).

---

## Indexing summary

Every archivable table indexes `owner_id`, and hot filters are **partial indexes** on
`where archived_at is null`. Trigram GIN indexes back name search on `accounts.name`,
`contacts.full_name` and `projects.name`. `opportunities` additionally indexes
`(owner_id, stage)`, `next_action_date`, `(stage, stage_changed_at)`, `expected_close_date`,
plus two exception-specific partial indexes (`opp_unassigned`, `opp_missing_next_action`).

**Performance note (`/docs/SPEC_AUDIT.md` M-19):** the work-context RLS helpers are `EXISTS`
subqueries evaluated per candidate row. Wrap each call as `(select public.fn(...))` in policies so
PostgreSQL caches it as an InitPlan, and confirm the supporting indexes are used — this is the
main threat to §12.8's 400 ms and §23.6's 20,000-opportunity gate.

---

## Open database questions

All from `/docs/SPEC_AUDIT.md`: **B-01** (event reason has no write path) · **B-02** (the
`opportunities` UPDATE `with check` is invalid SQL and recursive) · **B-03** (`actor_id` for
service-role writes) · **B-04** (helper migration order) · **B-06** (`normalize_phone` immutability)
· **B-07** (circular FK in the DDL) · **B-08** (`project_stakeholders` removal) · **B-10**
(timezone) · **H-01** (`stage_changed_at` maintainer) · **H-02** (merge audit) · **H-03**, **H-04**
(migration/phase ordering) · **M-05** (accounts has no phone-or-email constraint) · **M-22**
(`import_rows.duplicate_of` is polymorphic with no FK).
