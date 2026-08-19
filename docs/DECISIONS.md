# Decisions

Two registers:

- **A. Open business decisions (`TODO-BD`)** — every item from §24 of `CLAUDE_CODE_BUILD_SPEC.md`.
  **None of these is resolved in code.** The mechanism is implemented; the value is a placeholder
  read from `system_settings`. Changing a value must never require a deploy.
- **B. Architecture decision record** — stack or architecture changes. §17.1 requires the reason
  to be recorded **before** implementing the change.

Specification defects and ambiguities are **not** decisions and live in `/docs/SPEC_AUDIT.md`.
They need answers too, and several of them block phases, but they are corrections to the spec
rather than business choices.

---

# A. Open business decisions

**Rule (§24, restated in `CLAUDE.md` §3):** *Do not implement a value; implement the mechanism and
read the placeholder from `system_settings`.* A `TODO-BD` value hard-coded anywhere in application
code — a constant, a default parameter, a migration literal outside the settings seed, a fallback
in a component — is a defect, regardless of whether the value is currently correct.

| ID | Status | Settings key | Blocks |
|---|---|---|---|
| TODO-BD-01 | Open | *(none yet — service rule + new key when decided)* | — |
| TODO-BD-02 | Open (placeholder seeded) | `high_value_threshold_paise` | — |
| TODO-BD-03 | Open (placeholders seeded) | `dormancy_days`, `stage_stall_days` | — |
| TODO-BD-04 | Open | `material_types` | — |
| TODO-BD-05 | Open (placeholder seeded) | `owner_summary_schedule` | — |
| TODO-BD-06 | **Open — blocks go-live** | `cities` | Phase 21 (§23.9) |
| TODO-BD-07 | Open | *(enum + free text; no key)* | — |
| TODO-BD-08 | **Open — blocks provisioning** | *(infrastructure)* | Phase 2, Phase 21 |
| TODO-BD-09 | Open | *(none — no integration in V1)* | — |
| TODO-BD-10 | Open | *(none — templates only)* | — |
| TODO-BD-11 | Open | *(none — not modelled)* | — |
| TODO-BD-12 | Open | *(none — `branch` column, no UI)* | — |

---

### TODO-BD-01 — Should a project be mandatory for opportunities above a value threshold?

- **Why it matters.** Affects data quality on high-value deals and site-based reporting.
- **Temporary behaviour.** `opportunities.project_id` is **optional for all opportunities** (§8.5).
  The manager dashboard reports the percentage of high-value opportunities with no project. The UI
  encourages a project but never requires one.
- **How to change later.** Add a service-layer rule plus a `system_settings` key. **No schema
  change.**
- **Decision:** *(open)* — **Decided by:** — · **Date:** —

### TODO-BD-02 — High-value threshold for manager escalation

- **Why it matters.** Drives which deals the manager is alerted about (the "High-value at risk"
  tile, §13.3 Panel A).
- **Temporary behaviour.** `system_settings.high_value_threshold_paise = 20000000` (₹2,00,000).
  **This is a placeholder, not a business decision.**
- **How to change later.** Edit at `/settings`. No deploy.
- **Decision:** *(open)* — **Decided by:** — · **Date:** —

### TODO-BD-03 — Dormancy days and per-stage stall days

- **Why it matters.** Drives the accountability exception lists. Wrong values cause either alert
  fatigue or missed deals — the two failure modes the whole exception system exists to avoid.
- **Temporary behaviour.** Placeholders in `system_settings`:
  - `dormancy_days = 30`
  - `stage_stall_days = {"new":3,"qualified":14,"selection":21,"quoted":10,"negotiation":14,"verbal_confirmation":10}`
  The spec **recommends re-deriving these from three months of real data** rather than treating the
  seed as a decision.
- **How to change later.** Edit at `/settings`. No deploy.
- **Open sub-question (`/docs/SPEC_AUDIT.md` M-10):** `dormancy_days` currently drives two
  different things — `accounts.status = 'DORMANT'` (§14.6) and the opportunity **Dormant**
  exception (§13.1). One value, two business meanings. Should these be separate keys?
- **Decision:** *(open)* — **Decided by:** — · **Date:** —

### TODO-BD-04 — Marble/granite treatment: is slab/lot-level reference needed, or is material + grade sufficient?

- **Why it matters.** Determines whether a future slab entity is required. **V1 deliberately does
  not model slabs** (§2.3).
- **Temporary behaviour.** `opportunities.material_notes` free text, plus photos on activities.
  `system_settings.material_types = []` backs an autocomplete that accepts free text.
- **How to change later.** If slab tracking is confirmed, add fields to `opportunities` or a new
  table. **Nothing built now blocks either path.**
- **Decision:** *(open)* — **Decided by:** — · **Date:** —

