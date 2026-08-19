# CLAUDE_CODE_BUILD_SPEC.md

**Project:** Sales CRM for a building-materials retailer (tiles, marble, granite, sanitaryware, CP fittings)
**Consumer of this document:** Claude Code
**Status:** Version 1 — implementation specification
**Date:** August 2026

> This file is the implementation source of truth. If behaviour is not described here, it is not in Version 1.
> Where a business decision is unresolved it is marked `TODO-BD-nn` and listed in §24. **Never resolve a `TODO-BD` by choosing a value in code.** Put the placeholder in `system_settings`, implement the mechanism, and flag it.

---

## 1. PRODUCT OVERVIEW

### 1.1 What this is

A standalone web CRM replacing handwritten sales books at a building-materials retail business. Mobile-first for salespeople, desktop-oriented for management.

### 1.2 The five questions the application must answer instantly

1. Who is this customer?
2. What project are they associated with?
3. What are they buying or considering?
4. Who is responsible for the relationship?
5. What happened last, and what happens next?

Every screen, table and query in this spec exists to serve one of these five. If a proposed addition serves none of them, it is out of scope.

### 1.3 Users

| Role | Device | Pattern |
|---|---|---|
| Salesperson (5–15) | Android phone | Many short sessions, in showroom or on site |
| Sales Manager (1) | Desktop | Daily exception review, weekly pipeline review |
| Owner (1) | Phone/desktop | Occasional high-level check |
| Admin (0–1) | Desktop | User admin, data import, cleanup |

### 1.4 The performance bar that matters

A salesperson must be able to create a customer with an opportunity **in about one minute** on a phone, and log an interaction in **three taps**. If the application is slower than a notebook, it fails regardless of feature completeness.

---

## 2. SCOPE & BOUNDARIES

### 2.1 The CRM owns

Customer identity · contacts and stakeholders · projects/sites · opportunities · sales pipeline · activity history · ownership and accountability · next actions · lightweight quotation references · pre-sale information only.

### 2.2 The CRM does not own

Accounting · GST · ledgers · invoices · authoritative inventory or stock · payment records · delivery and logistics · payroll · commission.

**Rule:** if a data point changes when goods physically move or money changes hands, it does not belong in this database. The handoff point is a won opportunity; from there the existing accounting system takes over manually.

### 2.3 Explicitly NOT in Version 1

Accounting or inventory integration · GST/invoicing · ERP features · commission calculation · line-item quotation engine · WhatsApp Business API, webhooks or message ingestion · marketing automation · AI/lead scoring/forecasting · slab-level stone inventory · sample tracking · multi-branch UI · offline mode · customer portal · SMS/push notifications.

Do not build partial versions of these. Do not add columns "ready for" them beyond what §17.6 specifies.

### 2.4 Terminology discipline

The application must never display the word **Revenue**. Won opportunity values are salesperson-entered estimates, not accounting figures. Use:

- **Pipeline Value** — sum of `estimated_value` on active opportunities
- **Won Value** — sum of `final_order_value` on won opportunities
- **Weighted Pipeline** — pipeline value × stage probability

---

## 3. USERS & PERMISSIONS

Four roles on `users.role`. Permissions are enforced by Postgres RLS (§15), not by the UI.

### 3.1 Capability matrix

| Capability | SALESPERSON | MANAGER | OWNER | ADMIN |
|---|---|---|---|---|
| See own-owned accounts/projects/opportunities | ✔ | ✔ | ✔ | ✔ |
| See records related to an opportunity they own | ✔ | ✔ | ✔ | ✔ |
| **See all records** | ✘ | ✔ | ✔ | ✔ |
| Create accounts, contacts, projects, opportunities, activities | ✔ | ✔ | ✔ | ✔ |
| Edit own-owned records | ✔ | ✔ | ✔ | ✔ |
| Edit any record | ✘ | ✔ | ✔ | ✔ |
| **Assign / reassign ownership** | ✘ | ✔ | ✔ | ✘ |
| **Archive / restore records** | ✘ | ✔ | ✔ | ✔ |
| Hard delete anything | ✘ | ✘ | ✘ | ✘ |
| **Export CSV** | ✘ | ✔ | ✔ | ✘ |
| Import CSV | ✘ | ✘ | ✔ | ✔ |
| Team dashboard, reports, workload | ✘ | ✔ | ✔ | ✘ |
| Manage users | ✘ | ✘ | ✔ | ✔ |
| Edit system settings / controlled values | ✘ | ✘ | ✔ | ✔ |
| View audit trail | ✘ | ✔ (own team) | ✔ | ✔ |

### 3.2 Rules

- **No self-registration.** Users are created by OWNER or ADMIN.
- Deactivating a user (`is_active = false`) blocks login. Their records are never deleted; ownership must be reassigned separately.
- A salesperson's read access is **ownership-based plus work-context**: they may read an account or project they do not own *only if* they own an opportunity attached to it. This is expressed as an RLS `EXISTS` clause (§15.4), not as application filtering.
- ADMIN is a system/data role, not a sales role: no dashboards, no reassignment, no export.

---

## 4. DATA MODEL

### 4.1 Entity list — eleven tables, no more

| Table | Purpose |
|---|---|
| `users` | Internal application users; mirrors Supabase `auth.users` |
| `accounts` | The permanent customer relationship (individual or firm) |
| `contacts` | People. Attached to an account, or independent (referring architect) |
| `projects` | A physical site |
| `project_stakeholders` | Many-to-many: which people/accounts are involved in a project, in which role |
| `opportunities` | One specific potential sale. Carries pipeline stage, values, ownership and next action |
| `activities` | Append-only record of what happened |
| `opportunity_events` | Audit history: stage changes, owner changes, won/lost. Distinct from `activities` |
| `system_settings` | Controlled values and thresholds that must be changeable without a deploy |
| `import_batches` | One row per CSV import run |
| `import_rows` | Staged rows with validation and duplicate analysis |

### 4.2 Rejected tables and why

| Rejected | Reason |
|---|---|
| `leads` | A new enquiry is an opportunity at stage `new`. No lead→customer conversion step exists (§8.2) |
| `companies` separate from `accounts` | One account model with `account_type`. Two tables doubles every query and permission for no benefit |
| `tasks` | V1 uses `next_action` + `next_action_date` on the opportunity (§10). A task system is Version 2 |
| `quotations` | Lightweight quotation fields live on the opportunity (§8.6). A quotation table is only needed when revisions must be tracked independently — not in V1 |
| `products` | Version 1 captures interest through controlled category values and free-text notes (§8.7). No SKU catalogue |
| `notifications` | Exceptions (overdue, missing next action, dormant) are **computed from data**, not stored. Only `notification_log` behaviour is needed, and it is folded into `system_settings`-driven cron jobs (§14.5) |
| `attachments` | Supabase Storage with a path convention (§17.5). No metadata table in V1 |

### 4.3 Relationship map

```
users ──owns──▶ accounts, projects, opportunities
      └─performs──▶ activities

accounts
  ├─▶ contacts              (contacts.account_id)
  ├─▶ projects              (projects.account_id)      the primary buying party
  ├─▶ opportunities         (opportunities.account_id)
  └─▶ activities            (activities.account_id)    always populated

contacts
  └─▶ linked_account_id ──▶ accounts   when this person is also a customer

projects
  ├─▶ project_stakeholders ──▶ contacts and/or accounts (role + influence)
  ├─▶ opportunities         (opportunities.project_id)   MANY per project
  └─▶ activities

opportunities
  ├─▶ activities            (activities.opportunity_id)
  └─▶ opportunity_events    stage + ownership audit trail
```

### 4.4 The multi-stakeholder case (must work end-to-end)

```
accounts
  A1  Mr Jain               HOMEOWNER    owner: Jay
  A2  Rahul Constructions   CONTRACTOR   owner: Jay
  A3  ABC Architects        ARCHITECT    owner: Jay

contacts
  C1  Mr Jain          account_id=A1  role=OWNER_BUYER   influence=DECISION_MAKER
  C2  Rahul            account_id=A2  linked_account_id=A2  role=CONTRACTOR
  C3  Priya (architect) account_id=A3  role=ARCHITECT  is_referral_source=true

projects
  P1  Jain Residence   account_id=A1  type=VILLA  stage=PLASTERING

project_stakeholders  (project_id, role, influence, contact_id | account_id)
  P1, OWNER_BUYER,  DECISION_MAKER,    contact=C1, account=A1, is_primary=true
  P1, CONTRACTOR,   STRONG_INFLUENCER, contact=C2, account=A2
  P1, ARCHITECT,    STRONG_INFLUENCER, contact=C3, account=A3

opportunities  (all on P1 — this is the point)
  O1  Flooring            ₹4,20,000  won
  O2  Bathroom tiles      ₹  95,000  negotiation
  O3  Sanitaryware + CP   ₹2,80,000  new
```

A stakeholder row may reference a contact, an account, or both. At least one must be non-null (check constraint).

---

## 5. DATABASE SCHEMA

PostgreSQL 15+ on Supabase. All SQL below is the intended migration content. Money is **`bigint` paise** — never float, never rupees in the database.

### 5.0 Extensions and conventions

```sql
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
```

Every table has: `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, `created_by uuid references public.users(id)`.

Archivable tables additionally have `archived_at timestamptz`, `archived_by uuid references public.users(id)`. **Nothing is ever hard-deleted.** Every read query filters `archived_at is null` unless explicitly showing the archive.

`updated_at` is maintained by a trigger:

```sql
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
-- attach to every table
```

### 5.1 Enums

```sql
create type user_role as enum ('SALESPERSON','MANAGER','OWNER','ADMIN');

create type account_type as enum (
  'HOMEOWNER','CONTRACTOR','BUILDER','ARCHITECT','INTERIOR_DESIGNER',
  'DEALER','COMMERCIAL','MASON','OTHER');

create type account_status as enum ('PROSPECT','ACTIVE','DORMANT','DO_NOT_CONTACT');

create type stakeholder_role as enum (
  'OWNER_BUYER','SPOUSE_FAMILY','ARCHITECT','INTERIOR_DESIGNER','CONTRACTOR',
  'BUILDER','SITE_ENGINEER','MASON','PURCHASE_MANAGER','DEALER','OTHER');

create type influence_level as enum (
  'DECISION_MAKER','STRONG_INFLUENCER','INFLUENCER','EXECUTOR','INFORMATION_ONLY');

create type contact_channel as enum ('CALL','WHATSAPP','IN_PERSON','EMAIL');

create type project_type as enum (
  'INDIVIDUAL_HOUSE','VILLA','APARTMENT_UNIT','APARTMENT_PROJECT',
  'COMMERCIAL','HOSPITALITY','INSTITUTIONAL','RENOVATION','OTHER');

create type construction_stage as enum (
  'PLANNING','FOUNDATION','STRUCTURE','BRICKWORK','PLASTERING',
  'FLOORING_STAGE','FINISHING','COMPLETED','RENOVATION','UNKNOWN');

create type project_status as enum ('ACTIVE','ON_HOLD','COMPLETED','ABANDONED');

create type opportunity_stage as enum (
  'new','qualified','selection','quoted','negotiation',
  'verbal_confirmation','won','lost','nurture');

create type product_category as enum (
  'TILES','MARBLE','GRANITE','SANITARYWARE','CP_FITTINGS','ALLIED','MIXED');

create type quantity_unit as enum ('SQFT','SQM','NOS','SET','BOX');

create type quotation_status as enum (
  'NONE','PREPARING','SENT','UNDER_DISCUSSION','REVISED','ACCEPTED','REJECTED','EXPIRED');

