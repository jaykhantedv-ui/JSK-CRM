# Decisions

Two registers:

- **A. Business decisions (`TODO-BD`)** — every item from §24 of `CLAUDE_CODE_BUILD_SPEC.md`.
  **All twelve were resolved by the Project Owner on 2026-08-19.** Values still live in
  `system_settings`, never in code: a resolved decision fixes the *value*, it does not licence a
  constant. Changing a value must still never require a deploy.
- **B. Architecture decision record** — stack or architecture changes. §17.1 requires the reason
  to be recorded **before** implementing the change. **Nineteen ADRs** are accepted below.
- **C. Product decisions closing the remaining audit findings** — the five product/permission
  questions the audit raised that are neither `TODO-BD` items nor architecture changes.

Specification defects and ambiguities are **not** decisions and live in `/docs/SPEC_AUDIT.md`,
which now carries a resolution for each one plus a consolidated resolution log.
**All 53 audit findings are now resolved.**

**Decision date for everything on this page: 2026-08-19. Decided by: Project Owner.**

---

# A. Business decisions — all resolved

**Rule (§24, restated in `CLAUDE.md` §3):** *Do not implement a value; implement the mechanism and
read the placeholder from `system_settings`.* **This rule survives resolution.** A `TODO-BD` value
hard-coded anywhere in application code — a constant, a default parameter, a migration literal
outside the settings seed, a fallback in a component — is a defect, whether or not the value is
now approved.

| ID | Status | Settings key | Approved value / position |
|---|---|---|---|
| TODO-BD-01 | **Resolved** | *(none — no key created)* | Project stays optional for all opportunities |
| TODO-BD-02 | **Resolved** | `high_value_threshold_paise` | `30000000` (₹3,00,000) — **changed from the ₹2,00,000 placeholder** |
| TODO-BD-03 | **Resolved** | `account_dormancy_days`, `opportunity_dormancy_days`, `stage_stall_days` | Defaults retained; **`dormancy_days` is split into two keys** |
| TODO-BD-04 | **Resolved — amended 2026-08-20** | `material_types` | No slab/lot entity in V1; list seeded with a launch taxonomy |
| TODO-BD-05 | **Resolved** | `owner_summary_schedule` | Daily, 19:00 Asia/Kolkata, via hourly trigger + in-route gate |
| TODO-BD-06 | **Resolved — final** | `cities` | Erode District, Tamil Nadu — **the ten revenue taluks**, enumerated |
| TODO-BD-07 | **Resolved** | *(enum + free text; no key)* | No products/SKU table in V1 |
| TODO-BD-08 | **Resolved** | *(infrastructure)* | Indian data residency **is** required — Supabase Mumbai `ap-south-1` |
| TODO-BD-09 | **Resolved** | *(none)* | No accounting integration in V1 |
| TODO-BD-10 | **Resolved** | *(none)* | Import for accounts and contacts only |
| TODO-BD-11 | **Resolved** | *(none)* | No sample/return entity in V1 |
| TODO-BD-12 | **Resolved** | *(none — `branch` column)* | Columns retained; no UI, filtering or RLS in V1 |

---

### TODO-BD-01 — Should a project be mandatory for opportunities above a value threshold?

- **Why it matters.** Affects data quality on high-value deals and site-based reporting.
- **Temporary behaviour (before the decision).** `opportunities.project_id` optional for all;
  the manager dashboard reports the percentage of high-value opportunities with no project.
- **Decision.** **Projects remain optional for all opportunities, including high-value ones.**
  **Do not introduce a mandatory-project rule** — no service-layer rule, no settings key, no
  conditional validation. The dashboard reporting stays as specified in §8.5.
- **Consequence.** No schema change, no new settings key, no change to Phase 11.
- **Decided by:** Project Owner · **Date:** 2026-08-19

### TODO-BD-02 — High-value threshold for manager escalation

- **Why it matters.** Drives which deals the manager is alerted about (the "High-value at risk"
  tile, §13.3 Panel A).
- **Temporary behaviour (before the decision).** `high_value_threshold_paise = 20000000`
  (₹2,00,000), an unapproved placeholder.
- **Decision.** `system_settings.high_value_threshold_paise = **30000000**` — **₹3,00,000**.
  This remains a `system_settings` value, **not** a hard-coded application constant.
- **Consequence.** The §5.10 seed literal changes from `20000000` to `30000000` in
  `013_system_settings.sql`. This is the **only** place the number may appear.
- **How to change later.** Edit at `/settings`. No deploy.
- **Decided by:** Project Owner · **Date:** 2026-08-19

### TODO-BD-03 — Dormancy days and per-stage stall days

- **Why it matters.** Drives the accountability exception lists. Wrong values cause either alert
  fatigue or missed deals — the two failure modes the whole exception system exists to avoid.
- **Temporary behaviour (before the decision).** One `dormancy_days = 30` key serving two
  different business concepts (audit finding **M-10**), plus `stage_stall_days`.
- **Decision.**
  1. These stay **configurable settings**, never hard-coded application logic.
  2. Initial defaults are retained: **30 days** for dormancy, and
     `stage_stall_days = {"new":3,"qualified":14,"selection":21,"quoted":10,"negotiation":14,"verbal_confirmation":10}`.
  3. **Account dormancy and opportunity dormancy are separated.** They must not share one
     ambiguous setting. Two keys replace the single `dormancy_days`.
- **Recorded key names** (naming is an implementation choice inside the approved decision, recorded
  here for review): `account_dormancy_days` (drives `accounts.status = 'DORMANT'`, §14.6) and
  `opportunity_dormancy_days` (drives the **Dormant** opportunity exception, §13.1). Both seed to
  `30`. **`dormancy_days` is retired and is never seeded.**
- **Consequence.** A deviation from §5.10's seeded key list — recorded as **ADR-010**. Resolves
  audit finding M-10. Affects Phases 3, 12, 14, 18.
- **How to change later.** Edit at `/settings`. No deploy. The spec's own recommendation — re-derive
  both values from three months of real data — stands.
- **Decided by:** Project Owner · **Date:** 2026-08-19

### TODO-BD-04 — Marble/granite treatment: is slab/lot-level reference needed?

- **Why it matters.** Determines whether a future slab entity is required. **V1 deliberately does
  not model slabs** (§2.3).
- **Decision.** **No slab/lot-level entities in V1.** Use the existing model:
  `opportunities.category` · `material_notes` free text · `estimated_quantity` + `quantity_unit`,
  plus photos on activities. `system_settings.material_types = []` backs an autocomplete that
  accepts free text.
- **How to change later.** If slab tracking is confirmed, add fields to `opportunities` or a new
  table. **Nothing built now blocks either path.**
- **Decided by:** Project Owner · **Date:** 2026-08-19

**Amendment — 2026-08-20 (launch QA).** Seeding the key as `[]` was correct about the *model* and
wrong about the *ergonomics*. An autocomplete backed by an empty list offers nothing, so every
salesperson types the category by hand and the free text fragments into "vitrified",
"Vitrified tiles", "vit. tile" — the normalisation problem the controlled list exists to prevent.

- **Decision.** Seed `material_types` with a starter taxonomy: Tiles · Marble · Granite ·
  Sanitaryware · CP Fittings · Bathroom Accessories · Vitrified Tiles · Wall Tiles · Floor Tiles ·
  Kitchen Sinks · Bathroom Fittings · Adhesives & Grouts.
- **What is unchanged.** No slab entity, **no product catalogue, no SKU system**. This is a list of
  strings backing an autocomplete that still accepts free text, and it remains editable at
  `/settings` by OWNER and ADMIN without a deploy.
- **How it ships.** Migration `030_material_types_seed.sql`, guarded `where value = '[]'` so an
  admin's curated list is never overwritten and the migration is idempotent. 014 is applied and is
  therefore never edited (CLAUDE.md §17, §21.2). The value appears in the settings seed and
  nowhere else (CLAUDE.md §3).
- **Decided by:** Project Owner · **Date:** 2026-08-20

### TODO-BD-05 — Owner summary: daily or weekly, and at what time?

- **Why it matters.** Sets the cron schedule for the owner summary email (§14.5).
- **Decision.** `system_settings.owner_summary_schedule = {"cadence":"daily","hour":19}` —
  **daily at 19:00 Asia/Kolkata.**
- **Implementation mechanism (approved).** Because Vercel Cron schedules are **static in
  `vercel.json`**, this is implemented as an **hourly trigger plus an in-route settings check**:
  the route reads `owner_summary_schedule` on every firing and sends only when the current
  Asia/Kolkata hour matches. Changing the setting therefore **never requires a deployment**,
  which is the rule §24 exists to protect.
- **Consequence.** Resolves audit finding M-26. Deviates from §14.5's literal "Cron, per
  `system_settings.owner_summary_schedule`" wording — recorded as **ADR-011**. Affects Phase 18.
- **Decided by:** Project Owner · **Date:** 2026-08-19

### TODO-BD-06 — The list of cities/areas served — **FINAL**

- **Why it matters.** Blocks clean geographic reporting, and feeds duplicate detection: the
  POSSIBLE-confidence rule is `similarity(name) >= 0.6` **and same city** (§8.9). It is a §23.9
  launch gate.
- **Decision.** The launch geography is **Erode District, Tamil Nadu, India**, represented by its
  **ten official revenue taluks**, seeded into `system_settings.cities`:

  | # | Revenue taluk |
  |---|---|
  | 1 | Erode |
  | 2 | Perundurai |
  | 3 | Modakkurichi |
  | 4 | Kodumudi |
  | 5 | Gobichettipalayam |
  | 6 | Sathyamangalam |
  | 7 | Bhavani |
  | 8 | Anthiyur |
  | 9 | Thalavadi |
  | 10 | Nambiyur |

- **Geographic hierarchy — this matters and must not be flattened.**

  ```
  Erode District  (Tamil Nadu, India)
    └─ revenue taluk        ← system_settings.cities   (the ten above)
         └─ firka / development block / town / village
                            ← accounts.area, projects.area  (free text, V1)
  ```

  **`Chennimalai` is NOT a revenue taluk.** It is a **development block and a firka within
  Perundurai taluk**. It belongs in `area`, never in `cities`.

  > **Correction to the previous decision pass.** The earlier record listed Chennimalai among the
  > confirmed taluks, because it appeared in the owner's illustrative list. That was wrong and is
  > corrected here. No other named area was affected.

- **What is *not* being built.** Lower-level units (blocks, firkas, towns, villages) are **not**
  enumerated in V1. `accounts.area` and `projects.area` remain free text. **Do not invent
  geographic units.** If a controlled `areas` list is wanted later it is a new `system_settings`
  key plus a `/docs/DECISIONS.md` entry — not a constant and not a guess.
- **Key naming note.** The settings key is `cities` because §5.10 names it so. It holds **revenue
  taluks**. The key is not renamed; the meaning is documented here and in `/docs/DATABASE.md`.
- **Free-text entry with a normalisation warning remains allowed** (§7.3) — a salesperson is never
  blocked by a missing area; the value is flagged for the admin to normalise.
- **How to change later.** Edit at `/settings`. No deploy.
- **Decided by:** Project Owner · **Date:** 2026-08-19

### TODO-BD-07 — Final product taxonomy

- **Why it matters.** Determines whether a products table is ever required.
- **Decision.** **Keep the V1 lightweight taxonomy:** `product_category` enum · `material_notes` ·
  `estimated_quantity` · `quantity_unit`. **Do not introduce a products/SKU table in V1** (§7.4,
  §4.2).
- **How to change later.** Adding a products table later is **additive**; no migration of existing
  data is required.
- **Decided by:** Project Owner · **Date:** 2026-08-19

### TODO-BD-08 — Hosting region / Indian data residency requirement

- **Why it matters.** The Supabase region is chosen at project creation and **cannot be changed
  afterwards**. §24: *decide before production provisioning, it cannot be changed later.*
- **Decision.** **Indian data residency is a requirement.** Use the **Supabase Mumbai region,
  `ap-south-1`**. **Do not provision production or staging in any other region.**
- **Consequence.** Unblocks Phase 2 and Phase 21 provisioning — but only after the **Decision
  Gate** passes (see `/docs/IMPLEMENTATION_PLAN.md`). Recorded in `/docs/DEPLOYMENT.md` as a
  hard provisioning precondition.
- **How to change later.** Not changeable in place. A region change means a new project and a full
  data migration.