### TODO-BD-05 — Owner summary: daily or weekly, and at what time?

- **Why it matters.** Sets the cron schedule for the owner summary email (§14.5).
- **Temporary behaviour.** `system_settings.owner_summary_schedule = {"cadence":"daily","hour":19}`.
- **How to change later.** Edit at `/settings`. No deploy.
- **Implementation constraint (`/docs/SPEC_AUDIT.md` M-26):** Vercel Cron schedules are static in
  `vercel.json` and cannot be driven by a database value. The mechanism must therefore be an
  **hourly trigger with an in-route gate** that reads this setting and decides whether to send.
  That preserves the rule — the value stays in `system_settings` and changing it needs no deploy —
  but it differs from §14.5's literal wording and needs sign-off.
- **Decision:** *(open)* — **Decided by:** — · **Date:** —

### TODO-BD-06 — The list of cities/areas served — **blocks go-live**

- **Why it matters.** Blocks clean geographic reporting. Also feeds duplicate detection: the
  POSSIBLE-confidence rule is `similarity(name) >= 0.6` **and same city** (§8.9).
- **Temporary behaviour.** `system_settings.cities = []`. The city control is a combobox that
  **accepts free text with a warning**, so a salesperson is never blocked by a missing city; the
  entered value is flagged for the admin to normalise (§7.3).
- **How to change later.** Edit at `/settings`. No deploy.
- **Launch gate.** §23.9 requires `system_settings.cities` to be populated before go-live.
- **Decision:** *(open)* — **Decided by:** — · **Date:** —

### TODO-BD-07 — Final product taxonomy: is the `product_category` enum sufficient, or is brand/range structure needed?

- **Why it matters.** Determines whether a products table is ever required.
- **Temporary behaviour.** The `product_category` enum plus `material_notes` free text plus
  `estimated_quantity` + `quantity_unit`. **No SKU catalogue** (§7.4).
- **How to change later.** Adding a products table later is **additive**; no migration of existing
  data is required.
- **Decision:** *(open)* — **Decided by:** — · **Date:** —

### TODO-BD-08 — Hosting region / Indian data residency requirement — **blocks provisioning**

- **Why it matters.** May force a different Supabase region or a different host entirely.
- **Temporary behaviour.** Assume no residency constraint; choose the nearest region.
- **How to change later.** **You cannot.** The region is chosen at Supabase project creation and
  is fixed for the life of the project. §24 states plainly: *decide before production
  provisioning, it cannot be changed later.*
- **Consequence for the plan.** Phase 2 may set up **local** Supabase without this answer.
  Provisioning staging or production without it risks a full data migration later.
- **Decision:** *(open)* — **Decided by:** — · **Date:** —

### TODO-BD-09 — Exact accounting software and version

- **Why it matters.** Blocks any future integration scoping.
- **Temporary behaviour.** **No integration.** Manual handoff at won;
  `opportunities.order_reference` is free text — the reference used in the accounting system
  (§11.8, §17.6). `AccountingIntegration` is a type declaration with **no implementation and no
  stub** (§16.4).
- **How to change later.** Scope integration only after the system is confirmed in use.
- **Decision:** *(open)* — **Decided by:** — · **Date:** —

### TODO-BD-10 — Historical migration depth: which records are worth digitising?

- **Why it matters.** Determines import volume and effort. The historical books are still on paper
  (§20) — build the capability, assume no file exists yet.
- **Temporary behaviour.** Import capability is built for **accounts and contacts only**. Projects
  and opportunities templates are *designed but not built* (§20.2).
- **How to change later.** `import_batches.entity` already accepts `projects` and `opportunities`,
  and `import_rows.raw` is `jsonb`, so adding them requires **no schema change**.
- **Decision:** *(open)* — **Decided by:** — · **Date:** —

### TODO-BD-11 — Is sample issue/return tracking a real operational problem?

- **Why it matters.** Would add an entity in V2.
- **Temporary behaviour.** Not modelled. Sample handover is an activity purpose
  (`activity_purpose = 'SAMPLE_HANDOVER'`).
- **How to change later.** New table in V2 if confirmed. Not in V1 under any circumstances (§2.3).
- **Decision:** *(open)* — **Decided by:** — · **Date:** —

### TODO-BD-12 — Is a second branch in the planning horizon?

- **Why it matters.** Determines when branch filtering is needed.
- **Temporary behaviour.** A `branch` column exists on `users`, `accounts`, `projects` and
  `opportunities`, defaulted `'MAIN'`, with **no UI and no RLS involvement** (§17.6).
- **How to change later.** Add filtering and a branch picker. **No migration needed.**
- **Decision:** *(open)* — **Decided by:** — · **Date:** —

---

# B. Architecture decision record