create type lost_reason as enum (
  'PRICE','STOCK_UNAVAILABLE','DELIVERY_TIME','DESIGN_NOT_AVAILABLE',
  'COMPETITOR_RELATIONSHIP','PROJECT_POSTPONED','PROJECT_CANCELLED','BUDGET_CUT',
  'SPECIFIED_OTHER_BRAND','CREDIT_TERMS','SERVICE_RESPONSE','NOT_GENUINE',
  'NO_RESPONSE','UNKNOWN');

create type activity_type as enum (
  'CALL','WHATSAPP','SHOWROOM_VISIT','SITE_VISIT','MEETING','EMAIL','NOTE');

create type activity_purpose as enum (
  'ENQUIRY','FOLLOW_UP','PRODUCT_DISCUSSION','SITE_MEASUREMENT','SAMPLE_HANDOVER',
  'QUOTATION_DISCUSSION','PRICE_NEGOTIATION','ORDER_CONFIRMATION','RELATIONSHIP','OTHER');

create type activity_outcome as enum (
  'POSITIVE','NEUTRAL','NEGATIVE','NO_RESPONSE','RESCHEDULED');

create type next_action_type as enum (
  'CALL','SHOWROOM_VISIT','SITE_VISIT','SEND_QUOTATION','SHARE_SAMPLES',
  'QUOTATION_FOLLOWUP','PRICE_DISCUSSION','AWAIT_CUSTOMER','OTHER');

create type lead_source as enum (
  'WALK_IN','PHONE_ENQUIRY','CUSTOMER_REFERRAL','ARCHITECT_REFERRAL',
  'CONTRACTOR_REFERRAL','SIGNAGE','SOCIAL_MEDIA','EXHIBITION','EXISTING_CUSTOMER','OTHER');

create type opportunity_event_type as enum (
  'CREATED','STAGE_CHANGED','OWNER_CHANGED','WON','LOST','REOPENED','ARCHIVED','RESTORED');

create type import_status as enum (
  'UPLOADED','VALIDATING','REVIEW','IMPORTING','COMPLETED','FAILED','ROLLED_BACK');

create type import_row_status as enum (
  'VALID','WARNING','ERROR','DUPLICATE_EXACT','DUPLICATE_POSSIBLE','IMPORTED','SKIPPED');
```

Enums are used where values are structural (code branches on them). Values that the business may extend without a code change — cities, areas, brand names — live in `system_settings` (§7.3).

### 5.2 `users`

Mirrors `auth.users`. `id` equals the Supabase auth uid.

```sql
create table public.users (
  id            uuid primary key references auth.users(id) on delete restrict,
  full_name     text not null,
  email         text not null unique,
  phone         text,
  role          user_role not null default 'SALESPERSON',
  is_active     boolean not null default true,
  branch        text not null default 'MAIN',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.users (role) where is_active;
```

### 5.3 `accounts`

```sql
create table public.accounts (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(trim(name)) >= 2),
  account_type       account_type not null,
  phone              text,
  phone_normalized   text generated always as (public.normalize_phone(phone)) stored,
  alt_phone          text,
  whatsapp_phone     text,
  email              text,
  email_normalized   text generated always as (lower(trim(email))) stored,
  address            text,
  city               text,
  area               text,
  source             lead_source not null default 'WALK_IN',
  referred_by_contact_id uuid references public.contacts(id) on delete set null,
  owner_id           uuid not null references public.users(id),
  status             account_status not null default 'PROSPECT',
  gstin              text,
  notes              text,
  branch             text not null default 'MAIN',
  last_activity_at   timestamptz,
  is_imported        boolean not null default false,
  legacy_ref         text,
  import_batch_id    uuid references public.import_batches(id),
  archived_at        timestamptz,
  archived_by        uuid references public.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.users(id)
);

create index on public.accounts (owner_id) where archived_at is null;
create index on public.accounts (phone_normalized) where archived_at is null;
create index on public.accounts (email_normalized) where archived_at is null;
create index on public.accounts (status, account_type) where archived_at is null;
create index on public.accounts (last_activity_at desc nulls last) where archived_at is null;
create index accounts_name_trgm on public.accounts using gin (name gin_trgm_ops);
```

**`phone_normalized` is NOT unique.** Duplicate detection is advisory (§8.9) — the business requirement is a warning, not a hard block. Two family members legitimately share a number.

`normalize_phone` strips spaces, dashes, brackets, a leading `+91`, `91` or `0`, and returns the trailing 10 digits, or null if fewer than 10 digits remain.

### 5.4 `contacts`

```sql
create table public.contacts (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text not null,
  account_id         uuid references public.accounts(id) on delete set null,
  linked_account_id  uuid references public.accounts(id) on delete set null,
  phone              text,
  phone_normalized   text generated always as (public.normalize_phone(phone)) stored,
  alt_phone          text,
  email              text,
  role               stakeholder_role not null default 'OTHER',
  influence          influence_level not null default 'INFLUENCER',
  preferred_channel  contact_channel not null default 'CALL',
  is_referral_source boolean not null default false,
  notes              text,
  owner_id           uuid not null references public.users(id),
  archived_at        timestamptz, archived_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  constraint contact_reachable check (phone is not null or email is not null)
);
create index on public.contacts (account_id) where archived_at is null;
create index on public.contacts (linked_account_id);
create index on public.contacts (phone_normalized);
create index on public.contacts (owner_id);
create index on public.contacts (is_referral_source) where is_referral_source;
create index contacts_name_trgm on public.contacts using gin (full_name gin_trgm_ops);
```

**A simple homeowner does not need a contact row.** The account carries the phone. Contacts exist for additional people. The UI must never force contact creation for a one-person account.

### 5.5 `projects`

```sql
create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  account_id         uuid not null references public.accounts(id) on delete restrict,
  project_type       project_type not null,
  construction_stage construction_stage not null default 'UNKNOWN',
  status             project_status not null default 'ACTIVE',
  site_address       text,
  city               text,
  area               text,
  builtup_area_sqft  integer check (builtup_area_sqft is null or builtup_area_sqft between 1 and 1000000),
  floors             smallint check (floors is null or floors between 0 and 200),
  bathrooms          smallint check (bathrooms is null or bathrooms between 0 and 500),
  expected_flooring_date date,
  estimated_value    bigint check (estimated_value is null or estimated_value >= 0),
  notes              text,
  owner_id           uuid not null references public.users(id),
  branch             text not null default 'MAIN',
  is_imported        boolean not null default false,
  legacy_ref         text,
  import_batch_id    uuid references public.import_batches(id),
  archived_at timestamptz, archived_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);
create index on public.projects (account_id) where archived_at is null;
create index on public.projects (owner_id) where archived_at is null;
create index on public.projects (status, construction_stage) where archived_at is null;
create index on public.projects (city) where archived_at is null;
create index projects_name_trgm on public.projects using gin (name gin_trgm_ops);
```

Field classification: **Required** — name, account_id, project_type. **Optional** — everything else. **Derived** — none. **Future** — none. Do not add fields not listed.

### 5.6 `project_stakeholders`

```sql
create table public.project_stakeholders (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  contact_id  uuid references public.contacts(id) on delete cascade,
  account_id  uuid references public.accounts(id) on delete cascade,
  role        stakeholder_role not null,
  influence   influence_level not null default 'INFLUENCER',
  is_primary  boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.users(id),
  constraint stakeholder_target check (contact_id is not null or account_id is not null)
);
create unique index on public.project_stakeholders (project_id, contact_id) where contact_id is not null;
create unique index on public.project_stakeholders (project_id, account_id) where account_id is not null and contact_id is null;
create unique index one_primary_per_project on public.project_stakeholders (project_id) where is_primary;
create index on public.project_stakeholders (contact_id);
create index on public.project_stakeholders (account_id);
```

The partial unique index enforces at most one primary stakeholder per project at the database level.

### 5.7 `opportunities`

The central table. Carries pipeline stage, values, ownership, next action, and lightweight quotation fields.

```sql
create table public.opportunities (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  account_id         uuid not null references public.accounts(id) on delete restrict,
  project_id         uuid references public.projects(id) on delete set null,
  owner_id           uuid references public.users(id),          -- nullable: 'unassigned' is a real state
  stage              opportunity_stage not null default 'new',
  category           product_category not null,
  material_notes     text,                                       -- marble/granite type, grade, style: see TODO-BD-04
  estimated_quantity numeric(12,2) check (estimated_quantity is null or estimated_quantity >= 0),
  quantity_unit      quantity_unit,
  estimated_value    bigint not null check (estimated_value >= 0),
  quoted_value       bigint check (quoted_value is null or quoted_value >= 0),
  final_order_value  bigint check (final_order_value is null or final_order_value >= 0),
  order_reference    text,                                       -- free text bridge to the accounting system
  expected_close_date date,
  next_action        next_action_type,
  next_action_date   date,
  next_action_note   text,
  quotation_ref      text,
  quotation_date     date,
  quotation_status   quotation_status not null default 'NONE',
  quotation_valid_until date,
  competitor         text,
  lost_reason        lost_reason,
  lost_detail        text,
  closed_at          timestamptz,
  stage_changed_at   timestamptz not null default now(),
  last_activity_at   timestamptz,
  source             lead_source not null default 'WALK_IN',
  branch             text not null default 'MAIN',
  is_imported        boolean not null default false,
  legacy_ref         text,
  import_batch_id    uuid references public.import_batches(id),
  archived_at timestamptz, archived_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),

  constraint won_requires_value  check (stage <> 'won'  or final_order_value is not null),
  constraint won_requires_closed check (stage <> 'won'  or closed_at is not null),
  constraint lost_requires_reason check (stage <> 'lost' or lost_reason is not null),
  constraint lost_requires_closed check (stage <> 'lost' or closed_at is not null),
  constraint quoted_requires_quotation check (
    stage not in ('quoted','negotiation','verbal_confirmation')
    or (quotation_ref is not null and quoted_value is not null and quotation_date is not null)),
  constraint next_action_pairing check (
    (next_action is null and next_action_date is null)
    or (next_action is not null and next_action_date is not null)),
  constraint nurture_needs_date check (stage <> 'nurture' or next_action_date is not null)
);

create index on public.opportunities (owner_id, stage) where archived_at is null;
create index on public.opportunities (account_id) where archived_at is null;
create index on public.opportunities (project_id) where archived_at is null;
create index on public.opportunities (next_action_date) where archived_at is null;
create index on public.opportunities (stage, stage_changed_at) where archived_at is null;
create index on public.opportunities (expected_close_date) where archived_at is null;
create index opp_unassigned on public.opportunities (created_at) where owner_id is null and archived_at is null;
create index opp_missing_next_action on public.opportunities (owner_id)
  where next_action_date is null and archived_at is null and stage not in ('won','lost');