- **Decided by:** Project Owner · **Date:** 2026-08-19

### TODO-BD-09 — Exact accounting software and version

- **Why it matters.** Blocks any future integration scoping.
- **Decision.** **No accounting-software integration in V1.** Manual handoff at won;
  `opportunities.order_reference` stays **free text** — the reference used in the accounting
  system (§11.8, §17.6). `AccountingIntegration` remains a type declaration with **no
  implementation and no stub** (§16.4). **Do not write a fake adapter.**
- **How to change later.** Scope integration only after the system is confirmed in use.
- **Decided by:** Project Owner · **Date:** 2026-08-19

### TODO-BD-10 — Historical migration depth

- **Why it matters.** Determines import volume and effort. The historical books are still on paper
  (§20) — build the capability, assume no file exists yet.
- **Decision.** Build historical import capability for **accounts** and **contacts** only.
  **Do not build project or opportunity historical migration in V1.**
- **How to change later.** `import_batches.entity` already accepts `projects` and `opportunities`,
  and `import_rows.raw` is `jsonb`, so adding them requires **no schema change**.
- **Decided by:** Project Owner · **Date:** 2026-08-19

### TODO-BD-11 — Is sample issue/return tracking a real operational problem?

- **Why it matters.** Would add an entity in V2.
- **Decision.** **Do not create a sample/return entity in V1.** Continue using activity purposes
  (`activity_purpose = 'SAMPLE_HANDOVER'`).
- **How to change later.** New table in V2 if confirmed. Not in V1 under any circumstances (§2.3).
- **Decided by:** Project Owner · **Date:** 2026-08-19

### TODO-BD-12 — Is a second branch in the planning horizon?

- **Why it matters.** Determines when branch filtering is needed.
- **Decision.** **Keep the existing `branch` fields** on `users`, `accounts`, `projects` and
  `opportunities`, defaulted `'MAIN'`, for future extensibility — but **no branch UI, no branch
  filtering, and no branch behaviour in RLS in V1** (§17.6).
- **How to change later.** Add filtering and a branch picker. **No migration needed.**
- **Decided by:** Project Owner · **Date:** 2026-08-19
- **SUPERSEDED 2026-08-19 by ADR-016.** The business restated the operating reality — two outlets
  now, five to ten expected across Tamil Nadu, with managers holding zero, one or several of them.
  `branch text` cannot carry an identity, an assignment or a deactivation, so **the columns are
  retired and replaced** by the `outlets` table, the `user_outlets` link table and
  `outlet_id` foreign keys. Outlet scope **is** enforced in RLS. A migration **is** needed. The
  original decision is preserved above as the record of what the system held before.

---

# B. Architecture decision record

§17.1: *"If a change to this stack becomes necessary, record it in `/docs/DECISIONS.md` with the
reason **before** implementing it."* The same applies to any change to the eleven-table model
(§4.1), the RLS-as-authorization model (§15), the money representation (§8.11), the service
boundary (§16), or the repository structure (§18).

**ADRs below cover genuine deviations** — places where the built system will differ from what the
specification says. Findings that are simply *corrections of defective spec text* (B-02, B-04,
B-06, B-07, B-10, H-01, H-03, H-04, H-05, H-06, H-09, H-12) are recorded in
`/docs/SPEC_AUDIT.md`'s resolution log instead; they need no ADR because the spec's intent is
unchanged — only its text was wrong.

### ADR-000 — The frozen stack (accepted, from the specification)

**Status:** Accepted — §17.1, not a decision made here.

Next.js 15 App Router + TypeScript strict · Supabase Postgres, Auth and Storage · `@supabase/ssr` ·
Tailwind + shadcn/ui + lucide-react · Zod · react-hook-form + zodResolver · TanStack Query
(lists/filters only) · Recharts · date-fns · Resend behind `NotificationService` · Vercel Cron ·
Vercel + Supabase hosting · Vitest + Playwright.

**Rejected and staying rejected:** microservices · GraphQL · Redis · message queues · a separate
API server · a native mobile app · real-time subscriptions · state-management libraries
(no Redux, no Zustand).

**Three additions considered and declined**, keeping the stack frozen:
- UTC→`Asia/Kolkata` rendering uses **`Intl.DateTimeFormat` with `timeZone`**, not `date-fns-tz`
  (audit M-13).
- Magic-byte MIME verification is a **hand-rolled signature check** for the four allowed types
  (JPEG, PNG, WebP, PDF), not the `file-type` package (audit M-14).
- **`server-only`** — proposed during Phase 2 to add a build-time error when
  `lib/supabase/admin.ts` is reached from client code. **Declined 2026-08-19 by the Project
  Owner.** The three-layer admin boundary already approved is sufficient: (1) the runtime browser
  guard on module evaluation and on the factory, (2) the ESLint import restriction confining the
  module to its three ADR-009 callers, and (3) client-bundle verification plus the guard unit
  tests. A fourth dependency buys no control the first three do not already provide.

**One addition approved** (audit M-30): an ESLint import-boundary rule
(`import/no-restricted-paths` or equivalent) to enforce §18's no-cross-feature-import rule.
Without it the rule is a convention that will be violated silently. Dev-dependency only; ships
nothing to the browser.

---

### ADR-001 — `opportunity_events.reason` is passed to the trigger by a transaction-local GUC

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **B-01** · **Affects:** Phases 6, 11, 16

**Context.** §5.9 says events are written by the trigger *and* by the service layer for reason
text, but the table has **no INSERT policy for the service layer and no UPDATE policy for anyone**.
As specified, `reason` was unwritable on every user-initiated path, so the audit trail could not
record why a backward transition or a reassignment happened.

**Decision.** The service sets a **transaction-local GUC** before the write —
`set_config('app.event_reason', <reason>, true)` — and `log_opportunity_event()` reads it when
constructing the event row.