§17.1: *"If a change to this stack becomes necessary, record it in `/docs/DECISIONS.md` with the
reason **before** implementing it."* The same applies to any change to the eleven-table model
(§4.1), the RLS-as-authorization model (§15), the money representation (§8.11), the service
boundary (§16), or the repository structure (§18).

### ADR-000 — The frozen stack (accepted, from the specification)

**Status:** Accepted — §17.1, not a decision made here.

Next.js 15 App Router + TypeScript strict · Supabase Postgres, Auth and Storage · `@supabase/ssr` ·
Tailwind + shadcn/ui + lucide-react · Zod · react-hook-form + zodResolver · TanStack Query
(lists/filters only) · Recharts · date-fns · Resend behind `NotificationService` · Vercel Cron ·
Vercel + Supabase hosting · Vitest + Playwright.

**Rejected and staying rejected:** microservices · GraphQL · Redis · message queues · a separate
API server · a native mobile app · real-time subscriptions · state-management libraries
(no Redux, no Zustand).

### Pending — decisions required before implementation

These arise from the audit and are **not** `TODO-BD` items. Each needs an answer before the phase
that depends on it. Full detail in `/docs/SPEC_AUDIT.md`.

| Ref | Question | Needed by | Recommendation |
|---|---|---|---|
| **B-01** | How does the reason text reach an `opportunity_events` row, given the table is append-only for everyone? | Phase 11 | Transaction-local GUC (`set_config('app.event_reason', …, true)`) read by the trigger — keeps "no path bypasses the audit" |
| **B-02** | `owner_id`-change prevention: fix the §15.5 `with check`, or use the `SECURITY DEFINER` RPC? | Phase 5 | The RPC — §15.5 itself says *"Prefer the RPC"*, and the fallback SQL is invalid and recursive |
| **B-03** | What is `actor_id` when a service-role job changes stage or owner (`auth.uid()` is null)? | Phase 3 | A reserved system user row in `public.users`, used only by automated writes |
| **B-05** | Where does the SLA "already notified" state live, given no notifications table? | Phase 18 | Decision required — four viable options, all spec changes |
| **B-08** | `removeProjectStakeholder`: hard delete a link row, or add `archived_at` to `project_stakeholders`? | Phase 10 | Decision required — both are model changes |
| **B-09** | Storage uploads from the browser against a signed upload URL — an explicit carve-out from "no client-side Supabase writes"? | Phase 17 | Approve the carve-out; 10 MB exceeds the platform request-body limit, so there is no alternative |
| **H-02** | Is `mergeAccounts` reversibility dropped, or does the model gain merge audit state? | Phase 16 | Decision required — affects the eleven-table cap |
| **H-07** | Does user provisioning become a third permitted service-role caller? | Phase 4 | Approve, with an OWNER/ADMIN check **before** the admin client is touched |
| **H-08** | Import: keep batch atomicity and drop live progress, or chunk and compensate? | Phase 15 | Keep atomicity; report on completion only |
| **H-10** | `selection → negotiation`: remove the transition, narrow `quoted_requires_quotation`, or collect quotation fields on the negotiation modal? | Phase 11 | Decision required — three materially different products |
| **H-11** | `reopenOpportunity` from `won`: target stage, and what is cleared? | Phase 11 | Decision required — stale `final_order_value` otherwise re-enters Won Value |
| **M-01** | Where does ADMIN land after login? | Phase 4 | `/settings` — ADMIN is a system/data role with no dashboards (§3.2) |
| **M-03** | Unauthorised record access: 404 or a Forbidden screen? | Phase 7 | 404 — §12.6's own rule is "never confirm existence", and §23.1/§19.3 test for not-found |
| **M-13** | UTC→`Asia/Kolkata` rendering: `date-fns-tz` or `Intl.DateTimeFormat`? | Phase 1 | `Intl` — no new dependency, and the frozen stack stays frozen |
| **M-14** | Magic-byte MIME verification: a package or a hand-rolled signature check? | Phase 1 | Hand-rolled for four allowed types (JPEG, PNG, WebP, PDF) — a small, testable function |
| **M-30** | Lint enforcement of the no-cross-feature-import rule? | Phase 1 | Approve the lint plugin — otherwise §18's rule is unenforceable |

---

## How to record a decision

Append to the relevant entry above — never overwrite the temporary behaviour, which is the record
of what the system did before the decision. For an architecture change, add an ADR:

```
### ADR-00n — <title>
**Status:** Proposed | Accepted | Superseded by ADR-00m
**Date:** YYYY-MM-DD   **Decided by:** <name>
**Context:** what forced the question
**Decision:** what was chosen
**Consequences:** what this makes easy, what it makes hard, what must change
**Alternatives considered:** and why they were not chosen
```