```

**The database enforces the business rules.** Those five check constraints are the backbone of data quality — a bug in the service layer cannot produce a won opportunity with no value, or a quoted opportunity with no quotation reference.

Derived values are **computed in queries, never stored**: `is_overdue` (`next_action_date < current_date` and stage active), `days_in_stage`, `weighted_value` (`estimated_value * stage_probability / 100`), `is_dormant`.

`owner_id` is nullable because "unassigned" is a genuine state the manager dashboard must surface (§13.2). Application logic defaults it to the creating user (§8.4); imports and manager-created records may leave it null deliberately.

### 5.8 `activities`

Append-only. Site visits are `activity_type = 'SITE_VISIT'`, not a separate table.

```sql
create table public.activities (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  project_id     uuid references public.projects(id) on delete set null,
  contact_id     uuid references public.contacts(id) on delete set null,
  type           activity_type not null,
  purpose        activity_purpose not null default 'FOLLOW_UP',
  outcome        activity_outcome not null default 'NEUTRAL',
  summary        text not null check (length(trim(summary)) >= 3),
  occurred_at    timestamptz not null default now(),
  duration_minutes smallint,
  measurements   text,     -- SITE_VISIT only
  location_note  text,     -- SITE_VISIT only
  attachment_paths text[] not null default '{}',
  performed_by   uuid not null references public.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.users(id)
);
create index on public.activities (account_id, occurred_at desc);
create index on public.activities (opportunity_id, occurred_at desc);
create index on public.activities (performed_by, occurred_at desc);
create index on public.activities (project_id);
```

`account_id` is **always** populated, even when logging against an opportunity, so the Customer 360 timeline is a single indexed query.

Activities are immutable after 24 hours: an `UPDATE` policy permits changes only where `created_at > now() - interval '24 hours'` and `performed_by = auth.uid()`. There is no delete policy for anyone.

### 5.9 `opportunity_events` — audit trail

Separate from `activities` by design: activities are what the salesperson did with the customer; events are what the system recorded about the record.

```sql
create table public.opportunity_events (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  event_type     opportunity_event_type not null,
  from_stage     opportunity_stage,
  to_stage       opportunity_stage,
  from_owner_id  uuid references public.users(id),
  to_owner_id    uuid references public.users(id),
  reason         text,
  metadata       jsonb not null default '{}',
  actor_id       uuid not null references public.users(id),
  created_at     timestamptz not null default now()
);
create index on public.opportunity_events (opportunity_id, created_at desc);
create index on public.opportunity_events (event_type, created_at desc);
create index on public.opportunity_events (actor_id, created_at desc);
```

Written by a database trigger on `opportunities` (stage or owner change) **and** by the service layer for reason text. Trigger implementation guarantees no path can bypass the audit:

```sql
create or replace function public.log_opportunity_event() returns trigger
language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.opportunity_events (opportunity_id, event_type, to_stage, to_owner_id, actor_id)
    values (new.id, 'CREATED', new.stage, new.owner_id, coalesce(new.created_by, auth.uid()));
  else
    if new.stage is distinct from old.stage then
      insert into public.opportunity_events (opportunity_id, event_type, from_stage, to_stage, actor_id)
      values (new.id,
              case new.stage when 'won' then 'WON' when 'lost' then 'LOST' else 'STAGE_CHANGED' end,
              old.stage, new.stage, auth.uid());
    end if;
    if new.owner_id is distinct from old.owner_id then
      insert into public.opportunity_events (opportunity_id, event_type, from_owner_id, to_owner_id, actor_id)
      values (new.id, 'OWNER_CHANGED', old.owner_id, new.owner_id, auth.uid());
    end if;
  end if;
  return new;