**Consequences.**
- The append-only model is preserved exactly: no INSERT policy, no UPDATE policy, no DELETE policy.
- The trigger remains the single writer, so **no path can bypass the audit** (§5.9's stated goal).
- `true` as the third argument scopes the setting to the transaction, so it cannot leak between
  requests on a pooled connection.
- The trigger must clear/ignore a stale value when no reason was set.

**Alternatives considered.** A narrow INSERT policy on `opportunity_events` (weakens append-only
and lets a caller forge events); making every stage change a `SECURITY DEFINER` RPC that writes the
event itself (larger blast radius, and the trigger would still need to catch out-of-band changes).

---

### ADR-002 — SLA notification state is a column on `opportunities`

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **B-05** · **Affects:** Phases 3, 18

**Context.** §14.2 requires the new-opportunity SLA email to fire **once per opportunity**,
"deduplicated by a `notified_new_sla` key in the event metadata". No such state can exist: §4.2
rejects a `notifications` table, `opportunity_event_type` has no notification value, and event rows
cannot be updated. Without state the reminder **re-sends every hour forever** — the exact
alert-fatigue failure §25 warns about.

**Decision.** **No generic `notifications` table.** Per-opportunity SLA notification state lives on
the opportunity record as an explicit column. **Recorded column name:** `sla_notified_at
timestamptz` (null = not yet notified). The cron route sets it in the same statement that marks
the opportunity as processed, and filters on `sla_notified_at is null`.

**Consequences.**
- This **adds a field to `opportunities` that §5.7 does not list**, against §5.5's "Do not add
  fields not listed". That is the deviation being approved here, and it is the smallest one
  available: no new table, no new enum value, eleven tables still.
- The notification is sent **at most once per opportunity** for the SLA event, as §14.2 requires.
- The cron writes as service-role, so the column must not be user-writable through any policy.
- §14.6's "job failed twice consecutively" state is a **separate** question — see open items.

**Alternatives considered.** A new `opportunity_event_type` value plus an appended event row
(needs a migration and pollutes the business audit trail with system noise); a `system_settings`
watermark (a cursor cannot express per-record state); accepting hourly re-sends (rejected — it
destroys trust in every alert the system sends).

---

### ADR-003 — A dedicated system user is the actor for automated writes

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **B-03** · **Affects:** Phases 3, 15, 18

**Context.** `opportunity_events.actor_id` is `not null`, and the trigger derives it from
`auth.uid()`. Service-role clients (cron routes §14.7, the import executor §20.5) have **no
`auth.uid()`**, so any automated statement touching `stage` or `owner_id` raises a not-null
violation and aborts the job.

**Decision.** Create **one dedicated system user row in `public.users`**, seeded with a fixed uuid.
Automated service-role writes record that row as `actor_id`. The trigger resolves the actor as
`coalesce(auth.uid(), new.created_by, <system user uuid>)`.

**Consequences.**
- The audit trail stays complete and readable: an automated change is visibly attributed to the
  system, not silently to a person.
- The system user must be `is_active = false` so `user_role()` returns null for it and it can
  never authenticate or pass an RLS policy, and it must be excluded from `/team`, workload
  reporting, user lists and digests.
- It is a `users` row, not a twelfth table — the eleven-table model is intact.

**Alternatives considered.** Making `actor_id` nullable (loses the not-null guarantee that makes
the audit trail trustworthy, and every reader would need to handle null).

---

### ADR-004 — `project_stakeholders` rows may be deleted; nothing else may

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **B-08** · **Affects:** Phases 5, 10

**Context.** `removeProjectStakeholder()` is in the §16.1 service contract, but
`project_stakeholders` has no `archived_at` column and §8.8/§15.2 forbid a DELETE policy on any
business table. The operation had no legal implementation.

**Decision.** **Allow deletion of the `project_stakeholders` relationship row only.** This is an
explicit, single exception to the no-hard-delete rule, granted because the row represents a
**relationship/link**, not a business entity: it carries no history, no ownership and no money, and
removing a wrongly-added person from a site is an ordinary correction rather than the destruction
of a record.

**Consequences.**
- Exactly one table in the schema has a DELETE policy. **`accounts`, `contacts`, `projects`,
  `opportunities`, `activities`, `opportunity_events`, `users`, `system_settings`,
  `import_batches` and `import_rows` remain undeletable by every role, including OWNER.**
- The DELETE policy must be scoped identically to the table's UPDATE policy — a caller who may
  update the parent project may remove a stakeholder from it, and nobody else may.
- An integration test must assert that DELETE succeeds on `project_stakeholders` **and fails on
  every other table**, for every role.
- No `archived_at` column is added, so the three partial unique indexes in §5.6 stay exactly as
  specified.

**Alternatives considered.** Adding `archived_at`/`archived_by` to `project_stakeholders` (a schema
change that also forces every partial unique index to be rewritten with `and archived_at is null`,
for a link table with nothing worth preserving); dropping the operation (leaves no way to correct a
mis-entered stakeholder).

---

### ADR-005 — Browser-to-Storage upload against a server-issued signed URL

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **B-09** · **Affects:** Phases 12, 17

**Context.** §17.2 states "**No client-side Supabase writes**" absolutely. §15.6 allows files up to
**10 MB**. The platform's serverless request-body limit is **4.5 MB**, and Next.js Server Actions
impose their own lower limit, so a 10 MB file **cannot** be routed through a Server Action.

**Decision.** Approve one explicit exception: **browser → server-issued signed upload URL →
private Supabase Storage bucket.** The signed URL is short-lived. Authorization is based on
**visibility of the parent entity**, checked server-side before the URL is issued.
**All database writes remain server-side** — the row that references the file is written by a
Server Action, never by the browser.

**Consequences.**
- The carve-out applies to **Storage object uploads only**. No other client-side Supabase write is
  permitted anywhere, for any reason.
- Read access continues to use signed URLs with a **60-second** expiry (§17.5); no public bucket,
  no public URL.
- §11.5's "upload failure does not block the activity — the activity saves and the upload retries"
  becomes implementable, because the upload is a separate call.
- Server-side validation still applies before the URL is issued: 10 MB cap and the four-type
  MIME allow-list verified by **magic bytes, not extension**.

**Alternatives considered.** Lowering the file cap under 4.5 MB to keep uploads server-side
(rejected — it changes a stated product requirement to suit an implementation constraint, and
phone photos routinely exceed it).

---

### ADR-006 — `quoted_requires_quotation` applies to `quoted` only

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **H-10** · **Affects:** Phases 3, 11

**Context.** §9.2 permits `selection → negotiation` and §9.1 lists **no** entry requirement for
`negotiation`, but the §5.7 check constraint covers
`('quoted','negotiation','verbal_confirmation')`. A salesperson following a legal path hit a
database rejection the UI had no field for.

**Decision.** **`selection → negotiation` stays a valid transition.** The quotation-required
constraint applies to **`quoted`**, and is **not** applied automatically to `negotiation`.
**Salespeople must not be forced to invent quotation data merely to enter negotiation.**

**Consequences.**
- The constraint in `010_opportunities.sql` narrows to
  `check (stage <> 'quoted' or (quotation_ref is not null and quoted_value is not null and quotation_date is not null))`.
- §8.6's "Entering stage `quoted` requires `quotation_ref`, `quotation_date` and `quoted_value`"
  is preserved exactly. §9.3's side-effects table already listed quotation requirements under
  `quoted` alone, so the constraint now matches it.
- The rest of the check-constraint backbone (§5.7) is untouched. This is the only constraint
  weakened, and it is weakened because it contradicted the transition matrix, not for convenience.

**Sub-question — CONFIRMED 2026-08-19.** Quotation fields are required **only when entering
`quoted`**. They are **not** required for entering `negotiation` **or `verbal_confirmation`**.
The constraint is therefore:

```sql
constraint quoted_requires_quotation check (
  stage <> 'quoted'
  or (quotation_ref is not null and quoted_value is not null and quotation_date is not null))
```

An **integration regression test** must prove that **`selection → negotiation` succeeds with no
quotation information**. This ADR is now complete and unblocks migration 010.

---

### ADR-007 — A won opportunity reopens to `qualified`

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **H-11** · **Affects:** Phases 6, 11

**Context.** §9.2 states `won → (none)` while also saying a mistaken win is corrected through
`reopenOpportunity()`. The target stage and the cleanup were both undefined, so a reopened
opportunity could carry a stale `final_order_value` back into Won Value on a later re-win.

**Decision.** A WON opportunity may be reopened **only** through the approved MANAGER/OWNER
workflow. The reopen path is **`won → qualified`**. The service **clears `final_order_value` and
`closed_at`**. The historical audit event showing the opportunity had previously been won is
**preserved**.

**Consequences.**
- `won → qualified` is added to the transition matrix in `lib/opportunity/transitions.ts`, marked
  reopen-only and MANAGER/OWNER-only, with a **reason required** (§9.2's rule for backward moves).
- A `REOPENED` event is written; the earlier `WON` event is never deleted or rewritten (§9.2).
- Clearing `final_order_value` means **no stale value can contaminate later reporting** — the
  specific failure the audit identified.
- The check constraints permit this: `won_requires_value` and `won_requires_closed` are both
  conditional on `stage = 'won'`.
- `lost → new, qualified` (already in §9.2) is unchanged and keeps its reason requirement.

**Sub-question — CONFIRMED 2026-08-19.** **Do NOT automatically change `accounts.status`** when a
won opportunity is reopened. Account status is **independent of any single opportunity**, because
the account may hold other WON opportunities and reverting it would misrepresent the relationship.

A **regression test** must cover an account with **multiple opportunities, including another WON
opportunity**: reopening one must clear that opportunity's `final_order_value` and `closed_at`,
leave the other WON opportunity untouched, and leave `accounts.status = 'ACTIVE'`.

---

### ADR-008 — Account merge is not reversible in V1

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **H-02** · **Affects:** Phase 16

**Context.** §8.9 claims merging is "always reversible via the audit trail" and §23.7 requires the
merge to be recorded there. The only audit table is `opportunity_events`, scoped to a single
opportunity, with no account-level event type. Nothing records which children moved, so the
operation could not be reversed.

**Decision.** **Do not add a twelfth table solely for merge history.** V1 account merge is
**not guaranteed to be reversible**. The merge flow must:
- show a **complete preview** of everything that will move;
- require **explicit confirmation**;
- record the source and target accounts and the affected relationships in the available audit
  metadata (`opportunity_events.metadata` for each moved opportunity);
- **clearly warn the user that the merge is irreversible in V1.**

**Do not claim "always reversible via the audit trail" anywhere in the UI or the docs**, because
the implementation cannot provide that guarantee.

**Consequences.**
- The eleven-table model holds (§4.1).
- §8.9's reversibility sentence is a **known, accepted documentation deviation**; `/docs/PRODUCT_REQUIREMENTS.md`
  and `/docs/TESTING.md` must not restate it as built behaviour.
- §23.7's "merge … is recorded in the audit trail" is satisfied partially — per-opportunity, not
  per-account. The acceptance criterion is interpreted accordingly.
- Merge stays manual, previewed and MANAGER/OWNER-only. It is the most destructive operation in
  the system and now provably one-way, which raises the bar on the preview.

**Alternatives considered.** A twelfth `merge_events` table (breaks the eleven-table cap for a
rare admin operation); reconstructing the merge from `updated_at` timestamps (unreliable and
silently wrong once any other write touches the rows).

---

### ADR-009 — User provisioning is a third permitted service-role caller

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **H-07** · **Affects:** Phase 4

**Context.** §3.2 forbids self-registration; OWNER/ADMIN create users at `/settings/users`.
Creating a Supabase Auth user server-side requires `auth.admin.createUser()` — the **service-role**
key — but §15.7 restricts that key to "cron routes and the import executor **only**".

**Decision.** The explicitly authorized **user-provisioning Server Action** may use the
service-role client, **but only after a server-side OWNER/ADMIN authorization check**. The
service-role key **must never be available to the browser**.

**Consequences.**
- §15.7's permitted-caller list becomes three: cron routes, the import executor, user provisioning.
- The authorization check runs **before** the admin client is touched. Getting that order wrong is
  a privilege-escalation hole, so it carries a dedicated negative test: a salesperson calling the
  provisioning action is rejected before any admin call is made.
- `lib/supabase/admin.ts` keeps its `typeof window !== 'undefined'` runtime guard, and the
  build-output grep for the key stays in the security suite (§19.4).
- `handle_new_auth_user()` (named in §5.12 but never specified) is defined in Phase 4: it mirrors
  the new `auth.users` row into `public.users` with `role` defaulting to `SALESPERSON`, `branch`
  defaulting to `'MAIN'`, and `full_name` from the provisioning payload.

---

### ADR-010 — Account dormancy and opportunity dormancy are separate settings

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **M-10**, implements **TODO-BD-03** · **Affects:** Phases 3, 12, 14, 18

**Context.** §5.10 seeds a single `dormancy_days` key, but §14.6 uses it to set
`accounts.status = 'DORMANT'` and §13.1 uses it for the **Dormant** *opportunity* exception. One
value served two business meanings that will not stay equal.

**Decision.** Split into `account_dormancy_days` and `opportunity_dormancy_days`, both seeded `30`.
`dormancy_days` is retired and never seeded.

**Consequences.** A deviation from §5.10's seeded key list — additive, no schema change
(`system_settings` is key/value). Both keys are read only through `settings.service.ts`. The
§23.9 launch checklist and `/settings` gain one row.

---

### ADR-011 — The owner summary runs on an hourly trigger with an in-route gate

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **M-26**, implements **TODO-BD-05** · **Affects:** Phase 18

**Context.** §14.5 specifies "Cron, per `system_settings.owner_summary_schedule`". Vercel Cron
schedules are static in `vercel.json` and require a redeploy to change, so a settings-driven
schedule is not directly implementable.

**Decision.** `/api/cron/owner-summary` is scheduled **hourly**. On each firing it reads
`owner_summary_schedule` and sends only when the current Asia/Kolkata hour matches the configured
hour and the configured cadence is due.

**Consequences.** The §24 rule holds — the value stays in `system_settings` and changing it needs
no deploy. Deviates from §14.5's literal wording. The gate must evaluate the hour in
**Asia/Kolkata**, not UTC (see B-10). §14.5's "Log; no retry — a stale summary is worse than none"
still applies: a skipped hour is not made up later.

---

### ADR-012 — Import keeps batch atomicity and drops live progress

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **H-08** · **Affects:** Phase 15

**Context.** §20.5 requires both "one transaction per batch" and "progress reported per 100 rows".
A transaction is invisible to other sessions until it commits, so both cannot hold.

**Decision.** **Preserve import atomicity.** Drop the requirement for live per-100-row progress
reporting. Progress is reported when the atomic transaction completes.

**Consequences.**
- §20.5's "any unhandled error rolls the whole batch back" is kept intact — the guarantee that
  matters for data integrity.
- The UI shows a working/pending state during execution and a full result summary on completion,
  not a live counter.
- The serverless function timeout remains a real constraint at 5,000 rows; the executor must run
  with the longest permitted duration, and the row cap stays at §20.1's 5,000.

---

### ADR-013 — `accounts` gains a database-level contactability constraint

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **M-05** · **Affects:** Phases 3, 8, 15

**Context.** §11.1 and §20.3 both require an account to have a phone or an email, and `contacts`
enforces exactly that with `contact_reachable`. `accounts` had no equivalent constraint, so §5.7's
principle — *"The database enforces the business rules… a bug in the service layer cannot produce
invalid data"* — did not hold for the single most important table in the system.

**Decision.** Add a check constraint on `accounts`:

```sql
constraint account_reachable check (phone is not null or email is not null)
```

**An account must have at least one contact method.** Service and UI validation still provide the
friendly message, but **database integrity is authoritative**.

**Consequences.**
- Adds a constraint to §5.3's DDL — the deviation being approved here. It **strengthens** the
  schema rather than weakening it, and it mirrors a constraint the spec already applies to
  `contacts`.
- Goes into `005_accounts.sql`. Because migrations are append-only once applied (§21.2), it must
  be in the original file, not a later patch.
- `account_reachable` joins the constraint-name → friendly-message map in `lib/errors.ts`
  (§16.2): *"Add a phone number or an email for this customer."*
- The CSV import path (§20.3's "Neither phone nor email present | ERROR") is now backed by the
  database as well as the validator, so a bug in import validation cannot create an unreachable
  account.
- **Legacy import consideration:** historical paper records lacking both a phone and an email
  cannot be imported as accounts. That is the intended behaviour — an unreachable customer record
  answers none of §1.2's five questions.

**Alternatives considered.** Leaving enforcement service-side only (the position held before this
decision) — rejected because it leaves the authoritative rule in the layer §5.7 says must not be
trusted with it.

---

### ADR-014 — Maintenance-job failure state lives in `system_settings`

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** the §14.6 open item left by ADR-002 · **Affects:** Phases 3, 18

**Context.** §14.6 requires the nightly maintenance job to "alert the OWNER by email if the job
fails twice consecutively". That needs persistent state across cron invocations. ADR-002 solved
the per-opportunity SLA case with a column on `opportunities`, but a job-level failure counter
belongs to no business record.

**Decision.** The state lives in `system_settings`. Two keys are added:

| Key | Type | Seed | Meaning |
|---|---|---|---|
| `maintenance_consecutive_failures` | integer | `0` | Consecutive failed maintenance runs |
| `maintenance_last_failure_at` | timestamp (ISO 8601) or null | `null` | When the most recent failure occurred |

The maintenance route updates both **after every execution**. On failure it increments the count
and stamps the timestamp; **when the count reaches 2 the OWNER is notified**. **A successful
execution resets the count to 0.**

**Consequences.**
- **No notifications table** is created merely for this — §4.2's rejection stands.
- This is a deviation in *kind*: §5.10 describes `system_settings` as "controlled values and
  thresholds", i.e. configuration, and these two keys are **operational state**. That is the
  deviation being approved, and it is the smallest available: no new table, eleven tables intact.
- The cron route writes as service-role, which is already permitted on `system_settings`; the
  keys must **not** be user-editable at `/settings`, and they are not thresholds anyone tunes.
- The OWNER alert is sent once at the threshold, not on every subsequent failure, so a
  persistently broken job does not become its own alert-fatigue source.
- `settings.service.ts` remains the only reader; the maintenance route is the only writer.

**Alternatives considered.** A twelfth table for job runs (breaks §4.1 for two integers); an
`opportunity_events` row (the failure belongs to no opportunity); in-memory state (does not
survive a serverless invocation, which is the entire problem).

---

### ADR-015 — Tailwind CSS v4 (CSS-first configuration)

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Supersedes:** the `tailwind.config.ts` entry in the Phase 1 expected-file list
**Affects:** Phase 1 (foundation), Phase 7 (design system)

**Context.** §17.1 freezes "Tailwind CSS" as the styling layer without naming a major version.
The Phase 1 expected-file list in `/docs/IMPLEMENTATION_PLAN.md` named `tailwind.config.ts`, which
is a **Tailwind v3** artifact: v3 configures through a JavaScript/TypeScript config file, while
**v4 is CSS-first** — design tokens live in the stylesheet under `@theme`, and the PostCSS plugin
moves to `@tailwindcss/postcss`. Building a greenfield application on v3 in 2026 would mean
adopting the previous major deliberately. The question surfaced during Phase 1 implementation and
was flagged rather than resolved silently (`CLAUDE.md` §2).

**Decision.** **Tailwind CSS v4 is accepted for the project foundation.**

- The Phase 1 expected-file reference to `tailwind.config.ts` is **superseded** by the Tailwind v4
  CSS-first configuration model.
- The existing v4 implementation in **`src/app/globals.css`** and **`postcss.config.mjs`** is
  **authoritative**.
- **No `tailwind.config.ts` is to be added solely to satisfy the old Phase 1 file list.**

**Scope of this decision.** This is an **implementation/tooling decision only**. It does **not**
change:

- the CRM product requirements (§1–§14),
- the database architecture or the eleven-table model (§4, §5),
- the RLS authorization model (§15),
- the service / Server-Action boundary (§16, §17.2),
- or any other part of the frozen application architecture (§17.1).

Tailwind remains the styling layer named in §17.1; only its configuration mechanism differs from
what the Phase 1 file list assumed.

**Consequences.**
- Design tokens (§12.1 — neutral greys, one accent, semantic state colour) are declared as CSS
  custom properties in `globals.css` and exposed to utilities through `@theme inline`. There is
  one place to read them, which suits the shadcn/ui token model.
- `postcss.config.mjs` loads `@tailwindcss/postcss` rather than the v3 `tailwindcss` plugin.
- shadcn/ui supports v4; `components.json` records `tailwind.config: ""` accordingly.
- A reviewer looking for `tailwind.config.ts` will not find one. That absence is intentional and
  is recorded here so it is never "fixed" by adding the file back.

**Alternatives considered.** Pinning Tailwind v3 to match the original file list — rejected: it
adopts a superseded major for a system with a multi-year life, and the file list was written
before the version question was examined. The file list is descriptive of expected artifacts, not
a specification clause; §17.1 names Tailwind, not a Tailwind major.

---

### ADR-016 — Outlets are a table and outlet scope is a link table; `branch` is retired

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Supersedes:** TODO-BD-12's "columns retained; no UI, filtering or RLS in V1"
**Affects:** Phases 3, 4, and every later phase that reads a business table

**Context.** TODO-BD-12 answered "is a second branch in the planning horizon?" with *keep the
`branch text` columns, build nothing*. The business has since stated the operating reality:
**two outlets today, five to ten across Tamil Nadu expected**, with 16 salespeople and 2 sales
managers. It also stated the permission rule those outlets exist to serve — *a manager sees the
records of the outlet(s) they are assigned to* — and the shapes it must survive: a manager with
zero, one or several outlets; several managers on one outlet; a user moving between outlets
without a role change; an outlet closing without its history disappearing.

`branch text not null default 'MAIN'` cannot express any of that. It is free text, so an outlet
has no identity, cannot be renamed, cannot be deactivated, and cannot be assigned to a person. A
manager's scope would have to be a string comparison against a value nobody controls. Keeping
`branch` *and* adding real outlets would leave two competing concepts in the schema, which the
business explicitly ruled out.

**Decision.**

1. **`outlets` becomes a table.** `code`, `name`, `city`, `is_active`. Outlet names are data, never
   constants, never enum values, and never part of a role name.
2. **`user_outlets` is a link table** — `(user_id, outlet_id)` composite primary key. A user has
   **zero or more** outlets. This is the only expression of outlet scope for a person.
3. **`branch` is deleted, not kept.** Every column that carried it —
   `users.branch`, `accounts.branch`, `projects.branch`, `opportunities.branch` — is replaced.
   On `users` the replacement is the `user_outlets` link; on the three business tables it is
   `outlet_id uuid not null references public.outlets(id)`.
4. **Outlet scope is enforced in RLS**, not in application filtering, through
   `public.manages_outlet(outlet_id)`.
5. **Roles never encode an outlet.** `user_role` keeps its four values. There is no
   `OUTLET_MANAGER_A`, and adding one would be a defect.

**Consequences.**
- **The model grows from eleven tables to thirteen.** This is the deviation being approved here,
  and `CLAUDE.md` §4 requires it to be recorded before the migration is written — which is what
  this entry does. Both new tables are organizational structure, not CRM business records: they
  carry no money, no pipeline stage and no ownership. §4.2's rejected tables stay rejected.
- A manager with **zero** outlets sees only their own records. That is the correct reading of
  "records belonging to their assigned outlet scope(s)" when the scope is empty, and it means a
  newly created manager is safe by default rather than accidentally company-wide.
- **OWNER stays company-wide** and is deliberately *not* modelled as membership of every outlet —
  company-wide authority is a property of the role, and enumerating outlets for the owner would
  silently narrow their access the day an outlet is added.
- Deactivating an outlet is `is_active = false`. Historical records keep pointing at it, so
  reporting over a closed outlet still works. **`outlets` has no DELETE policy**, like every other
  table except `project_stakeholders` (ADR-004).
- Moving a user between outlets is an edit to `user_outlets` and touches neither their role nor
  their records.
- `outlet_id` is `not null` on the three business tables. A record that belongs to no outlet would
  be invisible to every manager, which is precisely the accountability gap the CRM exists to close.
- `handle_new_auth_user()` no longer defaults `branch` to `'MAIN'` (ADR-009); a provisioned user
  starts with **no** outlet, and OWNER/ADMIN assigns one.
- §5.10's settings keys are unaffected. **Outlets are rows, not settings** — they are referenced by
  foreign key from business records, which a `system_settings` JSON array cannot do.

**Alternatives considered.**
- *Keep `branch` and add a `manager_branches text[]` column on `users`.* Rejected: outlets still
  have no identity, renaming an outlet silently orphans a manager's scope, and an array column
  cannot be foreign-keyed or deactivated.
- *A single `outlet_id` on `users`.* Rejected outright by the stated requirement — a manager may
  hold several outlets, and one manager per outlet was explicitly named as an assumption not to
  make.
- *Outlets in `system_settings.outlets` as JSON.* Rejected: business records must reference an
  outlet by foreign key, and referential integrity is not available against a JSON array.
- *Derive a record's outlet from its owner's membership.* Rejected: reassigning an opportunity to a
  salesperson at another outlet would silently move historical records between outlets, and a
  record owned by an unassigned (`owner_id is null`) opportunity would belong nowhere.

---

### ADR-017 — ADMIN does not receive automatic business-data visibility

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Supersedes:** the "See all records" ✔ for ADMIN in §3.1, and ADMIN's membership of
`is_manager_or_above()` in §15.1
**Affects:** Phases 3, 4, and every RLS policy on a business table

**Context.** §3.1 grants ADMIN "See all records", and §15.1 defines
`is_manager_or_above()` as `role in ('MANAGER','OWNER','ADMIN')`, so ADMIN passed the read policy
on every business table. §3.2 simultaneously describes ADMIN as "a system/data role, not a sales
role: no dashboards, no reassignment, no export". The business has now stated the position
plainly: **ADMIN administers users, configuration, imports and the system; it does not carry an
automatic right to read the pipeline.**

Those two readings cannot both hold in a policy. Between them, the narrower one is the one that
matches how the role is actually used and the one whose failure mode is a support request rather
than a customer-data leak.

**Decision.** `is_manager_or_above()` resolves to **MANAGER or OWNER**. ADMIN is removed from it.
ADMIN keeps everything its administrative function requires, through `is_owner_or_admin()`:
`users`, `user_outlets`, `outlets`, `system_settings`, `import_batches` and `import_rows`.

**Consequences.**
- ADMIN reading `accounts`, `contacts`, `projects`, `opportunities`, `activities` or
  `opportunity_events` gets **their own records only** — the same as any user with no elevated
  business role. This carries a dedicated negative test.
- The helper keeps its specified name so §15 and `CLAUDE.md` §6 still describe where role lookups
  happen; only its membership changes. Reviewers reading "or above" should read it as *above
  SALESPERSON in the sales hierarchy*, which ADMIN is not on.
- An administrator who genuinely needs pipeline visibility is given the OWNER role or a MANAGER
  role with outlet scope — an explicit, auditable grant rather than a side effect of holding the
  keys to user provisioning.
- Import remains ADMIN's (§3.1), and the import executor runs as service-role, so ADMIN's loss of
  direct read access does not affect it.
- §3.1's ADMIN row for "See all records" is contradicted. Recorded in `/docs/SPEC_AUDIT.md`.

**Alternatives considered.** Leaving ADMIN inside `is_manager_or_above()` — rejected: it grants the
role that provisions users a silent, untested read over every customer record in the business,
which is the opposite of what §3.2 says the role is for.

---

### ADR-018 — The database runtime is plain PostgreSQL with a platform bootstrap when Docker is unreachable

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Affects:** Phases 3 onward, CI, `/docs/SETUP.md`, `/docs/TESTING.md`

**Context.** §19.2 requires the integration and RLS suites to run against a real database, and §7
of this build requires generated types to come from a verified database and never to be
hand-written. `supabase start` pulls its images from `public.ecr.aws`, whose blob CDN
(`d2glxqk2uabbnd.cloudfront.net`) is **denied by the environment's egress policy**. `supabase gen
types --local` shells out to the `postgres-meta` container and fails the same way. Working around
the egress policy is not an option, and neither is declaring the phase verified without ever
executing the SQL.

**Decision.** Migrations, tests and type generation run against a **real PostgreSQL 16 server**,
with the Supabase platform objects the application depends on created by a bootstrap file that is
**not a migration**:

- `supabase/platform/000_supabase_platform.sql` creates the roles (`anon`, `authenticated`,
  `service_role`, `authenticator`, `supabase_admin`), the `auth`, `extensions` and `graphql_public`
  schemas, `auth.users`, and `auth.uid()` / `auth.jwt()` / `auth.role()` / `auth.email()` **with
  the platform's own definitions**, which read `request.jwt.claims`.
- Migrations are applied by the **Supabase CLI** (`supabase migration up --db-url`), which needs no
  container, so migration ordering and the `supabase_migrations` ledger are exercised for real.
- Types are generated by **`@supabase/postgres-meta`** — the same generator the
  `supabase gen types` container runs — invoked as a library against the same database.

**Consequences.**
- Tests impersonate a user exactly as PostgREST does: `set role authenticated` plus
  `set request.jwt.claims`. An RLS test is therefore a test of the policy, not of a mock, and it
  fails for the same reasons a production request would.
- **Two dev dependencies are added**, both `devDependencies` only, both shipping nothing to the
  browser, and both consequences of the same decision. §17.1 requires the reason to be recorded
  before installation — this entry is that record.
  - **`@supabase/postgres-meta`**, pinned to the version the CLI's container image uses, for type
    generation.
  - **`pg`** (plus `@types/pg`), for the integration and RLS suites. §19.2 assumed the suite would
    reach the database through PostgREST on the local Supabase stack; without that stack the tests
    connect to PostgreSQL directly and impersonate a user the way PostgREST does — `set role
    authenticated` plus `set_config('request.jwt.claims', …)`. `pg` is already present as a
    transitive dependency of `@supabase/postgres-meta`; declaring it is honesty about what the
    test harness imports, not an extra download.

  No runtime dependency, no application code and no architecture changes.
- `npm run db:types` keeps its Supabase-CLI definition for machines that can reach Docker;
  `npm run db:types:nodocker` is the equivalent that does not need it. **Both write the same file
  from the same generator.**
- The bootstrap reproduces **only** what Supabase guarantees and the application actually uses. It
  is not a Supabase reimplementation: there is no GoTrue, no PostgREST, no Storage, and nothing in
  `supabase/migrations` may depend on anything it defines beyond those objects.
- What this runtime **cannot** verify is recorded honestly rather than assumed: Supabase Auth's own
  behaviour (password hashing, JWT issue, its built-in login rate limiting, C-5), Storage buckets
  and their policies (§15.6), and PostgREST's request handling. Those need a real Supabase project
  and stay open until one is provisioned in `ap-south-1` (TODO-BD-08).
- `supabase/config.toml` still declares `major_version = 17`; the local runtime is PostgreSQL 16.
  Nothing in the schema uses a 17-only feature, and the remote project remains the authority.

**Alternatives considered.** Waiting for a remote Supabase project (blocks every downstream phase
on infrastructure provisioning that is not this phase's work, and would put an unverified schema
into a shared environment); hand-writing `database.types.ts` (forbidden, and it would stop
reflecting the database the moment either drifted); declaring Phase 3 verified without executing
the SQL (a fabricated result — `CLAUDE.md` §15).

---

### ADR-019 — `opportunity_events.created_at` defaults to `clock_timestamp()`

**Status:** Accepted · **Date:** 2026-08-19 · **Decided by:** Project Owner
**Resolves:** audit **P1-05** · **Affects:** Phase 3, and every reader of the audit trail

**Context.** §5.9 declares `created_at timestamptz not null default now()`. In PostgreSQL `now()`
is **transaction start time**, identical for every statement in a transaction — it is
`transaction_timestamp()` under another name.

§16.3 requires `changeOpportunityStage`, `logActivity` and `bulkReassign` to run as **single
transactions**, and `log_opportunity_event()` writes one row per change it observes. A stage change
and a reassignment applied in one RPC therefore produce two events carrying an **identical**
timestamp, and §5.9's own index — `(opportunity_id, created_at desc)`, the index that exists
specifically so the trail can be read in order — cannot separate them. The order the timeline shows
is whatever the planner returns, and it may differ between two reads of the same data.

Multi-event transactions are the normal case here, not an edge case, so this is a defect in the
audit trail's central promise: that it is a faithful, readable record of what happened and when.

**Decision.** The column defaults to **`clock_timestamp()`**, which returns the actual wall-clock
instant at the moment the row is written. Events written in one transaction receive distinct,
correctly ordered timestamps.

**Nothing else about the audit model changes.** The trigger remains the single writer; there is
still no INSERT, UPDATE or DELETE policy; the reason still arrives through the `app.event_reason`
GUC (ADR-001); the actor still falls back to the system user (ADR-003).

**Consequences.**
- A deviation from §5.9's DDL — the deviation being approved here. It is a **correction toward the
  spec's stated intent** rather than away from it: §5.9 exists so that "no path can bypass the
  audit", and an audit nobody can order is not one that can be relied on.
- `created_at` on this table now means *when the event happened*, while `created_at` elsewhere in
  the schema means *when the row's transaction began*. That difference is deliberate and is exactly
  the distinction between an audit log and an ordinary record.
- The change is confined to `013_opportunity_events.sql`, which **has never been applied to any
  shared environment** — no hosted project exists — so §21.2's append-only rule is not engaged.
  Once a shared environment exists, a change like this becomes a new migration.
- `clock_timestamp()` is `VOLATILE`. That is fine in a column default, and the column is not used
  in an index expression or a generated column, so nothing else is affected.
- An event timestamp may now be **later** than the `updated_at` of the opportunity that caused it,
  by microseconds. Readers must not assume the two are equal; they never meaningfully were.

**Alternatives considered.**
- *Leave `now()` and order by a tiebreaker.* There is none: the primary key is a random uuid, and
  adding a sequence column to an append-only table to work around a wrong default is more schema
  for a worse result.
- *Order by `id`.* `gen_random_uuid()` is not monotonic; this would produce a stable but
  **arbitrary** order, which is worse than an obviously unstable one because it looks correct.
- *`statement_timestamp()`.* Distinguishes statements but not two rows written by one trigger
  invocation, which is precisely the case §16.3 creates.

---

# C. Product decisions closing the remaining audit findings

Five questions the audit raised that are neither `TODO-BD` items nor architecture changes.
All decided 2026-08-19 by the Project Owner. Recorded here because they are product and
permission positions, not defects.

### C-1 — Audit trail scope and surface (resolves **H-13**)

- **The question.** §3.1 grants MANAGER "View audit trail (own team)", but `users` has no
  `team_id` or `manager_id`, and §12.2 defines no audit route.
- **Decision.**
  - **V1 has one manager.** "Own team" is interpreted as **the salespeople operating under the
    current single-manager structure** — in practice, all of them.
  - **Do not add `team_id` or `manager_id`.** No team model enters the schema.
  - The audit trail is exposed **through the opportunity detail timeline**.
  - **Audit events must be visually and semantically distinguishable from normal activities** —
    they answer different questions (§10.1: activities are what the salesperson did with the
    customer; events are what the system recorded about the record). Distinct iconography,
    distinct labelling, and never interleaved in a way that implies a person performed a system
    action.
  - **No separate `/audit` route in V1.**
- **Consequences.** No schema change. `opportunity_events` SELECT is already gated on
  `can_see_opportunity()`, which gives MANAGER/OWNER/ADMIN everything and a salesperson their own
  — matching the interpretation without new policy work. §12.2's route map is unchanged.
- **If a second manager is ever hired**, the "own team" scope becomes a real question again and
  needs a team model — a V2 decision, recorded then.

### C-2 — Manager CSV export surface (resolves **M-02**)

- **The question.** §3.1 grants MANAGER "Export CSV ✔", but §21.4 specifies export only at
  `/settings`, which MANAGER cannot reach (§12.2); ADMIN can reach `/settings` but has export ✘.
- **Decision.** **Manager CSV export is available directly from the relevant manager-accessible
  list and report screens** — `/opportunities`, `/accounts`, `/projects`, `/team`, `/reports` —
  exporting the current filtered view. **The manager's export capability must not live only under
  `/settings`.**
  - OWNER keeps the `/settings` bulk export described in §21.4 **as well**.
  - **The ADMIN export restriction is preserved** (§3.1: ADMIN export ✘). ADMIN can reach
    `/settings` but the export control is not rendered there for ADMIN, and the export action
    rejects ADMIN server-side. A hidden button is not a control (§19.4).
- **Consequences.** Export becomes a capability check (`role in (MANAGER, OWNER)`) applied at the
  Server Action, not a property of a route. Exported rows are scoped by RLS, so a manager's export
  and a manager's screen always agree.

### C-3 — Account archive behaviour (resolves **M-06**)

- **The question.** §8.8 says both "archiving an account does **not** cascade-archive its
  opportunities" and "the service layer archives children explicitly and reports what it will
  archive before doing so". The two halves contradict each other.
- **Decision.** Archiving an account is a **four-step controlled operation**:
  1. **Preview** the complete set of affected child records.
  2. **Clearly display** what will be archived.
  3. **Require explicit confirmation.**
  4. **Archive the account and its explicitly defined child records as one controlled operation.**
- **The preview is informational.** Individual child records **do not require separate opt-ins** —
  the user confirms the operation, not each row.
- **No hard delete**, at any step, for any record.
- **Consequences.** Reconciles §8.8: there is no *silent* cascade (the first half's real concern),
  and there is a *single confirmed* operation (the second half's mechanism). The "explicitly
  defined child records" are the account's opportunities, projects and contacts; activities and
  opportunity events are history and are never archived — they remain readable, which is the
  §8.8 guarantee that archived records "retain all relationships and activities".
- Restore reverses the same set.

### C-4 — Creation and edit routes (resolves **M-11**)

- **The question.** §12.2's route map omits surfaces the flows require, and modal-vs-route was
  unspecified — which affects deep-linking and E2E scenario URLs.
- **Decision.** Use **explicit routes**:

  | Route | Serves |
  |---|---|
  | `/opportunities/new` | §12.3's `+` sheet → New Opportunity |
  | `/contacts/new` | §11.4 contact creation |
  | `/projects/:id/edit` | Project editing |
  | `/opportunities/:id/edit` | Opportunity editing |

  For **account tab navigation** (§12.4's Projects · People · All activity · Files · Details), use
  the **existing `/accounts/:id` route with explicit URL/query state** — e.g.
  `/accounts/:id?tab=projects` — **rather than inventing unnecessary nested routes**.
- **Consequences.** Every creation and edit surface is deep-linkable and directly addressable by
  the Playwright suite. `FilterBar`'s existing "state in URL params" convention (§12.5) extends to
  tab state, so the pattern is one pattern, not two. §12.2's map is extended, never contradicted.

### C-5 — Login rate limiting (resolves **M-12**)

- **The question.** §15.8 requires rate-limited login attempts, but §17.1 rejects Redis and message
  queues, and a serverless host has no shared memory.
- **Decision.** **Use Supabase Auth's built-in authentication rate limiting for V1.**
  **Do not add Redis or any other distributed rate-limiting infrastructure.**
  - The application must **correctly surface throttling / rate-limit failures without leaking
    implementation details** — a plain-language "Too many attempts. Try again shortly." and never
    the provider's raw error, retry-after internals, or any hint of which credential was wrong.
  - **Automated tests cover rate-limit and error behaviour**: repeated failed logins eventually
    throttle, the thrown error maps to `AppError` rather than a provider string, and the UI
    renders the plain-language message.
- **Consequences.** §15.8 is satisfied without touching the frozen stack. The behaviour depends on
  the platform's configured limits, so those limits are recorded in `/docs/DEPLOYMENT.md` once the
  projects are provisioned.

### ADR-020 — Three denormalised columns are maintained by database triggers, not by services

**Status:** Accepted
**Date:** 2026-08-19   **Decided by:** Engineering, during Master Phase 2

**Context.** Three values the specification stores rather than derives —
`opportunities.stage_changed_at` (§5.7), `accounts.last_activity_at` /
`opportunities.last_activity_at` (§5.3, §5.7), and `accounts.status = 'ACTIVE'` on a win (§8.7) —
were left to "the service writes it". Building the activity flow exposed that this cannot work.

A salesperson may log an activity against an account they do **not** own, on the strength of
owning an opportunity attached to it — the work-context rule of §3.2, expressed in the
`activities_insert` policy as `can_read_account(account_id)`. But `accounts_update` requires
ownership or outlet management. So a service-layer `update accounts set last_activity_at = …`
issued by that same salesperson matches **zero rows** and silently succeeds. Recency on the
Customer 360 header, and every dormancy query built on it, would quietly stop moving for exactly
the collaborative accounts where activity matters most. The same reasoning applies to promoting
an account to `ACTIVE` when a work-context opportunity is won.

`stage_changed_at` fails differently: `opportunities_update` permits a manager to change `stage`
through a direct PostgREST call, which leaves the clock reading the old value, so `days_in_stage`
under-reports and a stalled opportunity looks fresh.

**Decision.** Migration 018 moves all three into triggers:

- `touch_stage_changed_at()` — BEFORE UPDATE, plain SECURITY INVOKER; it only writes to the row
  already being updated.
- `touch_last_activity_at()` — AFTER INSERT on `activities`, SECURITY DEFINER, using
  `greatest(...)` so a back-dated activity never makes an account look staler than it is.
- `apply_won_account_status()` — AFTER UPDATE on `opportunities`, SECURITY DEFINER, promoting
  `PROSPECT → ACTIVE` only. Deliberately one-directional: reopening a won opportunity (ADR-007)
  does not demote the account, because it may hold other won opportunities and a customer who has
  bought once has bought. `DORMANT` and `DO_NOT_CONTACT` are left alone — a sale does not overrule
  an instruction not to contact somebody.

**Consequences.** The two SECURITY DEFINER triggers run with the table owner's rights, which is
the same mechanism `log_opportunity_event()` (§5.9) and `handle_new_auth_user()` (ADR-009) already
rely on. They are a *system consequence of a write the caller was already authorized to make*, not
a new privilege: each fires only from an insert or update that RLS had to permit first. They add
no callable surface — `EXECUTE` is revoked from `public` and `anon`, and an integration test
asserts that neither `authenticated` nor `anon` can invoke any of them directly.

The services become simpler and, more importantly, cannot forget. Reviewers must know that these
three columns are not written by application code; writing them there again would be a defect.

**Alternatives considered.**
- *Leave it in the services and widen `accounts_update`.* Rejected: work context grants read, not
  write (§15.4), and widening it to make a denormalised column writable would hand a salesperson
  edit rights over another person's customer record.
- *A SECURITY DEFINER helper function the service calls.* Rejected: any authenticated user could
  then call it through PostgREST and flip an arbitrary account to `ACTIVE`, or backdate somebody
  else's recency. A trigger has no such surface.
- *Compute all three in queries instead.* Rejected for `last_activity_at` and `stage_changed_at`:
  §5.7 stores them, they are indexed, and the dormancy and stall queries scan them. `status` is a
  business state a user can also set by hand, so it cannot be derived at all.

---

---

### ADR-021 — Sales targets are a table, not a `system_settings` key

**Status:** Accepted · **Date:** 2026-08-20 · **Decided by:** Project Owner
**Affects:** Master Phase 3, `/reports/targets`, `services/target.service.ts`, migration 021

**Context.** Master Phase 3 §10 requires a monthly sales-target mechanism at company, outlet and
salesperson level, and instructs that an existing settings structure be preferred over a new table.
The specification has no target concept at all, so this is an addition to it recorded here rather
than a reading of it (CLAUDE.md §2).

`system_settings` was the obvious candidate: it is a key→jsonb store, OWNER/ADMIN already write it,
and a nested `{ "2026-08": { company, outlets, users } }` document would have carried every scope
with no schema change.

**It cannot carry this, for one reason that is not fixable by nesting the data differently.**
`system_settings_select` grants **every authenticated user read on every settings row**, on purpose:
stage probabilities and the city list are needed to render almost any screen, and a per-key policy
would mean a policy per key. A monthly sales target is management data. Storing it in
`system_settings` would publish the company's target — and every salesperson's individual target —
to every salesperson through a single PostgREST call. No UI gating changes that (CLAUDE.md §6), and
Master Phase 3 §20 requires an integration test proving a salesperson cannot reach management data.
That test would have failed, correctly.

**Decision.** A fourteenth table, `public.sales_targets`, with its own RLS.

- Columns: `period_month` (always a month start), `outlet_id` (null = company-wide),
  `user_id` (null = the whole outlet), `target_paise`, `note`, audit columns.
- `target_user_requires_outlet` — a person's target is always a target **at** an outlet, so the RLS
  policy can read scope from `outlet_id` alone.
- Three **partial** unique indexes, one per scope. A plain three-column unique constraint would not
  work: `null` is distinct from `null` in a unique index, so unlimited duplicate company rows would
  be legal.
- RLS: `outlet_id is null` → OWNER only; otherwise `manages_outlet(outlet_id)`. SALESPERSON and
  ADMIN match neither branch and see nothing.
- **No DELETE policy.** The schema still holds exactly one, on `project_stakeholders` (ADR-004). A
  target is withdrawn by setting it to **zero**, and `targetProgress()` reports a zero target as met
  rather than as a 0% failure — "no target" and "a target of zero" are different facts and render
  differently.
- `guard_target_scope()`, a trigger mirroring `guard_record_scope()`: the UPDATE policy's WITH CHECK
  only proves the caller manages the **destination** outlet, so without the trigger a manager of two
  branches could re-point one branch's target at the other and quietly erase it from the first
  branch's reporting.

**Consequences.**
- §4.1's "eleven tables, no more" now reads eleven + `outlets` + `user_outlets` (ADR-016) +
  `sales_targets`. `tests/integration/service-contracts.test.ts` asserts the exact list, so a
  fifteenth table fails the suite until an ADR justifies it. That test caught this addition, which
  is the mechanism working.
- Targets are **planning figures, not accounting records** (§2.2). No metric depends on one
  existing; every screen renders an em dash without one.
- Scales to five or ten outlets with no shape change: one row per scope per month.

**Alternatives considered.** A `system_settings` key (rejected above — it leaks). A per-key policy on
`system_settings` (turns a two-policy table into a policy-per-key table, and every future key becomes
a security decision). Deriving targets from last year's actuals (invents a number the business did
not set — CLAUDE.md §15).

---

### ADR-022 — Management metrics are aggregated in SQL by SECURITY INVOKER RPCs

**Status:** Accepted · **Date:** 2026-08-20 · **Decided by:** Project Owner
**Affects:** Master Phase 3, migration 022, `services/analytics.service.ts`

**Context.** PostgREST cannot `GROUP BY`. The Phase 2 pipeline tile therefore selected up to 5,000
rows with `.limit(5000)` and reduced them in Node. That is acceptable for one tile on one screen and
unacceptable for a management layer, for two reasons: the transfer grows with the pipeline, and a set
larger than the limit is **silently truncated** — a dashboard that quietly under-reports is worse
than one that fails.

**Decision.** Thirteen aggregate functions in migration 022, every one **SECURITY INVOKER**, so RLS is
evaluated exactly as it is for a table read. An RPC buys atomicity and aggregation, never authority
(§16.3).

Four rules the file holds to:

1. **`plpgsql`, not `sql`.** The management gate must run whether or not the query matches a row.
   Written as a WHERE predicate inside a `language sql` body it is subject to the planner: against a
   caller who can see nothing, the scan yields nothing and the gate may never be evaluated — the
   caller gets a polite empty report instead of a refusal. `perform` on the first line of a plpgsql
   body is unconditional. **A security control must not depend on a planner decision.**
2. **No threshold is written in the file.** Stall days, dormancy days, the high-value threshold and
   the stage probabilities all arrive as parameters from the settings service (CLAUDE.md §3).
3. **Period boundaries arrive as instants** computed by `lib/dates.ts` from Asia/Kolkata day
   boundaries. Where SQL must bucket by month it does so explicitly at `Asia/Kolkata`; a bare
   `date_trunc` would bucket in the session timezone — UTC on Supabase — and put the first five and a
   half hours of every Indian month in the previous one (CLAUDE.md §10).
4. **`p_limit` is capped at 1000**, which is `max_rows` in `supabase/config.toml`. PostgREST
   truncates beyond that number without saying so, so a higher ceiling would be a promise the
   transport cannot keep.

**`assert_management_access()`** refuses SALESPERSON and ADMIN at the database boundary. Without it a
salesperson calling `management_team_workload` through PostgREST would receive a one-row report of
their own numbers — no other person's data, because RLS holds, but a team surface all the same, and
Master Phase 3 §4 is explicit that team dashboards are not a salesperson surface.

**`scoped_outlet_ids()`** answers "which branches may this caller compare". OWNER resolves to every
**active** outlet at read time rather than to membership rows, so a branch opened tomorrow is in
scope tomorrow (ADR-016).

**Consequences.**
- One round trip per dashboard block, issued concurrently. No N+1, no unbounded query, no silent
  truncation.
- Grants are made **function by function**. A blanket `grant execute on all functions in schema
  public` re-exposed the SECURITY DEFINER trigger functions that migration 018 had deliberately
  revoked; `tests/integration/service-contracts.test.ts` caught it, and the per-function grant is the
  fix.
- The at-risk predicate in SQL is the **union of the risk reasons**, not a second copy of them.
  Naming which reasons apply is `classifyRisk()` in `lib/metrics.ts`, which is pure and unit-tested.
  High-value-at-risk is a strict subset of overdue-or-stalled, so the SQL does not restate it —
  a unit test asserts that reason never appears alone, which is what makes the two agree.

**Alternatives considered.** Reducing rows in Node (silent truncation, unbounded transfer). Views
(cannot take a period parameter). Materialised views (an extra thing to refresh, invisible staleness,
and no measured performance problem to justify it). A separate analytics warehouse (§16 forbids it).

---

### ADR-023 — The management trend and proportion visuals are inline SVG, not Recharts

**Status:** Accepted · **Date:** 2026-08-20 · **Decided by:** Project Owner
**Affects:** `features/management/charts.tsx`

**Context.** §13.4 specifies "Won Value by month, last 12 months — one line chart", and §13.3 Panel B
shows workload as bars. Recharts is in the frozen stack (§17.1), so using it would need no approval —
this entry records the decision **not** to, which is the one that deserves an explanation.

**Decision.** Both visuals are server-rendered inline SVG and CSS, with no charting dependency and no
client JavaScript.

**Reasoning.** These are a bar whose width is a percentage and a twelve-point polyline. Recharts would
make both Client Components, ship a charting runtime to a phone in a showroom, and replace nine lines
of SVG with a dependency. §17.1's own instruction is to prefer the platform. The management screens
come in at 118 kB first-load as a result, against a 103 kB shared baseline.

**Consequences.**
- Every visual is also stated in text beside itself, so the figures survive greyscale, sunlight and a
  screen reader (§12.1) — and the screens degrade to something perfectly readable if the SVG does not
  render.
- The trend line's y-axis starts at zero, deliberately: a line scaled to its own minimum turns a 3%
  variation into a cliff.
- **This is not a rejection of Recharts.** A genuinely interactive chart — tooltips, zoom, a brush —
  would be a different decision and Recharts would be the right answer to it. Adding it later needs no
  new approval; it is already in the frozen stack.

---

### ADR-024 — An unauthenticated API request is answered with 401, not a redirect

**Status:** Accepted · **Date:** 2026-08-20 · **Decided by:** Project Owner
**Affects:** `src/middleware.ts`

**Context.** The middleware redirected every unauthenticated request to `/login`. For a page that is
right. For `/api/export/opportunities` it is not: the caller follows the redirect, receives the login
page as **HTML with status 200**, and a script downloading a CSV writes that HTML into a `.csv` file
believing it has data. The Phase 3 smoke test asserted "a signed-out visitor gets no data" and failed
on the 200, which is how this was found.

**Decision.** A request to `/api/*` without a session is answered `401` with a JSON body. Page routes
keep the redirect, including the `?next=` destination that resumes an interrupted task.

**Consequences.** A refusal is legible from the status line. The rule is in the middleware, so every
route handler added later inherits it.

**Open for Master Phase 4.** `/api/cron/*` is authenticated by a shared secret rather than a session
(§14.7), so those routes will need an exemption when they are built. They do not exist yet — Phase 3
does not build cron (§22) — and the behaviour is unchanged from Phase 2, which redirected them.
Recorded here so it is not discovered as a mystery.


## Master Phase 4 — operations, data and automation

### ADR-025 — Import notification suppression is a durable column, not a transaction-local flag

**Status:** accepted, 2026-08-20 · **Supersedes the mechanism in §20.5, not its intent**

§20.5 says a **transaction-local flag** suppresses SLA notification eligibility during an import.
A transaction-local flag cannot do that job. The SLA reminder is a cron route that runs hourly,
long after the import transaction has committed and its GUC has gone; Phase 15's own risk note
says the suppression "must survive the cron path, not just the request path", which is precisely
what a GUC cannot do.

**Decision.** The mechanism is the **`is_imported` column that §20.5 already requires on every
created row**, and the cron queries exclude it. `026_contacts_import_columns.sql` adds the column
to `contacts`, which was missing all three provenance columns (see below).

This is also the truthful rule rather than a workaround. A customer copied out of a 2019 paper
register is **not** a new enquiry that somebody failed to answer within forty-eight hours, and it
never becomes one — not an hour after the import, and not a year after it. The intent of §20.5 is
fully served; only the mechanism differs, and the durable one is strictly stronger.

**Defect fixed alongside.** `contacts` carried none of `is_imported`, `legacy_ref` or
`import_batch_id`, although §20.2 lists `legacy_ref` in the contacts template and §20.5 requires
all three on every imported row. Without them an imported contact was indistinguishable from a
typed one, so §20.6's rollback could not find it and the seven-day undo silently covered only
half of what was imported. Added in a **new numbered migration**, per H-03 and §21.2.

**Tested.** `tests/integration/automation-state.test.ts` — an imported opportunity is never
SLA-eligible; `import-execution.test.ts` — every created row carries all three columns, and
rollback finds contacts as well as accounts.

---

### ADR-026 — `merge_accounts` is `SECURITY DEFINER`, with its authorization written into the function

**Status:** accepted, 2026-08-20 · **Narrow exception to CLAUDE.md §8's SECURITY INVOKER rule**

CLAUDE.md §8 requires multi-table write RPCs to be `SECURITY INVOKER` so RLS still applies.
`merge_accounts` cannot be, and the reason is specific rather than convenient.

`activities` is append-only with a **24-hour, author-only** edit window (§5.8). A manager has no
UPDATE path to it at all, by design. But an activity is keyed to `account_id`, and a merge that
left the activities behind would strand the customer's entire history on a record that is about
to be archived — the Customer 360 timeline the whole system exists to produce (§1.2) would come
up empty for the surviving customer.

**Decision.** `merge_accounts` is `SECURITY DEFINER`, in the same sense as `log_opportunity_event()`
and the ADR-020 triggers: it performs a system consequence of an action the caller was already
authorized to take. The authorization the DEFINER context skips is written into the function and
runs first:

- `is_manager_or_above()` — a salesperson and an ADMIN are both refused;
- `can_read_account()` on **both** records — otherwise a manager could merge a record from an
  outlet they do not manage into one they do, which is a way to read another outlet's data;
- neither record may be archived.

It is not a way to edit an activity. `performed_by`, `summary`, `occurred_at` and every other
column are untouched — history is not rewritten (§8.1). Only the customer the activity hangs off
moves.

**Tested.** `tests/integration/archive-and-merge.test.ts`, as the restricted role in every case:
salesperson refused, ADMIN refused, manager refused for an out-of-scope record, authorship
preserved, nothing deleted.

---

### ADR-027 — A `MERGED` opportunity event type

**Status:** accepted, 2026-08-20 · **Extends `opportunity_event_type`; no new table**

ADR-008 makes account merge irreversible in V1, which raises the bar on its audit rather than
lowering it: what the merge moved must be recoverable by reading. §9.2 requires every
system-recorded change to an opportunity to appear in `opportunity_events`, and CLAUDE.md §13
requires the trigger on `opportunities` to remain that table's **single writer** — so the merge
cannot insert its own audit row, and none of the eight existing event types means "this
opportunity was moved to another customer record".

**Decision.** Add `MERGED` to `opportunity_event_type` and extend the trigger to write it whenever
`account_id` changes, carrying `from_account_id`, `to_account_id` and the ADR-001 reason. Nothing
but `merge_accounts` moves an opportunity between accounts, so any such change **is** a merge.

**No merge-history subsystem and no twelfth table** — the phase brief rejects both, and one event
row per moved opportunity is the audit ADR-008 asks for.

The enum value gets its own migration (`023`). PostgreSQL refuses to use a new enum value inside
the transaction that added it, and the Supabase CLI applies each migration file in its own
transaction; splitting them is what keeps the sequence applyable from empty in one pass.

---

### ADR-028 — Resend is called over HTTP; the SDK is not installed

**Status:** accepted, 2026-08-20 · **No new dependency**

§17.1 names Resend as the V1 email implementation and freezes the dependency list. Resend's send
endpoint is a single authenticated POST, and the SDK would ship a wrapper around `fetch` to make
it.

**Decision.** `services/integrations/notification.ts` calls the HTTP API directly. Resend remains
the implementation; only the client is ours. This is the same call the repository already made
twice — `Intl` instead of `date-fns-tz` (M-13), a hand-rolled magic-byte check instead of
`file-type` (M-14).

**M-28 still binds.** `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are both required. A deployment
missing either does **not** silently pretend to send: the jobs count the attempts as failures and
log the reason, which is what an operator needs to see.

---

### ADR-029 — `automation.service.ts` is a permitted service-role caller

**Status:** accepted, 2026-08-20 · **Clarifies ADR-009's "cron routes"**

ADR-009 permits three service-role callers, one of them "cron routes". CLAUDE.md §8 requires the
business logic to live in `src/services/*` and route handlers to do four things only. Those two
rules together mean the code that actually needs the service-role client is the service the cron
routes call, not the route files.

**Decision.** The ESLint boundary lists `src/services/automation.service.ts` alongside the cron
routes, the import executor and user provisioning. The routes stay thin: authenticate, call, map.
The permitted set is still exactly the cron execution path, the import executor and user
provisioning — expressed where the code lives.

`src/features/management` was also added to the §18 feature-boundary list, which it had been
missing since Master Phase 3, so the no-cross-feature-import rule is now enforced on it.

---

### ADR-030 — Two optional import columns the schema requires and §20.2 predates

**Status:** accepted, 2026-08-20

§20.2's templates were written before ADR-016 replaced §5.3's free-text `branch` with a real
outlet reference, and `accounts.outlet_id` is `not null`. `contacts.owner_id` is `not null` and
§20.2's contact template has no owner column at all. Neither can be satisfied by the templates as
written, and neither may be invented (CLAUDE.md §15).

**Decision.** Two **optional** columns, both defaulting to something already true rather than to a
guess:

| Column | Entity | Default when blank |
|---|---|---|
| `outlet_code` | accounts | the owner's current outlet |
| `owner_email` | contacts | the linked customer's owner, else the person running the import |

A row that cannot resolve either way is an **ERROR** with a message naming the column — never a
silently invented value. `source` defaults to `OTHER` rather than §5.3's `WALK_IN` for the same
reason: a paper register says nothing about how the customer arrived, and recording every
historical customer as a walk-in would put invented data into the source report.

---

## Master Phase 2 corrections

Three defects were found and fixed while building the Core CRM. Recorded here because each
changed behaviour that Master Phase 1 had signed off.

| Defect | Where | Fix |
|---|---|---|
| `en-GB` abbreviates September as **"Sept"** — four letters — while every other month uses three, so §8.11's `dd MMM yyyy` was violated one month in twelve and date columns lost their alignment | `lib/dates.ts`, `lib/opportunity/title.ts` | Month taken from `en-US` (always three letters) and the `dd MMM yyyy` order imposed explicitly via `formatToParts`. Regression test covers all twelve months |
| A `datetime-local` value carries no timezone; sending it to a `timestamptz` column made PostgreSQL read it in the session timezone (UTC), so a back-dated activity landed 5½ hours late | activity Server Action | `businessLocalToUtc()` anchors the wall-clock value to Asia/Kolkata before it is sent (CLAUDE.md §10) |
| `expectRejected()` left the transaction aborted, so a second assertion in the same test failed with `25P02` rather than the rule under test — a test asserting only "it was rejected" could pass for the wrong reason | `tests/integration/harness.ts` | Each rejection now runs inside its own savepoint |

---

## Open items — none

Every audit finding and every follow-on question is resolved. For the record, the eleven items
that were open after the first decision pass and how each closed:

| Ref | Closed by |
|---|---|
| **H-13** — audit trail scope and surface | **C-1** — single-manager interpretation; timeline surface; no `/audit`, no team model |
| **M-02** — manager export surface | **C-2** — export from manager list/report screens; ADMIN restriction preserved |
| **M-05** — accounts contactability constraint | **ADR-013** — `account_reachable` check constraint added |
| **M-06** — archive cascade ambiguity | **C-3** — preview → display → confirm → one controlled operation |
| **M-11** — missing creation/edit routes | **C-4** — explicit routes; account tabs via query state |
| **M-12** — login rate limiting | **C-5** — Supabase Auth built-in; no Redis; tested |
| **H-10 sub** — `verbal_confirmation` in the quotation constraint | Confirmed: the constraint narrows to **`quoted` only**. Neither `negotiation` nor `verbal_confirmation` requires quotation fields. **ADR-006 updated** |
| **H-11 sub** — `accounts.status` on reopen | Confirmed: **do not automatically change `accounts.status`.** The account may hold other WON opportunities. **ADR-007 updated** |
| **§14.6 failure state** | **ADR-014** — `maintenance_consecutive_failures` + `maintenance_last_failure_at` in `system_settings` |
| **TODO-BD-06 seed list** | **Final** — the ten Erode District revenue taluks, with Chennimalai corrected to a block/firka under Perundurai |
| **M-21 backup destination** | **Final** — AWS S3 Mumbai `ap-south-1`, business-controlled account, 90-day minimum retention. See `/docs/DEPLOYMENT.md` |

**The Decision Gate's blocking criteria are met.** See `/docs/IMPLEMENTATION_PLAN.md`.

### ADR-031 — Security headers are split between `next.config.ts` and the middleware

**Status:** Accepted
**Date:** 2026-08-20   **Decided by:** Engineering (§23)

**Context:** §23 requires CSP, HSTS, `X-Frame-Options: DENY` and
`X-Content-Type-Options: nosniff` on every production response, and warns in the same breath
against breaking the application to satisfy a header check. Those two requirements pull apart: a
Content-Security-Policy worth having carries a per-request nonce, and a per-request value cannot be
declared statically.

**Decision:** The headers that never vary are declared in `next.config.ts`, so they also cover the
responses the middleware matcher skips (`_next/static`, images, `favicon.ico`). The CSP is built
per request in `middleware.ts` from `lib/security-headers.ts`, with a fresh 16-byte nonce, and is
attached to the *request* as well as the response so Next.js stamps it onto its own bootstrap
scripts.

`script-src` is `'self' 'nonce-…' 'strict-dynamic'` — no `'unsafe-inline'`, no `'unsafe-eval'`.
`style-src` keeps `'unsafe-inline'`, because React writes `style` attributes and nonces do not
apply to style attributes at all; the alternative is not a stricter policy, it is a broken page.

**Consequences:** `/login` had to become `dynamic = 'force-dynamic'`. Statically prerendered, it
shipped twelve unnonced script tags under a policy where `'strict-dynamic'` causes `'self'` to be
ignored — so a browser would have blocked every script on the sign-in page while every header check
passed. This was found by loading the page in a real browser, not by reading the headers, and it is
the concrete case §23's warning is about. The cost is one render of a static form per sign-in; the
page could never really be cached anyway, because middleware runs `getUser()` on it.

`scripts/smoke.sh` asserts the nonce is fresh per request *and* present on the page's scripts, so a
future change that reintroduces the mismatch fails the deployment rather than the product.

**Alternatives considered:** A static CSP with `'unsafe-inline'` — passes any header audit and
stops nothing, since inline injection is the attack. CSP in report-only mode — reports into a
collector the frozen stack does not contain. Forcing every route dynamic — pays the cost on 40
routes to fix two.

### ADR-032 — Outlet scope is evaluated once per query, not once per row

**Status:** Accepted
**Date:** 2026-08-20   **Decided by:** Engineering (§25)
**Migrations:** `028_rls_scope_initplan.sql`, `029_rls_readable_sets.sql`

**Context:** Every scoped policy tested `manages_outlet(outlet_id)`, and the readable-parent
policies tested `owns_opportunity_on_account(id)`, `owns_opportunity_on_project(id)`,
`can_read_opportunity(...)` and `can_read_account(...)`. All of these take a row column, so the
planner must call them per row, and each is a `SECURITY DEFINER` function that re-reads
`public.users` for the caller's role before doing its own lookup.

Measured on a synthetic 20,005 opportunities / 8,004 accounts, as a salesperson:

| Query | Per-row | Per-query |
|---|---|---|
| `opportunities` scan | 792 ms | 9.8 ms |
| `accounts` scan | 3,754 ms | 103 ms |
| `opportunity_events` scan | 3,277 ms | 14 ms |
| `search_crm` (name) | 7,299 ms | 245 ms |
| `find_account_duplicates` | 3,494 ms | 114 ms |
| `/today` (`v_opportunity_flags`) | 881 ms | 75 ms |

§15.1 already names this fix and applies it to the argument-free helpers — wrap as
`(select public.fn())` so the planner lifts them into an InitPlan. Its note that "wrapping a
correlated reference would defeat the point" is true of the wrapping but not of the predicate: the
scope test does not need a function call per row, it needs set membership against a set built once.

**Decision:**

    manages_outlet(outlet_id)
      →  (select public.is_owner()) or outlet_id in (select public.scoped_outlet_ids())

    owns_opportunity_on_account(id)
      →  id in (select public.my_opportunity_account_ids())

    can_read_opportunity(opportunity_id)
      →  opportunity_id in (select public.readable_opportunity_ids())

    can_read_account(account_id)
      →  account_id in (select public.readable_account_ids())

`scoped_outlet_ids()` is not new — migration 022 already scopes the management RPCs with it.

The owner test is a **separate disjunct** rather than folded into `scoped_outlet_ids()`, whose
OWNER branch lists only `is_active` outlets. Collapsing the two would have quietly taken a closed
outlet's history away from the owner. `tests/integration/rls-scope-equivalence.test.ts` pins that
case specifically.

`readable_opportunity_ids()` and `readable_account_ids()` are `SECURITY INVOKER`, deliberately.
A `SECURITY DEFINER` version would have to restate "owner, or outlet scope, or work context" — a
second copy of the authorization rule, which CLAUDE.md §8 forbids. As `INVOKER` they simply select
ids and let the parent table's own policy filter them, so the policy remains the single definition
of who may read a row.

**Consequences:** No rule changed. The whole integration suite — `crm-permissions`,
`rls-outlet-scope`, `management-scope`, `no-hard-delete` — passed unchanged across both migrations,
and 22 further assertions were added that compare each new form against the function it replaced,
role by role, including the deactivated user and ADMIN (ADR-017). `manages_outlet` is kept, with a
comment saying it must not be used inside a row predicate.

Three OWNER-only report RPCs remain at roughly 0.85–0.91 s at 20,005 opportunities
(`management_team_workload`, `management_outlet_comparison`,
`management_quotation_turnaround`). That is about five years of volume for this business, on an
untuned container, and they are not on the salesperson hot path — recorded rather than optimised,
because §25 also says not to build for a scale that is not coming.

**Alternatives considered:** Leaving it, since 20 users will not hit 20,000 rows for years — but
the cost is paid on `/today` from a phone from the first thousand rows, and the fix is one pattern
the codebase already uses. Rewriting the helpers' bodies instead of the policies — they are still
called per row, so it treats the symptom. Materialising scope into a table — a cache to invalidate,
and a twelfth table.

---

### ADR-033 — The office server: self-hosted Supabase in Docker on one machine

**Status:** Accepted
**Date:** 2026-08-20   **Decided by:** Project Owner

**Context.** V1 was designed for Vercel plus Supabase Cloud (§17.1) and that
architecture is sound. What changed is the constraint: the business asked for a
launch with **no recurring infrastructure cost**, running on a PC already sitting
in the office. A second constraint made it urgent — this environment cannot reach
Supabase Cloud, Vercel, Resend or AWS at all (§20), so "deploy to production and
see" was never available to verify against.

The cheap answer would have been to swap the platform: drop Supabase, hand-roll
auth, put the API in the Next.js app. That would have thrown away **the
authorization model**. RLS is the security boundary in this product (CLAUDE.md
§6): every policy, and the 425 integration tests that prove them, assume
PostgREST executing a request as the caller's role. Replacing that means
rewriting the security model and re-earning the confidence, for a hosting bill.

**Decision.** **Keep the architecture; change only where it runs.** Self-host the
open-source Supabase components on one office server with Docker Compose:

| | |
|---|---|
| `db` | `supabase/postgres` — the same extensions and roles as hosted |
| `auth` | GoTrue — the same sign-in, the same JWTs |
| `rest` | PostgREST — **the same RLS enforcement** |
| `storage` | `storage-api` — the same 10 MB uploads (§15.6) |
| `gateway` | nginx, putting the three behind one origin |
| `app` | the Next.js application, unchanged |

Almost nothing in `src/` changed to make this work: the same PostgREST runs the
same migrations and enforces the same policies, so every service and every policy
behaves exactly as it did. One thing did have to change, and it is recorded as
**ADR-034** — a browser and a container do not resolve the same address, so the
single `NEXT_PUBLIC_SUPABASE_URL` became a public/internal pair.

Three substitutions were required, each replacing a **paid platform feature** with
something the server already has:

1. **Vercel Cron → systemd timers.** The five `/api/cron/*` routes are unchanged,
   still authenticated by `CRON_SECRET`. `deploy/run-cron.sh` curls them from
   localhost; the timers reproduce `vercel.json`'s schedules exactly, in UTC. No
   queue was added (§3).
2. **Vercel's edge TLS → Cloudflare Tunnel.** Outbound-only, so no port is
   forwarded and Postgres, GoTrue, PostgREST and Storage are bound to
   `127.0.0.1`. HTTPS terminates at Cloudflare's edge on the free plan. On the
   LAN it is not needed at all.
3. **S3 backups → local + external drive.** `scripts/backup.sh` already supported
   a `file://` destination, so this needed no new format: same custom-format
   `pg_dump`, same AES-256 with a decrypt check before publish, same
   `verify-restore.sql`. `deploy/backup.sh` runs `pg_dump` **inside** the db
   container so the server needs no Postgres client, then copies to the external
   drive and prunes to the retention window.

**Consequences.**

*Easy.* ₹0/month recurring. The whole stack is one `deploy/start.sh`. Development
and production run the same images, so "works on my machine" stops being a
category of bug. Backups are the business's own files, readable with `openssl`
and `pg_restore` and nobody's cooperation.

*Hard.* One machine is one machine: a dead disk is an outage until it is replaced,
and the answer is the tested restore, not a second server (§12 explicitly rejects
HA at this scale). The owner now owns the operating system — updates, disk, UPS.
Cloudflare's free plan is a dependency for remote access, though the LAN keeps
working without it and the tunnel can be swapped without touching the application.

*What must change.* `docs/DEPLOYMENT.md` carries both paths — hosted and office
server — and the hosted one is now the *optional upgrade*, not the default.

**Alternatives considered.**

- **Stay on Vercel + Supabase Cloud.** Rejected on cost, and unverifiable from
  here (§20). Retained as a documented upgrade path — the migrations, the schema
  and the application are identical, so moving is a data restore and an
  environment change.
- **Drop Supabase; hand-roll auth and the data API.** Rejected. It discards RLS as
  the authorization boundary and the entire integration suite that proves it —
  the most valuable tests in the project (§19.2) — to save a subscription.
- **Kong, as upstream Supabase uses.** Rejected as more gateway than a two-outlet
  business needs. nginx routes three prefixes in forty lines, holds no policy and
  terminates no TLS.
- **Caddy for HTTPS.** Rejected: the tunnel already terminates TLS at the edge, so
  Caddy would be a second certificate story with nothing to do (§8).
- **Kubernetes, or a second server for HA.** Rejected outright (§3, §12). Twenty
  users on one PC with a tested restore is the correct amount of machinery.

### ADR-034 — A public and an internal Supabase URL, with one pinned session cookie

**Status:** Accepted
**Date:** 2026-08-22   **Decided by:** Engineering

**Context.** ADR-033 assumed one `NEXT_PUBLIC_SUPABASE_URL` could serve everyone.
It cannot. That value is a **browser** address, and server-side code runs inside
the `app` container, where it resolves to something else entirely: `http://localhost`
is the container itself, and `http://<lan-ip>:54321` is a host port bound to
`127.0.0.1` that no container can reach. Every Server Component read, Server Action,
middleware session refresh and the container `HEALTHCHECK` went to an address that
does not answer. The stack would have started and served nothing.

**Decision.** Split the address in two, and pin the cookie that makes the split safe.

- `NEXT_PUBLIC_SUPABASE_URL` stays the **browser** address. It is what the browser
  client uses and what the CSP allows.
- `SUPABASE_INTERNAL_URL` is the **container-internal** address of the same gateway
  (`http://gateway:8000`). The server client, the middleware, the service-role client
  and `/api/health` use it. It is deliberately not `NEXT_PUBLIC_`: inlined into a
  browser bundle it would be unreachable and misleading. Unset, it falls back to the
  public URL, so local development and hosted Supabase are unaffected.
- `AUTH_COOKIE_NAME` pins the session cookie for **both** clients. This is not
  cosmetic. supabase-js derives its storage key from whichever URL it was handed —
  `sb-${hostname.split('.')[0]}-auth-token` — so the split would otherwise produce
  `sb-localhost-auth-token` in the browser and `sb-gateway-auth-token` on the server,
  and every user would look signed in to the browser while appearing signed out to
  every Server Component. One literal name on both sides is what makes the split
  work at all.

nginx also gained a `/` route to the application, so the CRM and the three Supabase
prefixes share **one origin**. That is what lets `PUBLIC_URL` and
`PUBLIC_SUPABASE_URL` be the same value — `http://localhost` on the office LAN,
`https://crm.<domain>` behind the tunnel — instead of demanding a second hostname
and a second tunnel route. The upstream is resolved through Docker's embedded DNS at
request time, because `app` depends on the gateway and a literal upstream would stop
nginx booting whenever the application was not already up.

**Consequences.** Authentication semantics are unchanged: same GoTrue, same JWTs,
same RLS, no service-role workaround. The cookie name is a constant rather than a
variable on purpose — the two values must be identical, and a variable is a way for
them to drift. `tests/unit/supabase-url-split.test.ts` guards the fallback, the
override and the pin. A deployment that ever sets `SUPABASE_INTERNAL_URL` to a
browser-visible address gets no warning; it simply works, which is why the default in
`docker-compose.yml` is the one correct value.

**Alternatives considered.**
- **Bind the gateway to `0.0.0.0` and use the LAN IP everywhere.** Rejected: it
  publishes Supabase to the whole network to solve a name-resolution problem, and it
  still fails for `http://localhost`.
- **Use the service-role client for server-side reads.** Rejected outright — it
  bypasses RLS, which is the authorization boundary (§15, CLAUDE.md §6).
- **A second hostname for Supabase.** Rejected: a second tunnel route and a
  cross-origin CSP, to avoid forty lines of nginx.

### ADR-035 — Service-role passwords are aligned at start, not at initdb

**Status:** Accepted
**Date:** 2026-08-22   **Decided by:** Engineering

**Context.** The first run on the office server built every image, reported a healthy
`db`, and served nothing: GoTrue, PostgREST and storage-api each failed with
`password authentication failed`. `POSTGRES_PASSWORD` is applied by the postgres
entrypoint to the `postgres` superuser alone, while `supabase/postgres` creates
`authenticator`, `supabase_auth_admin` and `supabase_storage_admin` at initdb with
its own passwords. `docker-compose.yml` built all three connection strings from
`POSTGRES_PASSWORD`, so nothing in the package ever made the two agree. The health
check could not see it: `pg_isready` speaks as the superuser, whose password is set.

`supabase/platform/000_supabase_platform.sql` creates the same role names without
passwords, but it is local-development and CI only (ADR-018) and never runs on the
server — so it neither caused nor could have fixed this.

**Decision.** Align the three passwords from `POSTGRES_PASSWORD` as an explicit
startup step, in `deploy/db/service-roles.sql`, applied by `deploy/db-credentials.sh`
while only `db` is running — before auth, rest and storage start.

Not an initdb hook. A `/docker-entrypoint-initdb.d` script runs only on an empty
volume, which would fix a fresh deployment and leave every existing one broken, and
it depends on how a particular image's entrypoint walks that directory. An explicit
step runs identically on both, is idempotent, and can be re-run by hand.

Not a role we create. The script only `ALTER`s. These roles belong to the platform;
inventing one with guessed grants would replace an obvious failure with a subtle
privilege bug, so a missing role is reported and the deployment stops.

**Consequences.** `deploy/start.sh` now starts `db` alone, aligns, then starts the
rest. Changing `POSTGRES_PASSWORD` is just an edit plus `deploy/start.sh`. Nothing
about authentication *semantics* changed — same GoTrue, same JWTs, same RLS, same
`AUTH_COOKIE_NAME`, same public/internal URL split (ADR-034). No schema, migration,
policy or business rule is touched; re-assigning a role password is not a data
change, which is why it is safe on a database that already holds the business.

`scripts/test-service-credentials.sh` is the regression test. It recreates the exact
starting state on a real PostgreSQL server, proves all three roles are refused, runs
the alignment, and proves they are accepted — so the fix is provable without pulling
a single container image. It temporarily requires `scram-sha-256` on loopback,
because the development cluster trusts it and under `trust` a password test proves
nothing; it refuses to run at all if that switch does not take effect.

**Alternatives considered.**
- **Mount `roles.sql` as an initdb hook**, as upstream's compose does. Rejected as
  the only mechanism: it cannot repair a volume that already exists.
- **Give each service its own password.** Rejected: three more secrets in
  `production.env` for a single-tenant server, and `keygen.sh` output to match.
- **Let the services connect as `postgres`.** Rejected outright. PostgREST connects
  as `authenticator` precisely so it can switch to the caller's role — RLS is the
  authorization boundary (§15, CLAUDE.md §6), and a superuser connection would
  bypass every policy in the database.

---

## How to record a decision

Append to the relevant entry above — **never overwrite the temporary behaviour**, which is the
record of what the system did before the decision. For an architecture change, add an ADR:

```
### ADR-0nn — <title>
**Status:** Proposed | Accepted | Superseded by ADR-0mm
**Date:** YYYY-MM-DD   **Decided by:** <role>
**Context:** what forced the question
**Decision:** what was chosen
**Consequences:** what this makes easy, what it makes hard, what must change
**Alternatives considered:** and why they were not chosen
```