end $$;
```

There is no UPDATE or DELETE policy on this table for any role. It is append-only for everyone.

### 5.10 `system_settings`

```sql
create table public.system_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users(id)
);
```

Seeded keys (values are placeholders pending §24):

| Key | Purpose | Seed |
|---|---|---|
| `cities` | Controlled list for account/project city | `[]` — **must be filled before go-live, TODO-BD-06** |
| `stage_probabilities` | Stage → % for weighted pipeline | `{"new":10,"qualified":25,"selection":40,"quoted":60,"negotiation":75,"verbal_confirmation":90,"nurture":5,"won":100,"lost":0}` |
| `high_value_threshold_paise` | Manager escalation threshold | `20000000` (₹2,00,000) — TODO-BD-02 |
| `dormancy_days` | Days without activity before an opportunity is flagged dormant | `30` — TODO-BD-03 |
| `stage_stall_days` | Days in one stage before flagged stalled | `{"new":3,"qualified":14,"selection":21,"quoted":10,"negotiation":14,"verbal_confirmation":10}` — TODO-BD-03 |
| `new_enquiry_sla_hours` | Hours before an untouched new opportunity is flagged | `48` |
| `owner_summary_schedule` | `daily` or `weekly` + time | `{"cadence":"daily","hour":19}` — TODO-BD-05 |
| `material_types` | Marble/granite material list for `material_notes` autocomplete | `[]` — TODO-BD-04 |

Read via a cached server helper. **Never hard-code any of these values in application code.**

### 5.11 `import_batches` and `import_rows`

```sql
create table public.import_batches (
  id           uuid primary key default gen_random_uuid(),
  entity       text not null check (entity in ('accounts','contacts','projects','opportunities')),
  file_name    text not null,
  status       import_status not null default 'UPLOADED',
  total_rows   integer not null default 0,
  valid_rows   integer not null default 0,
  warning_rows integer not null default 0,
  error_rows   integer not null default 0,
  imported_rows integer not null default 0,
  uploaded_by  uuid not null references public.users(id),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.import_rows (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.import_batches(id) on delete cascade,
  row_number    integer not null,
  raw           jsonb not null,
  normalized    jsonb,
  status        import_row_status not null default 'VALID',
  messages      jsonb not null default '[]',
  duplicate_of  uuid,
  decision      text check (decision in ('IMPORT','SKIP','LINK_EXISTING')),
  created_entity_id uuid,
  created_at    timestamptz not null default now()
);
create index on public.import_rows (batch_id, status);
create unique index on public.import_rows (batch_id, row_number);
```

### 5.12 Migration order

```
001_extensions_and_helpers   pgcrypto, pg_trgm, normalize_phone(), touch_updated_at()
002_enums                    all enum types
003_users                    users + trigger + handle_new_auth_user()
004_import                   import_batches, import_rows  (referenced by later FKs)
005_accounts                 accounts (contacts FK added in 007)
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

`accounts` and `contacts` are mutually referential; 005 → 006 → 007 breaks the cycle. Do not attempt a single migration for both.

---

## 6. RELATIONSHIPS

| From | To | Cardinality | FK | On delete | Notes |
|---|---|---|---|---|---|
| accounts | users | many→1 | `owner_id` | restrict | Ownership; never null |
| accounts | contacts | 1→many | `contacts.account_id` | set null | Contact survives account archive |
| accounts | contacts | many→1 | `accounts.referred_by_contact_id` | set null | Referral attribution |
| contacts | accounts | many→1 | `linked_account_id` | set null | Contact who is also a customer |
| projects | accounts | many→1 | `account_id` | restrict | The primary buying party |
| project_stakeholders | projects | many→1 | `project_id` | cascade | |
| project_stakeholders | contacts / accounts | many→1 | nullable pair | cascade | At least one required |
| opportunities | accounts | many→1 | `account_id` | restrict | Required |
| opportunities | projects | many→1 | `project_id` | set null | Optional — see §8.5 |
| opportunities | users | many→1 | `owner_id` | restrict | Nullable = unassigned |
| activities | accounts | many→1 | `account_id` | cascade | Always populated |
| activities | opportunities | many→1 | `opportunity_id` | cascade | Optional |
| opportunity_events | opportunities | many→1 | `opportunity_id` | cascade | Append-only |

**One project has many opportunities.** This is the single most important cardinality in the model. Never write code that assumes one opportunity per project.

---

## 7. CONTROLLED VALUES

### 7.1 Enums (structural — code branches on them)

All types in §5.1. Adding a value requires a migration. This is intentional for values that drive logic.

### 7.2 Stage probabilities

Not hard-coded. Read from `system_settings.stage_probabilities`. Used only for weighted pipeline display.

### 7.3 Settings-driven lists (business may extend without a deploy)

`cities` · `material_types` · thresholds. Editable at `/settings` by OWNER and ADMIN. Rendered as a combobox that allows free text with a warning, so a salesperson is never blocked by a missing city — but the entered value is flagged for the admin to normalise.

### 7.4 Product taxonomy

Version 1 has **no product table**. Interest is captured as:
- `opportunities.category` — the `product_category` enum
- `opportunities.material_notes` — free text for marble/granite type, brand, range, finish
- `opportunities.estimated_quantity` + `quantity_unit`

That is sufficient to answer "what is this customer buying?" and to report category demand. **Do not build a SKU catalogue.** See TODO-BD-07.

---

## 8. BUSINESS RULES

Each rule states where it is enforced. Rules enforced in the database cannot be bypassed by a service-layer bug.

### 8.1 Ownership

| Rule | Enforcement |
|---|---|
| Accounts, contacts and projects always have an owner | `not null` |
| Opportunities may be unassigned, which is a visible exception state | nullable + dashboard tile |
| On create via the UI, `owner_id` defaults to the current user | service layer |
| Only MANAGER/OWNER may change `owner_id` | RLS + service |
| Every ownership change is recorded | trigger → `opportunity_events` |
| Reassignment moves the opportunity; **activity history keeps its original `performed_by`** | service layer |
| Deactivating a user does not orphan records; reassignment is a separate explicit action | service + UI warning |

### 8.2 No lead entity

A new enquiry is an `opportunity` at stage `new`, attached to an account created in the same flow. **There is no lead table, no conversion step, and no convert button.** A junk enquiry is closed as `lost` with reason `NOT_GENUINE`; the account remains, harmlessly.

Anything the UI labels "Leads" is a saved filter: `opportunities where stage = 'new'`.

### 8.3 Next action

| Rule | Enforcement |
|---|---|
| `next_action` and `next_action_date` are both set or both null | check constraint |
| An active opportunity **should** have a next action; if it does not, it appears in the "Missing Next Action" exception list | computed query |
| Logging an activity **prompts** for a next action; the user may choose "cannot determine yet" | UI + service |
| Choosing "cannot determine yet" clears both fields and the opportunity surfaces as an exception | service |
| `nurture` stage requires a `next_action_date` | check constraint |

**Deliberate design point:** the application does **not** hard-block activity logging when a next action is unknown. Blocking causes fabricated dates, which is worse than a visible gap. The exception list is the control.

### 8.4 Creation defaults

| Field | Default |
|---|---|
| `accounts.owner_id`, `projects.owner_id`, `opportunities.owner_id` | current user |
| `accounts.status` | `PROSPECT` |
| `opportunities.stage` | `new` |
| `opportunities.title` | auto-generated: `{project name or account name} — {category} — {MMM yy}`, editable |
| `opportunities.expected_close_date` | null (optional in V1) |
| `projects.construction_stage` | `UNKNOWN` |

### 8.5 Project linkage

`opportunities.project_id` is **optional**. A repeat trade order or a small counter-adjacent sale may have no site. The UI encourages but never requires a project.

`TODO-BD-01: whether project linkage should become mandatory for opportunities above a value threshold. Until decided, it stays optional and the dashboard reports the percentage of high-value opportunities with no project.`

### 8.6 Quotations

Lightweight fields on the opportunity: `quotation_ref`, `quotation_date`, `quoted_value`, `quotation_status`, `quotation_valid_until`, plus a PDF in Storage. The quotation document itself is produced in the existing system. **No line items, no pricing engine, no revision table.**

Entering stage `quoted` requires `quotation_ref`, `quotation_date` and `quoted_value` — enforced by check constraint.

### 8.7 Won and lost

| Rule | Enforcement |
|---|---|
| `won` requires `final_order_value` and `closed_at` | check constraint |
| `lost` requires `lost_reason` and `closed_at` | check constraint |
| `won` sets `accounts.status = 'ACTIVE'` | service layer |
| Closing clears `next_action` / `next_action_date` | service layer |
| Won and lost opportunities leave the active pipeline immediately | query filter |
| `lost_reason = 'UNKNOWN'` is permitted but counted as a data-quality metric | dashboard |

### 8.8 Archiving (never deleting)

Archived records: disappear from active lists and dashboards, remain readable and searchable by MANAGER/OWNER/ADMIN, retain all relationships and activities, contribute nothing to pipeline value, and can be restored. Archiving an account does **not** cascade-archive its opportunities — the service layer archives children explicitly and reports what it will archive before doing so.

No role has a `DELETE` policy on any business table.

### 8.9 Duplicate detection — advisory, never automatic

On account create/edit, before saving, the service runs a check and returns matches with a confidence level:

| Signal | Confidence | UI behaviour |
|---|---|---|
| Same `phone_normalized` | **EXACT** | Strong warning, existing record shown with [Open] and [Add opportunity here]. User may still proceed by confirming |
| Same `email_normalized` | **EXACT** | As above |
| `similarity(name) >= 0.6` **and** same city | POSSIBLE | Review warning, list shown, proceeding is one click |
| `similarity(name) >= 0.8`, no city match | POSSIBLE | Review warning |
| Neither | NONE | Save silently |

**Never merge automatically. Never block creation outright.** Merging is a manual MANAGER/OWNER action (§16 `mergeAccounts`), always with a preview and always reversible via the audit trail.

### 8.10 Activity immutability

Editable by the author for 24 hours; immutable thereafter; never deletable. Corrections after 24 hours are appended as a new activity of type `NOTE`.

### 8.11 Money and dates

- All money is `bigint` paise. Rupee conversion happens only at UI and CSV boundaries.
- Display format: Indian grouping, `₹4,20,000`.
- All timestamps `timestamptz`, stored UTC, rendered `Asia/Kolkata`.
- Dates displayed `dd MMM yyyy`; recency shown relatively ("Today", "Overdue by 4 days").

---

## 9. OPPORTUNITY LIFECYCLE

### 9.1 Stage definitions

| Stage | Type | Meaning | Entry requires | Exits when | Next action required |
|---|---|---|---|---|---|
| `new` | active | Enquiry captured, not yet qualified | account + category + estimated_value | Requirement and timeline understood | Yes (prompted) |
| `qualified` | active | Real requirement, real timeline, decision-maker known | — | Customer engages with product | Yes |
| `selection` | active | Customer actively choosing product | — | Shortlist agreed, quotation requested | Yes |
| `quoted` | active | Formal quotation issued | `quotation_ref`, `quotation_date`, `quoted_value` | Customer engages on price/terms | Yes |
| `negotiation` | active | Discussing price, delivery, terms | — | Customer commits verbally | Yes |
| `verbal_confirmation` | active | Customer has said yes; awaiting order/advance | — | Order confirmed | Yes |
| `nurture` | holding | Genuine future business, nothing actionable now | `next_action_date` | Timing arrives | Yes (constraint) |
| `won` | terminal | Order confirmed | `final_order_value`, `closed_at` | — | Cleared |
| `lost` | terminal | Not proceeding with us | `lost_reason`, `closed_at` | — | Cleared |

**There is no `follow_up` stage and there must never be one.** Follow-up is an action, not a pipeline position.

`nurture` is excluded from Pipeline Value everywhere. It exists so that genuine future business is neither faked as active nor destroyed as lost.

### 9.2 Transition matrix

Implemented as a constant map in `lib/opportunity/transitions.ts` and validated in `changeOpportunityStage()`. Any transition not listed is rejected with `INVALID_TRANSITION`.

```
new                  → qualified, nurture, lost
qualified            → selection, quoted, nurture, lost, new
selection            → quoted, negotiation, nurture, lost, qualified
quoted               → negotiation, verbal_confirmation, nurture, lost, selection
negotiation          → verbal_confirmation, won, quoted, nurture, lost
verbal_confirmation  → won, negotiation, nurture, lost
nurture              → qualified, selection, quoted, lost
won                  → (none)
lost                 → new, qualified          [reopen only, MANAGER/OWNER, reason required]
```

Rules:
- Backward moves are permitted where listed and **require a `reason`**, stored on the `opportunity_events` row.
- `won` is final. A mistaken win is corrected by MANAGER/OWNER through `reopenOpportunity()`, which logs a `REOPENED` event; there is no silent edit.
- Skipping forward (e.g. `qualified → quoted`) is allowed because real sales skip stages.
- Every transition writes an `opportunity_events` row via trigger. **Historical stage changes are never deleted or rewritten.**

### 9.3 Side effects by target stage

| Target | Service must |
|---|---|
| `quoted` | Require quotation fields; set `quotation_status = 'SENT'` if currently `NONE` |
| `won` | Require `final_order_value`; set `closed_at`; clear next action; set `accounts.status='ACTIVE'`; **prompt** (never auto-create) the user to add a follow-on opportunity for another category on the same project |
| `lost` | Require `lost_reason`; set `closed_at`; clear next action |
| `nurture` | Require `next_action_date`; warn if under 14 days out |
| any backward | Require `reason` |

---

## 10. ACTIVITY & NEXT ACTION SYSTEM

### 10.1 The two questions

- `activities` answers **what happened** — append-only, immutable, historical.
- `opportunities.next_action` + `next_action_date` answers **what happens next** — mutable, single-valued, always current.

They are deliberately separate and must not be merged. There is no task table in V1.

### 10.2 Logging an activity

`logActivity()` runs in one transaction:

1. Insert the activity. `account_id` is always resolved and populated, even when launched from an opportunity.
2. Update `accounts.last_activity_at` and, when applicable, `opportunities.last_activity_at`.
3. Apply the next-action decision from the same form:
   - a date and type were given → update the opportunity's `next_action` and `next_action_date`
   - "cannot determine yet" → set both to null; opportunity appears in the Missing Next Action list
   - opportunity is closed → no next action fields are touched
4. Return the updated opportunity so the UI can refresh without a second round-trip.

**Context inference — the salesperson never chooses foreign keys.** Launching from an opportunity pre-fills account, project and opportunity. Launching from a project pre-fills account and project, and offers that project's open opportunities as an optional chip selection. Launching from an account pre-fills the account and offers its open opportunities.

### 10.3 Derived accountability states

Computed in SQL, never stored. Define once as a view or shared query builder.

```sql
create view public.v_opportunity_flags as
select o.*,
  (o.stage not in ('won','lost'))                                as is_active,
  (o.stage not in ('won','lost','nurture'))                      as in_pipeline,
  (o.stage not in ('won','lost') and o.next_action_date < current_date)  as is_overdue,
  (o.stage not in ('won','lost') and o.next_action_date = current_date)  as is_due_today,
  (o.stage not in ('won','lost') and o.next_action_date is null)         as is_missing_next_action,
  (o.owner_id is null and o.stage not in ('won','lost'))                 as is_unassigned,
  (current_date - o.stage_changed_at::date)                      as days_in_stage,
  (current_date - coalesce(o.last_activity_at, o.created_at)::date) as days_since_activity
from public.opportunities o
where o.archived_at is null;
```

The view inherits RLS from the underlying table when created with `security_invoker = true`. **Set that option explicitly** — a default view would bypass row-level security.

Dormancy and stall thresholds come from `system_settings`, applied in the query layer rather than baked into the view.

---

## 11. USER FLOWS

Format: **Input → Validation → Database → UI result → Errors.**

### 11.1 New customer + opportunity (the primary mobile flow, target 60 seconds)

**Input:** phone*, name*, account_type*, category*, estimated_value*, next_action_date*, next_action type*, notes.

**Validation:** phone normalises to 10 digits starting 6–9 (or is empty with an email present); name ≥ 2 chars; estimated_value ≥ 0; next_action_date ≥ today. On phone blur, `checkDuplicates()` runs and renders any matches inline.

**Database (one transaction):** insert `accounts` (owner = current user, status `PROSPECT`) → insert `opportunities` (stage `new`, owner = current user, title auto-generated) → insert `activities` (type `NOTE`, purpose `ENQUIRY`, summary = notes or "Enquiry captured") → trigger writes `opportunity_events.CREATED`.

**UI:** redirect to the account page with a success toast and the new opportunity visible.

**Errors:** duplicate exact → warning card with [Open existing] / [Add opportunity to existing] / [Create anyway]; validation → inline field errors, no data loss; network → form state retained, retry offered.

**No project is created here.** Projects are added when site details are known.

### 11.2 Existing customer + new project

**Input:** name*, project_type*, construction_stage, site address, city, area, builtup_area_sqft, floors, bathrooms, expected_flooring_date, estimated_value, notes. Optional stakeholders section.

**Database:** insert `projects` (account from context, owner inherits account owner) → insert any inline-created `contacts` → insert `project_stakeholders`.

**UI:** project detail page. **Errors:** at most one primary stakeholder (DB partial unique index returns a friendly error).

### 11.3 Existing project + new opportunity

**Input:** category*, estimated_value*, quantity + unit, material_notes, expected_close_date, next_action + date.
**Database:** insert `opportunities` with `project_id` and `account_id` from context.
**UI:** the project detail page now lists two or more opportunities — verify this visually; it is the model's key behaviour.

### 11.4 Add stakeholder

**Input:** search existing contacts by name/phone, or create inline (name*, phone*, role*, influence). Optionally link an account (e.g. Rahul Constructions).
**Validation:** role required; only one `is_primary` per project.
**Database:** insert `contacts` if new, then `project_stakeholders`.
**UI:** stakeholder chips with role labels. The word "stakeholder" appears in the UI as **"People on this project"**.

### 11.5 Log activity — 3 taps

Bottom sheet: type (icon row) → outcome (chips) → summary (text/voice) → "What's next?" (Tomorrow / 3 days / 1 week / Pick date / Can't say yet). Purpose defaults from type and is collapsed.
For `SITE_VISIT`: measurements, location note and photo upload appear.
**Database:** §10.2. **Errors:** summary under 3 characters blocked; upload failure does not block the activity — the activity saves and the upload retries.

### 11.6 Update next action

Inline on the opportunity: quick-date buttons + type. Writes only the two fields plus `updated_at`. If the opportunity is closed, the control is hidden.

### 11.7 Change stage

Stage control → target stage → modal collecting fields required by §9.3 → `changeOpportunityStage()` validates against the transition matrix → update + trigger writes the event.
**Errors:** invalid transition (should be unreachable from the UI, but the service rejects it); missing required field; check-constraint violation mapped to a friendly message.

### 11.8 Mark won / lost

**Won:** modal requires `final_order_value`; optional `order_reference` (free text, the reference used in the accounting system). Service sets `closed_at`, clears next action, sets `accounts.status='ACTIVE'`, and creates an activity of purpose `ORDER_CONFIRMATION`. It then prompts — never auto-creates — a follow-on opportunity for another category on the same project.

**Lost:** modal requires `lost_reason`; optional `lost_detail` and `competitor`. Service sets `closed_at` and clears next action.

Both write an `opportunity_events` row via trigger (`WON` / `LOST`). Both are blocked by check constraint if the required field is missing, so a service-layer bug cannot produce an invalid closed record.

### 11.9 Assign / reassign

MANAGER/OWNER only. Single: opportunity → Reassign → user + reason*. Bulk: `/team/:userId` → Reassign all → preview counts → target user + reason* → confirm.
**Database:** update `owner_id`; trigger logs `OWNER_CHANGED`; the reason is written by the service into the event row.
**Activities keep their original `performed_by`.** History is never rewritten.

### 11.10 Search

Single input, permission-scoped. Order: exact `phone_normalized` on accounts and contacts → trigram on account name → trigram on project name → opportunity title → trigram on contact name. Minimum 3 characters; a numeric query of 4+ digits is treated as a phone fragment. Results grouped by entity with type badges.

### 11.11 Import historical customers

`Upload → Validate → Preview → Duplicate analysis → Admin review (per-row decision) → Import → Result summary`. Full specification in §20.

---

## 12. SCREENS & UX

### 12.1 Design direction

Clean, calm, business-like. High contrast, large touch targets, no decorative imagery. Salesperson screens optimise for **speed**; manager screens for **density**.

- Type: Inter or system stack. 16px base on mobile. Tabular numerals for money.
- Colour: neutral greys; one accent for primary actions; semantic colour only for state — red overdue/lost, amber at-risk, green won/positive, blue active. **Never colour alone** — always pair with icon or label.
- Progressive disclosure: create forms show 6–7 fields; everything else is added from the detail page afterwards.

### 12.2 Route map

| Route | Roles | Purpose |
|---|---|---|
| `/login` | public | Email + password |
| `/` | all | Redirect: SALESPERSON → `/today`, others → `/dashboard` |
| `/today` | all | Salesperson home: overdue, due today, upcoming, missing next action, quick actions |
| `/dashboard` | MANAGER, OWNER | §13.2 / §13.3 |
| `/accounts` | all | List + search + filters (labelled **Customers** in the UI) |
| `/accounts/new` · `/accounts/:id` · `/accounts/:id/edit` | all | Customer 360 at `:id` |
| `/contacts` · `/contacts/:id` | all | Secondary navigation |
| `/projects` · `/projects/new` · `/projects/:id` | all | Filters: construction stage, city, status |
| `/opportunities` | all | List, default "my active", stage filter |
| `/opportunities/board` | all | Kanban by stage — **desktop ≥1024px only** |
| `/opportunities/:id` | all | Detail: stage control, next action, timeline, quotation, stakeholders |
| `/team` · `/team/:userId` | MANAGER, OWNER | Workload, per-person exceptions, bulk reassign |
| `/reports` | MANAGER, OWNER | Pipeline, win rate, lost reasons, dormancy, category mix |
| `/import` | OWNER, ADMIN | §20 wizard |
| `/settings` · `/settings/users` | OWNER, ADMIN | Controlled values, thresholds, users |
| `/archive` | MANAGER, OWNER, ADMIN | Archived records, restore |
| `/search?q=` | all | Global results |

### 12.3 Navigation

**Mobile (<768px):** bottom tab bar — `Today` · `Customers` · `[+]` (raised centre) · `Pipeline` · `More`. The `+` sheet: New Customer · New Opportunity · Log Activity · Site Visit · Update Next Action.

**Desktop (≥1024px):** left sidebar — Dashboard · Today · Customers · Contacts · Projects · Opportunities · Team* · Reports* · Import* · Settings* (*role-gated; hidden, not disabled). Top bar: search, user menu.

### 12.4 Customer 360 (`/accounts/:id`) — the most-used screen

```
┌──────────────────────────────────────────────┐
│ MR JAIN                        [Call][WhatsApp]│  sticky on mobile
│ Homeowner · Erode · Owner: Jay                 │
│ ⚠ Next action: Quotation follow-up — TODAY     │  red when overdue
├──────────────────────────────────────────────┤
│ Won ₹4,20,000 │ Pipeline ₹3,75,000 │ Last 3d  │
├──────────────────────────────────────────────┤
│ OPEN OPPORTUNITIES (2)              [+ Add]   │
│  Bathroom tiles · Negotiation · ₹95,000 · 12d │
│  Sanitaryware   · New        · ₹2,80,000      │
├──────────────────────────────────────────────┤
│ RECENT ACTIVITY (3)          [Log Activity]   │
├──────────────────────────────────────────────┤
│ [Projects][People][All activity][Files][Details]│
└──────────────────────────────────────────────┘
```

Exactly three activities above the fold. Address, GSTIN, source and audit fields live in the Details tab.

### 12.5 Component inventory

Build once, reuse: `RecordCard`, `DataTable`, `StageBadge`, `NextActionChip` (red when overdue, "Set next action" when missing), `MoneyText`, `PhoneActions` (tap-to-call, `https://wa.me/91{phone}`), `ActivityTimeline`, `QuickDateButtons`, `DuplicateWarning`, `FilterBar` (state in URL params), `EmptyState`, `ConfirmDialog`, `StakeholderChips`.

### 12.6 States — required on every list and form

| State | Requirement |
|---|---|
| Loading | Skeletons matching final layout. Never a full-page spinner. Dashboard tiles load independently |
| Empty (no data) | Explanation + primary action: "No customers yet. [+ Add customer]" |
| Empty (filtered) | Different copy + [Clear filters] |
| Error | Plain language + [Try again]. Never a Postgres message or stack trace |
| Forbidden | "You don't have access to this record." Never confirm existence |
| Offline | Banner; block submission rather than fail silently |
| Saving | Disabled button + spinner. No optimistic UI in V1 |

### 12.7 Forms

Single column always. Validate on blur. Errors inline, plain language. **Never lose entered data** on validation or network failure. No multi-step wizards except the import flow.

### 12.8 Performance targets

`/today` interactive under 1.5s on 4G · any list query under 400ms server-side · pagination 25 mobile / 50 desktop · **no unbounded list query anywhere**.

---

## 13. DASHBOARDS

Every metric below has an exact definition. Implement each as a named function in `services/dashboard.service.ts` so it is unit-testable against seeded data.

### 13.1 Metric definitions

| Metric | Definition |
|---|---|
| **Pipeline Value** | `sum(estimated_value)` where `stage not in ('won','lost','nurture')` and not archived |
| **Weighted Pipeline** | `sum(estimated_value × stage_probability ÷ 100)` over the same set |
| **Won Value** | `sum(final_order_value)` where `stage='won'` and `closed_at` in period |
| **Lost Value** | `sum(estimated_value)` where `stage='lost'` and `closed_at` in period |
| **Win Rate** | `count(won) ÷ (count(won) + count(lost))` over opportunities closed in period. Null when the denominator is 0 — display "—", never 0% |
| **Overdue** | active and `next_action_date < current_date` |
| **Due Today** | active and `next_action_date = current_date` |
| **Upcoming** | active and `next_action_date between tomorrow and +7 days` |
| **Missing Next Action** | active and `next_action_date is null` |
| **Unassigned** | active and `owner_id is null` |
| **Dormant** | active and `days_since_activity > system_settings.dormancy_days` |
| **Stalled** | active and `days_in_stage > stage_stall_days[stage]` |
| **New enquiry SLA breach** | `stage='new'` and `created_at < now() - new_enquiry_sla_hours` |
| **Average Opportunity Value** | `Won Value ÷ count(won)` in period |

**No metric depends on accounting data.** The word "revenue" appears nowhere.

### 13.2 Salesperson — `/today`

A work queue, not analytics. All tiles scoped to `owner_id = current user` by RLS.

| Order | Tile | Query | Display |
|---|---|---|---|
| 1 | **Overdue** | Overdue, oldest first | Red count + list |
| 2 | **Due today** | Due Today | Count + list |
| 3 | **Upcoming (7 days)** | Upcoming | Count, collapsed |
| 4 | **Missing next action** | Missing Next Action | Amber count + list |
| 5 | **New enquiries to contact** | SLA breach, mine | Amber count |
| 6 | **My pipeline** | Pipeline Value, mine | Single number |
| 7 | **Won this month** | count + Won Value, mine | Number |

Each list row shows: customer name, category, value, stage badge, next-action chip. Tapping opens the opportunity.

Quick actions below the tiles: `[+ New Customer]` `[Log Activity]`. Nothing else.

**Not shown to salespeople:** other people's numbers, team totals, win rate, leaderboards.

### 13.3 Manager — `/dashboard`

**Panel A — Exceptions (top, always).** Each links to a filtered list. These are the daily review.

| Tile | Query | Target |
|---|---|---|
| Unassigned opportunities | Unassigned | 0 |
| Overdue, by salesperson | Overdue grouped by owner | 0 |
| Missing next action | Missing Next Action | 0 |
| New enquiries breaching SLA | SLA breach | 0 |
| High-value at risk | `estimated_value > high_value_threshold` and (Overdue or Stalled) | 0 |
| Stalled opportunities | Stalled | <10% of pipeline |
| Dormant opportunities | Dormant | trending down |
| Quotations past validity | `quotation_valid_until < today`, stage active | 0 |

**Panel B — Team workload**

| Tile | Query | Visual |
|---|---|---|
| Pipeline by salesperson | Pipeline Value grouped by owner | Bar |
| Active opportunity count by salesperson | count active grouped by owner | Bar |
| Overdue count by salesperson | Overdue grouped by owner | Bar (red) |
| Activity count, last 7 days | `count(activities)` grouped by `performed_by` | Bar |
| Won this month by salesperson | count + Won Value | Table |
| Win rate by salesperson | Win Rate grouped by owner, last 90 days | Table |

**Panel C — Pipeline health**

Pipeline by stage (count + value, excluding nurture) · Weighted Pipeline · Expected closes this month · Lost reasons last 90 days (bar) · Category mix of active pipeline.

### 13.4 Owner — `/dashboard` (OWNER role)

Deliberately small. **Do not add tiles.**

| Block | Content |
|---|---|
| This month | Won count + Won Value · Lost count · Win Rate · New opportunities created |
| Pipeline | Pipeline Value · Weighted Pipeline · count active |
| Trend | Won Value by month, last 12 months — one line chart |
| Needs attention | Max 5 lines: unassigned count, high-value at risk count, any salesperson with >10 overdue |
| Top lost reasons | Top 3 this month with counts |

Optional scheduled email summary (§14.4).

---

## 14. AUTOMATIONS

Seven automations. Each is specified as **Trigger → Condition → Action → Recipient → Frequency → Failure behaviour**. Nothing else is automated in V1.

Most "automations" in this system are **computed exception views**, not background jobs — that is deliberate. Only genuinely time-based notifications need a job.

### 14.1 In-app exception surfacing (no job)

| ID | Trigger | Condition | Action | Recipient | Frequency | Failure |
|---|---|---|---|---|---|---|
| A1 | Page load | Overdue / Due Today / Missing Next Action / Unassigned / Dormant / Stalled | Render the tile | Salesperson (own) / Manager (all) | On demand | Tile shows error state; page still renders |

### 14.2 New opportunity reminder

| | |
|---|---|
| **Trigger** | Cron, hourly |
| **Condition** | `stage='new'`, active, `created_at < now() - new_enquiry_sla_hours`, not yet notified |
| **Action** | Email the owner; if unassigned, email the manager |
| **Recipient** | Owner, else Manager |
| **Frequency** | Once per opportunity (deduplicated by a `notified_new_sla` key in the event metadata) |
| **Failure** | Log and retry next hour. Never block, never crash the cron route |

### 14.3 Daily salesperson digest

| | |
|---|---|
| **Trigger** | Cron, 08:30 IST daily |
| **Condition** | Active user with at least one overdue, due-today, or missing-next-action opportunity |
| **Action** | One email: overdue list, today's list, missing-next-action list |
| **Recipient** | Each salesperson individually. **Never a group email** |
| **Frequency** | Daily; skipped entirely when all three lists are empty |
| **Failure** | Log per-user failure, continue with remaining users, report count in the cron response |

### 14.4 Manager exception digest

| | |
|---|---|
| **Trigger** | Cron, 09:00 IST daily |
| **Condition** | Any Panel A tile is non-zero |
| **Action** | One email grouped by salesperson: unassigned, overdue, missing next action, high-value at risk |
| **Recipient** | MANAGER (and OWNER if no manager exists) |
| **Frequency** | Daily |
| **Failure** | As above |

### 14.5 Owner summary

| | |
|---|---|
| **Trigger** | Cron, per `system_settings.owner_summary_schedule` |
| **Condition** | Always |
| **Action** | Email matching §13.4 exactly — max 10 lines |
| **Recipient** | OWNER |
| **Frequency** | Daily 19:00 or weekly — TODO-BD-05 |
| **Failure** | Log; no retry (a stale summary is worse than none) |

### 14.6 Nightly maintenance

| | |
|---|---|
| **Trigger** | Cron, 02:00 IST |
| **Condition** | Always |
| **Action** | (1) Set `accounts.status='DORMANT'` where no activity beyond threshold and status is `ACTIVE`/`PROSPECT`; (2) set `quotation_status='EXPIRED'` where `quotation_valid_until < today` and status in `SENT`/`UNDER_DISCUSSION`; (3) recompute `accounts.last_activity_at` and `opportunities.last_activity_at` and **log any row it had to correct** |
| **Recipient** | — |
| **Frequency** | Nightly |
| **Failure** | Log; alert the OWNER by email if the job fails twice consecutively |

A non-zero correction count in step 3 indicates a bug in a write path. **Do not suppress that log.**

### 14.7 Cron security

All cron endpoints live at `/api/cron/*`, require a `CRON_SECRET` bearer token, use the Supabase **service-role** client, and are excluded from the public sitemap. They return a JSON summary `{ processed, sent, failed, durationMs }`.

### 14.8 Explicitly not automated

Auto-assignment of opportunities · auto-closing stale opportunities · auto-merging duplicates · auto-reassignment on inactivity · any message to a customer · per-event notifications on create/edit.

---

## 15. SECURITY / RLS

RLS is the security boundary. **Frontend filtering is not a control.** Every table has RLS enabled and a policy for each operation; no table relies on a default-deny with no policy for reads it needs.

### 15.1 Role resolution without recursion

A policy that reads `public.users` to find the caller's role will recurse when applied to `public.users` itself. Solve with a `SECURITY DEFINER` function:

```sql
create or replace function public.user_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid() and is_active
$$;

create or replace function public.is_manager_or_above() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.user_role() in ('MANAGER','OWNER','ADMIN'), false)
$$;

create or replace function public.is_owner_or_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.user_role() in ('OWNER','ADMIN'), false)
$$;

-- work-context read: does the caller own an opportunity on this account / project?
create or replace function public.owns_opportunity_on_account(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.opportunities o
                 where o.account_id = a and o.owner_id = auth.uid())
$$;

create or replace function public.owns_opportunity_on_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.opportunities o
                 where o.project_id = p and o.owner_id = auth.uid())
$$;
```

Revoke `execute` from `anon`; grant to `authenticated`.

### 15.2 Policy pattern

For each table: `SELECT`, `INSERT`, `UPDATE`. **No `DELETE` policy on any business table for any role.**

### 15.3 `users`

```sql
alter table public.users enable row level security;

create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or public.is_manager_or_above());

create policy users_update_self on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = public.user_role());

create policy users_admin_all on public.users for all to authenticated
  using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());
```

The `with check (role = public.user_role())` clause prevents self-escalation: a salesperson editing their own profile cannot change their role.

### 15.4 `accounts` (the pattern all business tables follow)

```sql
alter table public.accounts enable row level security;

create policy accounts_select on public.accounts for select to authenticated
  using (
    public.is_manager_or_above()
    or owner_id = auth.uid()
    or public.owns_opportunity_on_account(id)
  );

create policy accounts_insert on public.accounts for insert to authenticated
  with check (owner_id = auth.uid() or public.is_manager_or_above());

create policy accounts_update on public.accounts for update to authenticated
  using (public.is_manager_or_above() or owner_id = auth.uid())
  with check (
    public.is_manager_or_above()
    or (owner_id = auth.uid())        -- salesperson cannot reassign away or to self from others
  );
```

Reassignment is therefore impossible for a salesperson: changing `owner_id` to another user fails the `with check`.

### 15.5 Policy summary for remaining tables

| Table | SELECT | INSERT | UPDATE |
|---|---|---|---|
| `contacts` | manager+ · own · contact of an account the caller can see | owner = self, or manager+ | manager+ or own |
| `projects` | manager+ · own · `owns_opportunity_on_project(id)` | owner = self, or manager+ | manager+ or own |
| `project_stakeholders` | caller can see the parent project | caller can update the parent project | same |
| `opportunities` | manager+ · `owner_id = auth.uid()` | `owner_id = auth.uid()` or manager+ | manager+ (any field) · own (any field **except** `owner_id`) |
| `activities` | caller can see the parent account | `performed_by = auth.uid()`, and caller can see the account | author only, and `created_at > now() - 24h` |
| `opportunity_events` | caller can see the parent opportunity | service-role and triggers only | none |
| `system_settings` | all authenticated (read) | owner/admin | owner/admin |
| `import_batches` / `import_rows` | owner/admin | owner/admin | owner/admin |

For `opportunities` UPDATE, express "except owner_id" as:

```sql
with check (
  public.is_manager_or_above()
  or (owner_id = auth.uid() and owner_id = (select o.owner_id from public.opportunities o where o.id = id))
)
```

If that proves awkward, implement reassignment exclusively through a `SECURITY DEFINER` RPC (`reassign_opportunity`) that checks the role itself, and deny `owner_id` changes in the table policy entirely. **Prefer the RPC — it is easier to test and audit.**

### 15.6 Storage

Bucket `crm-files`, private. Path convention `{entity_type}/{entity_id}/{uuid}-{filename}`.
Policies: authenticated users may `INSERT`; `SELECT` requires visibility of the parent entity, checked by a policy function that parses the path prefix. No public URLs — serve via signed URLs with a 60-second expiry.
Validation: max 10 MB, MIME allow-list (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`), verified by magic bytes server-side, not by extension.

### 15.7 Client keys

- **Anon key** — browser and server components acting as the user. RLS applies. Safe to expose.
- **Service-role key** — cron routes and the import executor only. **Never imported into any file under `app/` that ships to the client.** Enforce with a lint rule or a runtime guard in `lib/supabase/admin.ts` that throws if `typeof window !== 'undefined'`.

### 15.8 Additional controls

Passwords via Supabase Auth (no custom hashing) · session in httpOnly cookies via `@supabase/ssr` · rate-limit login attempts · all mutations validated server-side with Zod regardless of client validation · no raw SQL string interpolation · security headers (CSP, HSTS, X-Frame-Options DENY, nosniff) · never log tokens, keys or full request bodies containing personal data.

---

## 16. API / SERVICES

All business logic lives in `src/services/*`. Server Actions and route handlers only: authenticate → validate with Zod → call a service → map errors. **No business rule is duplicated in a component.**

### 16.1 Service signatures

```ts
// accounts
createAccount(input: CreateAccountInput): Promise<Account>
updateAccount(id: string, input: UpdateAccountInput): Promise<Account>
archiveAccount(id: string, reason?: string): Promise<void>
restoreAccount(id: string): Promise<void>
checkDuplicates(input: { phone?, email?, name?, city? }): Promise<DuplicateMatch[]>
mergeAccounts(survivorId: string, mergedId: string): Promise<MergeResult>   // MANAGER/OWNER
searchAccounts(q: string, filters?): Promise<AccountSearchResult[]>
getAccount360(id: string): Promise<Account360>

// contacts
createContact(input): Promise<Contact>
updateContact(id, input): Promise<Contact>
archiveContact(id): Promise<void>

// projects
createProject(input): Promise<Project>
updateProject(id, input): Promise<Project>
archiveProject(id): Promise<void>
addProjectStakeholder(projectId, input): Promise<ProjectStakeholder>
removeProjectStakeholder(stakeholderId): Promise<void>
setPrimaryStakeholder(projectId, stakeholderId): Promise<void>

// opportunities
createOpportunity(input): Promise<Opportunity>
updateOpportunity(id, input): Promise<Opportunity>
changeOpportunityStage(id, toStage, payload, reason?): Promise<Opportunity>
markOpportunityWon(id, { finalOrderValue, orderReference? }): Promise<Opportunity>
markOpportunityLost(id, { lostReason, lostDetail?, competitor? }): Promise<Opportunity>
reopenOpportunity(id, reason): Promise<Opportunity>          // MANAGER/OWNER
assignOpportunity(id, userId, reason?): Promise<Opportunity> // MANAGER/OWNER
reassignOpportunity(id, userId, reason): Promise<Opportunity>// MANAGER/OWNER
bulkReassign(fromUserId, toUserId, reason): Promise<BulkResult> // MANAGER/OWNER
updateNextAction(id, { nextAction, nextActionDate } | null): Promise<Opportunity>
archiveOpportunity(id, reason?): Promise<void>

// activities
logActivity(input): Promise<{ activity: Activity; opportunity?: Opportunity }>
updateActivity(id, input): Promise<Activity>   // author, <24h
listTimeline(accountId, opts): Promise<Activity[]>

// dashboards
getSalespersonDashboard(userId): Promise<SalespersonDashboard>
getManagerDashboard(filters): Promise<ManagerDashboard>
getOwnerDashboard(period): Promise<OwnerDashboard>
getTeamWorkload(): Promise<TeamWorkload[]>

// import
createImportBatch(entity, file): Promise<ImportBatch>
validateImportBatch(batchId): Promise<ImportBatch>
analyzeImportDuplicates(batchId): Promise<ImportBatch>
setImportRowDecision(rowId, decision): Promise<ImportRow>
executeImport(batchId): Promise<ImportResult>
rollbackImport(batchId): Promise<void>        // OWNER, within 7 days

// settings
getSettings(): Promise<Settings>
updateSetting(key, value): Promise<void>      // OWNER/ADMIN
```

### 16.2 Error contract

Services throw a typed `AppError { code, message, field?, details? }`. Codes: `VALIDATION_FAILED` · `NOT_FOUND` · `FORBIDDEN` · `INVALID_TRANSITION` · `DUPLICATE_WARNING` · `CONSTRAINT_VIOLATION` · `CONFLICT` · `INTERNAL`.

Postgres check-constraint violations are caught and mapped to friendly messages by constraint name — e.g. `won_requires_value` → "Enter the confirmed order value before marking this won." A raw database error must never reach the UI.

### 16.3 Transactions

Multi-table writes use a Postgres RPC (`SECURITY INVOKER`, so RLS still applies) rather than sequential client calls. Required for: `createAccountWithOpportunity`, `logActivity` (activity + last_activity_at + next action), `changeOpportunityStage`, `bulkReassign`, `executeImport`.

### 16.4 Integration interfaces — declare, do not implement

```ts
// src/services/integrations/types.ts
export interface AccountingIntegration {  isEnabled(): boolean; }
export interface InventoryIntegration  {  isEnabled(): boolean; }
export interface WhatsAppIntegration   {  isEnabled(): boolean; buildDeepLink(phone: string, text?: string): string; }
export interface NotificationService   {  sendEmail(to: string, subject: string, html: string): Promise<void>; }
```

Only `WhatsAppIntegration.buildDeepLink` and `NotificationService.sendEmail` have implementations in V1. The other interfaces exist as type declarations with no implementation and no stub. **Do not write fake adapters.**

---

## 17. TECHNICAL ARCHITECTURE

### 17.1 Stack — chosen and frozen

| Layer | Choice | Reason |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript strict** | One codebase; Server Components keep mobile JS small |
| Database | **Supabase Postgres** | RLS is the permission model; managed backups |
| Auth | **Supabase Auth** (email + password) | No custom crypto; integrates with RLS via `auth.uid()` |
| Data access | `@supabase/ssr` server client with user session | RLS enforced on every query automatically |
| UI | **Tailwind CSS + shadcn/ui + lucide-react** | Components owned in-repo |
| Validation | **Zod**, schemas shared client/server | One definition |
| Forms | react-hook-form + zodResolver | |
| Client state | TanStack Query (lists/filters only) | No Redux, no Zustand |
| Charts | Recharts | Four chart types needed |
| Dates | date-fns, `Asia/Kolkata` | |
| Storage | Supabase Storage, private bucket | |
| Email | Resend behind `NotificationService` | Swappable |
| Cron | Vercel Cron → `/api/cron/*` | No queue infrastructure at this scale |
| Hosting | Vercel + Supabase | TODO-BD-08 (data residency) |
| Testing | Vitest + Playwright | |

**Rejected:** microservices, GraphQL, Redis, message queues, a separate API server, a native mobile app, real-time subscriptions, state-management libraries.

If a change to this stack becomes necessary, record it in `/docs/DECISIONS.md` with the reason **before** implementing it.

### 17.2 Rendering strategy

Server Components for reads (dashboards, detail pages, lists). Client Components for forms, filters and the activity sheet. Mutations through Server Actions calling services. No client-side Supabase writes.

### 17.3 Money and dates

`bigint` paise in the database; `number` in TypeScript is unsafe above 2^53 but adequate here (₹90,000 crore ceiling) — still, parse as `string` from Supabase and convert explicitly in `lib/money.ts`. **Never `parseFloat` a rupee string.** All formatting via `MoneyText`.

### 17.4 Environment variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY      # server only, never in a client bundle
DATABASE_URL                   # migrations only
RESEND_API_KEY
CRON_SECRET
NEXT_PUBLIC_APP_URL
TZ=Asia/Kolkata
```

`.env.local` for development, platform secrets for production. **Nothing hard-coded.** `.env.example` documents every variable; it is committed, `.env.local` is not.

### 17.5 Storage convention

`crm-files/{account|project|opportunity|activity}/{id}/{uuid}-{filename}`. Signed URLs only, 60-second expiry, no public bucket.

### 17.6 Future-proofing already in the schema

`branch` columns (multi-branch later) · `order_reference` (accounting handoff) · `is_imported` / `legacy_ref` / `import_batch_id` (migration lineage) · append-only `activities` and `opportunity_events` with structured outcomes (future analysis). **Nothing further is added "for the future."**

---

## 18. REPOSITORY STRUCTURE

```
/
├─ CLAUDE_CODE_BUILD_SPEC.md      this file — the source of truth
├─ README.md
├─ .env.example
├─ /docs
│   PRODUCT_REQUIREMENTS.md  DATABASE.md  ARCHITECTURE.md  PERMISSIONS.md
│   API.md  TESTING.md  DECISIONS.md  SETUP.md  DEPLOYMENT.md
├─ /supabase
│   /migrations                    001_… 017_… (§5.12)
│   /seed                          seed.sql, dev-fixtures.sql
│   config.toml
├─ /src
│   ├─ /app
│   │   /(auth)/login
│   │   /(app)/today  /dashboard  /accounts  /contacts  /projects
│   │           /opportunities  /team  /reports  /import  /settings  /archive  /search
│   │   /api/cron/{new-opportunity-sla,daily-digest,manager-digest,owner-summary,maintenance}
│   │   layout.tsx  globals.css
│   ├─ /components
│   │   /ui                        shadcn primitives
│   │   /shared                    RecordCard, DataTable, StageBadge, MoneyText, …
│   │   /layout                    AppShell, BottomNav, Sidebar
│   ├─ /features                   feature modules: components + hooks + schemas
│   │   /accounts /contacts /projects /opportunities /activities /dashboard /import
│   ├─ /services                   ALL business logic
│   │   account.service.ts  contact.service.ts  project.service.ts
│   │   opportunity.service.ts  activity.service.ts  dashboard.service.ts
│   │   import.service.ts  settings.service.ts  /integrations
│   ├─ /lib
│   │   /supabase                  client.ts  server.ts  admin.ts
│   │   money.ts  phone.ts  dates.ts  errors.ts  permissions.ts
│   ├─ /types                      database.types.ts (generated), domain.ts
│   └─ /hooks
└─ /tests
    /unit  /integration  /e2e
```

**Rule:** a feature folder may import from `services`, `lib`, `components/ui` and `components/shared`. A feature folder must **never** import from another feature folder. Shared needs move to `components/shared` or `services`.

---

## 19. TESTING STRATEGY

### 19.1 Unit (Vitest) — pure logic, no database

Phone normalisation (including `+91`, `0`, spaces, dashes, invalid input) · money formatting and paise conversion · stage transition matrix (every valid and invalid pair) · duplicate confidence scoring · dashboard metric functions against fixture arrays · date/overdue calculations across timezone boundaries.

### 19.2 Integration (Vitest + local Supabase) — database and RLS

Run against `supabase start` with seeded users of each role. **These are the most important tests in the project.**

- Check constraints reject: won without value, lost without reason, quoted without quotation ref, next-action pairing, nurture without date
- Trigger writes an `opportunity_events` row on every stage and owner change
- Partial unique index rejects a second primary stakeholder
- RLS: salesperson A cannot SELECT, UPDATE or INSERT-on-behalf-of salesperson B's records
- RLS: salesperson can read an account they don't own when they own an opportunity on it
- RLS: salesperson cannot change `owner_id`
- RLS: no role can DELETE from any business table
- RLS: a salesperson cannot escalate their own role
- Archived records are excluded from active queries and included in archive queries for authorised roles

### 19.3 End-to-end (Playwright) — the fifteen required scenarios

1. Salesperson creates a customer
2. Salesperson creates a project
3. Salesperson adds a stakeholder
4. Salesperson creates an opportunity on that project
5. Salesperson logs an activity
6. Next action updates correctly and appears in Due Today
7. Manager sees the opportunity in the team view
8. Manager reassigns it to another salesperson
9. Previous owner loses access (404 on direct URL)
10. Opportunity moves through valid stages; an invalid transition is rejected
11. Marking lost requires a reason
12. Marking won stores the final value and clears next action
13. Salesperson cannot access another salesperson's opportunity via direct URL **or via a direct Supabase query from the browser console**
14. CSV import detects duplicates and honours per-row decisions
15. The full mobile workflow at 375×812 completes in under 60 seconds

### 19.4 Security tests (§45 of the source brief — mandatory)

Direct PostgREST calls with salesperson credentials attempting cross-user reads · role escalation via profile update · service-role key absent from the client bundle (grep the build output) · Storage object access without entity visibility · unauthenticated access to every route · session expiry handling · file upload of a disguised executable · SQL injection attempts through search input.

**A hidden button is never a control. Every security test must attack the API, not the UI.**

### 19.5 Coverage expectations

Services and RLS: high and meaningful. UI components: only where logic exists. **Do not chase a coverage percentage** — the fifteen E2E scenarios plus the RLS integration suite are the real gate.

---

## 20. IMPORT / MIGRATION

**The historical books are still on paper.** Build the capability; assume no file exists yet.

### 20.1 Flow

```
Upload CSV → Validate → Preview → Duplicate analysis → Admin review (per-row decision)
→ Import → Result summary → (Rollback available 7 days)
```

Roles: OWNER and ADMIN only. Max 5 MB, max 5,000 rows per batch.

### 20.2 V1 templates

**accounts.csv** — `name*`, `account_type*`, `phone`, `email`, `address`, `city`, `area`, `source`, `owner_email*`, `status`, `notes`, `legacy_ref`
(at least one of `phone` or `email` required)

**contacts.csv** — `full_name*`, `phone`, `email`, `account_phone` *(links to an existing account)*, `role`, `influence`, `is_referral_source`, `notes`, `legacy_ref`

Projects and opportunities templates are **designed but not built in V1** — the `entity` column on `import_batches` already accepts them and `import_rows.raw` is jsonb, so adding them later requires no schema change.

### 20.3 Validation rules

| Rule | Result |
|---|---|
| Required column missing/empty | ERROR |
| Phone does not normalise to 10 digits starting 6–9 | ERROR |
| Neither phone nor email present | ERROR |
| Enum value unrecognised (case/space/underscore tolerant) | ERROR listing valid values |
| `owner_email` does not match an active user | ERROR |
| `account_phone` does not resolve | ERROR |
| Unknown city (not in `system_settings.cities`) | WARNING — imports, flagged for normalisation |
| Duplicate phone/email **within the file** | ERROR — deduplicate the file first |
| Matches an existing record | DUPLICATE_EXACT or DUPLICATE_POSSIBLE — requires a decision |

### 20.4 Duplicate decisions

Per row, the reviewer chooses `IMPORT` (create anyway), `SKIP`, or `LINK_EXISTING` (discard the row and record `legacy_ref` on the existing record). **Never overwrite an existing record's fields. Never merge automatically.** Rows in `DUPLICATE_*` status with no decision block execution.

### 20.5 Execution

Runs in one transaction per batch via the service-role client. Every created row carries `is_imported = true`, `import_batch_id`, `legacy_ref`. **No automations fire during import** — a transaction-local flag suppresses SLA notification eligibility, and no digest counts imported rows as new on the day of import. Progress is reported per 100 rows. Any unhandled error rolls the whole batch back.

### 20.6 Rollback

OWNER only, within 7 days, and only if no imported record has been edited since import. Archives (not deletes) every record with that `import_batch_id`, sets batch status `ROLLED_BACK`, and reports what it archived.

---

## 21. DEPLOYMENT

### 21.1 Environments

| Env | Where | Database | Data |
|---|---|---|---|
| Development | Local Next.js + `supabase start` | Local Postgres in Docker | Seeded fixtures |
| Staging | Vercel preview | Separate Supabase project | Anonymised or synthetic |
| Production | Vercel production | Production Supabase | Real |

**Development never connects to production.** The production service-role key exists only in Vercel's production environment.

### 21.2 Migrations

Version-controlled files under `/supabase/migrations`, applied with `supabase db push` (dev) and `supabase migration up` in the deploy pipeline. **Never edit a migration that has been applied to production** — write a new one. Never modify production schema through the Supabase dashboard.

### 21.3 Deploy sequence

`run tests → apply migrations to staging → verify → deploy staging → smoke test → apply migrations to production → deploy production → smoke test`.

### 21.4 Backup and data ownership (must be documented in `/docs/DEPLOYMENT.md`)

- Supabase automated daily backups; confirm retention on the chosen plan
- **A weekly `pg_dump` to storage the business controls independently of Supabase** — the company must be able to recover without vendor cooperation
- CSV export of accounts, contacts, projects, opportunities and activities available to OWNER from `/settings`
- Documented restore procedure, tested at least once before go-live
- No business-critical state exists outside Postgres and Storage

---

## 22. BUILD PHASES

Each phase ends with: migrations applied, services implemented, UI working, permissions enforced, tests written **and passing**, a summary of changes, and remaining TODOs. **Do not begin a phase before the previous one passes its acceptance criteria.**

| Phase | Scope | Migrations | Key deliverables | Gate |
|---|---|---|---|---|
| **1 Foundation** | Repo, stack, Supabase, auth, users, roles, app shell, design system | 001–003, 014 (helpers) | Login, role redirect, user CRUD for OWNER, AppShell + BottomNav + Sidebar | A new dev can clone, run, log in as seeded OWNER, create a salesperson who can log in |
| **2 Identity** | Accounts, contacts, duplicate detection, Customer 360, search | 004–007 | Account CRUD, contact CRUD, `checkDuplicates`, `/accounts`, `/accounts/:id`, global search | §23.1, §23.2 |
| **3 Projects** | Projects, stakeholders | 008–009 | Project CRUD, stakeholder add/remove, primary enforcement, project detail | §23.3 |
| **4 Sales** | Opportunities, pipeline, transitions, ownership | 010, 012 | Opportunity CRUD, stage control + matrix, won/lost, assign/reassign, events trigger, kanban | §23.4 |
| **5 Accountability** | Activities, next actions, `/today` | 011 | Activity sheet, timeline, next-action updates, flags view, overdue/dormant lists | §23.5 |
| **6 Management** | Manager + owner dashboards, team workload, reports | — | All §13 tiles, `/team`, `/reports` | §23.6 |
| **7 Data** | Import, archive/restore, merge | 004 (extend), 013 | Import wizard, archive views, `mergeAccounts` | §23.7 |
| **8 Security & QA** | RLS hardening, security tests, E2E, mobile QA | 015–016 | All policies, 15 E2E scenarios, security suite | §23.8 |
| **9 Launch** | Production deploy, pilot, docs | 017 | Deployed app, backups verified, docs complete | §23.9 |

RLS policies are written **as each table is created** (phases 2–5), then audited and hardened in phase 8. Do not defer all security to phase 8.

### 22.1 Claude Code working method — per phase

1. Inspect the existing repository before writing anything.
2. State what will be implemented and which acceptance criteria are targeted.
3. Write migrations. Apply locally. Verify with `supabase db diff`.
4. Implement services with Zod schemas.
5. Implement UI.
6. Implement/verify RLS policies for the tables touched.
7. Write unit + integration tests.
8. Run the full suite. **Fix every failure. Never skip a failing test.**
9. Update `/docs/*` to reflect what was actually built.
10. Summarise changes, deviations from this spec (with reasons), and open TODOs.
11. Stop. Wait for review before the next phase.

**Never** rewrite working functionality without a stated reason. **Never** build a feature this spec does not describe. **Never** resolve a `TODO-BD` by inventing a value.

---

## 23. ACCEPTANCE CRITERIA

Test as the relevant role. **Never verify a permission as OWNER** — OWNER passes everything, which is exactly why it proves nothing.

### 23.1 Accounts
- [ ] Create with name, type, and phone or email; owner defaults to the creating user
- [ ] `+91 98765-43210` normalises and stores as `9876543210`
- [ ] Exact phone match triggers a strong warning showing the existing record; creation is still possible after confirmation
- [ ] Possible duplicate (similar name + same city) triggers a review warning
- [ ] No record is ever merged automatically
- [ ] Archive removes it from active lists; restore returns it; relationships and activities survive both
- [ ] Salesperson sees only their own accounts in list, search and counts
- [ ] Salesperson reading another's account by direct URL gets not-found
- [ ] Customer 360 shows next action, won value, pipeline value, last contact, exactly 3 recent activities
- [ ] Usable one-handed at 375px

### 23.2 Contacts
- [ ] A homeowner account works with **no** contact record
- [ ] Contact attaches to an account; standalone contact (independent architect) also works
- [ ] `linked_account_id` correctly represents a contact who is also a customer
- [ ] Constraint rejects a contact with neither phone nor email

### 23.3 Projects and stakeholders
- [ ] Project created under an account
- [ ] Three stakeholders with different roles and influence added
- [ ] A second primary stakeholder is rejected with a friendly message
- [ ] Stakeholder can reference a contact, an account, or both
- [ ] Project detail lists **multiple** opportunities
- [ ] Filters by construction stage and city work

### 23.4 Opportunities
- [ ] Created from an account and from a project; `project_id` remains optional
- [ ] Valid transitions succeed; invalid ones are rejected by the service
- [ ] Backward transition requires a reason, stored in `opportunity_events`
- [ ] Entering `quoted` without quotation fields is rejected by the database
- [ ] `won` requires `final_order_value`; account becomes ACTIVE; next action cleared
- [ ] `lost` requires `lost_reason`
- [ ] `nurture` requires a next action date and is excluded from Pipeline Value
- [ ] Every stage and owner change produces an `opportunity_events` row
- [ ] Unassigned opportunities appear on the manager dashboard
- [ ] Salesperson cannot change `owner_id` by any route

### 23.5 Activities and next actions
- [ ] Activity logged in 3 taps from an opportunity
- [ ] `account_id` always populated
- [ ] Site visit exposes measurements, location and photo upload
- [ ] "Can't say yet" is accepted and the opportunity appears in Missing Next Action
- [ ] Overdue shows red with "Overdue by N days"
- [ ] Activity is editable by its author for 24 hours and immutable after; deletable by nobody
- [ ] Timeline is reverse-chronological with type icons and outcome

### 23.6 Dashboards
- [ ] Salesperson sees only their own data in every tile
- [ ] Pipeline Value equals a manual sum of active non-nurture opportunities
- [ ] Win Rate matches the §13.1 formula against seeded data; shows "—" when no closed deals
- [ ] Every manager exception tile links to a correctly filtered list
- [ ] Owner dashboard contains no more than the §13.4 blocks
- [ ] The word "revenue" appears nowhere in the UI
- [ ] Tiles render under 400ms with 20,000 opportunities seeded

### 23.7 Import, archive, merge
- [ ] Templates download; invalid rows report row number and specific reason
- [ ] In-file duplicates are ERROR; against-database duplicates require a decision
- [ ] Imported records carry `is_imported`, `import_batch_id`, `legacy_ref`
- [ ] Import fires no notifications
- [ ] Rollback within 7 days archives everything from the batch and refuses if records were edited
- [ ] Merge requires confirmation, preserves all activities, and is recorded in the audit trail

### 23.8 Security
- [ ] All fifteen E2E scenarios pass
- [ ] Salesperson cannot read/write another's records through a **direct PostgREST call**
- [ ] Role escalation via self-update is rejected
- [ ] No role can DELETE from any business table
- [ ] Service-role key is absent from the client bundle (verified by grep of the build)
- [ ] Storage objects are not readable without entity visibility
- [ ] No database error text ever reaches the user

### 23.9 Launch readiness
- [ ] Migrations apply cleanly to an empty database
- [ ] Seed produces a working OWNER login
- [ ] `system_settings.cities` populated
- [ ] Backup and restore procedure documented **and tested once**
- [ ] All nine `/docs` files reflect the built system
- [ ] `npm run build` passes with zero TypeScript and lint errors
- [ ] Mobile create-customer flow completes in under 60 seconds on a real Android device

---

## 24. OPEN BUSINESS DECISIONS

Record each in `/docs/DECISIONS.md` in this format. **Do not implement a value; implement the mechanism and read the placeholder from `system_settings`.**

| ID | Decision | Why it matters | Temporary behaviour | How to change later |
|---|---|---|---|---|
| **TODO-BD-01** | Should a project be mandatory for opportunities above a value threshold? | Affects data quality on high-value deals and site-based reporting | `project_id` optional for all; dashboard reports the % of high-value opportunities with no project | Add a service-layer rule + settings key. No schema change |
| **TODO-BD-02** | High-value threshold for manager escalation | Drives which deals the manager is alerted about | `system_settings.high_value_threshold_paise = 20000000` (₹2,00,000) | Edit in `/settings` |
| **TODO-BD-03** | Dormancy days and per-stage stall days | Drives the accountability exception lists. Wrong values cause either alert fatigue or missed deals | Placeholders in `system_settings`; recommend re-deriving from three months of real data | Edit in `/settings` |
| **TODO-BD-04** | Marble/granite treatment: is slab/lot-level reference needed, or is material + grade sufficient? | Determines whether a future slab entity is required. **V1 deliberately does not model slabs** | `material_notes` free text + photos on activities | If slab tracking is confirmed, add fields to opportunities or a new table. Nothing built now blocks either path |
| **TODO-BD-05** | Owner summary: daily or weekly, and at what time | Cron schedule | `{"cadence":"daily","hour":19}` | Edit in `/settings` |
| **TODO-BD-06** | The list of cities/areas served | Blocks clean geographic reporting | Empty list; free text accepted with a flag for admin normalisation | Edit in `/settings` |
| **TODO-BD-07** | Final product taxonomy — is the `product_category` enum sufficient, or is brand/range structure needed? | Determines whether a products table is ever required | Enum + `material_notes` free text | Adding a products table later is additive; no migration of existing data required |
| **TODO-BD-08** | Hosting region / Indian data residency requirement | May force a different Supabase region or host | Assume no residency constraint; choose the nearest region | Region is chosen at Supabase project creation — **decide before production provisioning, it cannot be changed later** |
| **TODO-BD-09** | Exact accounting software and version | Blocks any future integration scoping | No integration; manual handoff at won, `order_reference` free text | Scope integration only after the system is confirmed |
| **TODO-BD-10** | Historical migration depth — which records are worth digitising | Determines import volume and effort | Import capability built for accounts and contacts only | Projects/opportunities templates added later without schema change |
| **TODO-BD-11** | Is sample issue/return tracking a real operational problem? | Would add an entity in V2 | Not modelled; sample handover is an activity purpose | New table in V2 if confirmed |
| **TODO-BD-12** | Second branch in the planning horizon? | Determines when branch filtering is needed | `branch` column present, defaulted `MAIN`, no UI | Add filtering and a branch picker; no migration needed |

---

## 25. CONSISTENCY AUDIT

Performed against the source blueprint and this specification. Findings and resolutions — **these are binding**.

### Resolved conflicts

1. **Tasks vs. next action.** The earlier blueprint proposed a tasks table; this spec uses `next_action` + `next_action_date` on the opportunity. **Resolution: no tasks table in V1.** One opportunity has exactly one pending next action. Multiple parallel reminders are a V2 feature.

2. **Duplicate handling: block vs. warn.** Earlier material implied blocking duplicate phones with a unique constraint. **Resolution: advisory warnings only.** `phone_normalized` is indexed but **not unique** — family members share numbers, and a hard block causes salespeople to enter fake numbers, which is worse.

3. **Mandatory next action.** Earlier material required a next action on every open opportunity. **Resolution: strongly prompted, not enforced.** Blocking produces fabricated dates. The Missing Next Action exception list is the control.

4. **Quotations as a table vs. fields.** **Resolution: fields on the opportunity**, per §30 of the brief. Revision history is a V2 need.

5. **Products table.** **Resolution: none in V1.** Category enum plus `material_notes`. TODO-BD-07.

6. **Owner nullability.** Accountability requires an owner; the manager dashboard requires an "unassigned" tile. **Resolution:** accounts/projects require an owner; opportunities allow null, which is a visible exception rather than a silent gap.

7. **Zoho artefacts.** Blueprint, modules, workflow rules, formula fields, profiles/roles and data-sharing settings have all been translated into check constraints, RLS policies, the transition matrix and cron routes. **No Zoho concept survives.**

### Verified

- Every UI-referenced field exists in §5. Every dashboard metric in §13.1 maps to real columns. Every automation in §14 references real fields. Every permission in §3.1 is expressible as an RLS policy in §15.
- No accounting, GST, stock or invoice field exists anywhere in the schema.
- No V2+ feature has entered V1.
- No duplicate lead/opportunity architecture exists.
- Mobile flows require 6–7 fields maximum and no wizard.
- Future integration is possible without redesign (§17.6) without over-engineering now.

### Known risks for the implementer

- **RLS recursion** on `users` is the most likely early blocker. Use the `SECURITY DEFINER` helpers in §15.1; do not write a policy that selects from `public.users` inside a `public.users` policy.
- **The `v_opportunity_flags` view must be created with `security_invoker = true`**, or it silently bypasses RLS and leaks every salesperson's data to every other.
- **`accounts` ↔ `contacts` circular FK** requires the three-step migration order in §5.12.
- **Import must suppress notifications**, or a 2,000-row import emails everyone and the team stops trusting alerts permanently.

---

*End of specification. Version 1 only. Anything not described here is out of scope and must be raised before implementation.*
