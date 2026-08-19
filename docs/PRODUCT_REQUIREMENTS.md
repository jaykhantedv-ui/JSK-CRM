# Product Requirements

Derived from `CLAUDE_CODE_BUILD_SPEC.md` §1–§4, §7–§13, §20, §23. **Nothing here is invented.**
Where the specification is ambiguous, this document says so and points at `/docs/SPEC_AUDIT.md`
rather than choosing.

---

## 1. What this is

A standalone web CRM replacing handwritten sales books at a building-materials retail business
(tiles, marble, granite, sanitaryware, CP fittings). **Mobile-first for salespeople,
desktop-oriented for management.**

### The five questions the application must answer instantly (§1.2)

1. Who is this customer?
2. What project are they associated with?
3. What are they buying or considering?
4. Who is responsible for the relationship?
5. What happened last, and what happens next?

**Every screen, table and query exists to serve one of these five. If a proposed addition serves
none of them, it is out of scope.** This is the test to apply to any feature request.

### The performance bar that matters (§1.4)

A salesperson must be able to create a customer with an opportunity in **about one minute** on a
phone, and log an interaction in **three taps**. *If the application is slower than a notebook, it
fails regardless of feature completeness.*

---

## 2. Users (§1.3)

| Role | Count | Device | Usage pattern |
|---|---|---|---|
| Salesperson | 5–15 | Android phone | Many short sessions, in showroom or on site |
| Sales Manager | 1 | Desktop | Daily exception review, weekly pipeline review |
| Owner | 1 | Phone/desktop | Occasional high-level check |
| Admin | 0–1 | Desktop | User admin, data import, cleanup |

**ADMIN is a system/data role, not a sales role**: no dashboards, no reassignment, no export (§3.2).

---

## 3. Scope

### The CRM owns (§2.1)

Customer identity · contacts and stakeholders · projects/sites · opportunities · sales pipeline ·
activity history · ownership and accountability · next actions · lightweight quotation references ·
**pre-sale information only**.

### The CRM does not own (§2.2)

Accounting · GST · ledgers · invoices · authoritative inventory or stock · payment records ·
delivery and logistics · payroll · commission.

> **The rule:** if a data point changes when goods physically move or money changes hands, it does
> not belong in this database. The handoff point is a **won opportunity**; from there the existing
> accounting system takes over manually.

### Explicitly not in Version 1 (§2.3)

Accounting or inventory integration · GST/invoicing · ERP features · commission calculation ·
line-item quotation engine · WhatsApp Business API, webhooks or message ingestion · marketing
automation · AI/lead scoring/forecasting · slab-level stone inventory · sample tracking ·
multi-branch UI · offline mode · customer portal · SMS/push notifications.

**Do not build partial versions of these. Do not add columns "ready for" them** beyond exactly
what §17.6 specifies.

### Terminology discipline (§2.4)

The application must **never display the word "Revenue"**. Won opportunity values are
salesperson-entered estimates, not accounting figures.

| Term | Meaning |
|---|---|
| **Pipeline Value** | Sum of `estimated_value` on active opportunities |
| **Won Value** | Sum of `final_order_value` on won opportunities |
| **Weighted Pipeline** | Pipeline value × stage probability |

---

## 4. Domain model in business terms

Eleven entities, no more (§4.1).

| Entity | What it means to the business |
|---|---|
| **Account** ("Customer" in the UI) | The permanent customer relationship — an individual or a firm |
| **Contact** | A person. Attached to an account, or independent (a referring architect) |
| **Project** | A physical site |
| **Project stakeholder** ("People on this project") | Who is involved in a site, in which role, with how much influence |
| **Opportunity** | One specific potential sale — stage, values, ownership, next action |
| **Activity** | What happened. Append-only |
| **Opportunity event** | What the system recorded about the record. Audit trail |
| **User** | An internal application user |
| **System setting** | A controlled value or threshold changeable without a deploy |
| **Import batch / import row** | One CSV import run and its staged rows |

### The multi-stakeholder case must work end to end (§4.4)

One project (Jain Residence) with three stakeholder organisations — homeowner, contractor,
architect — and **three concurrent opportunities**: flooring (won), bathroom tiles (negotiation),
sanitaryware + CP (new).

> **One project has many opportunities. This is the single most important cardinality in the
> model. Never write code that assumes one opportunity per project** (§6).

### Deliberately rejected entities (§4.2)

`leads` · `companies` (separate from accounts) · `tasks` · `quotations` · `products` ·
`notifications` · `attachments`. Each rejection has a stated reason in §4.2 and stands.

**There is no lead entity** (§8.2). A new enquiry is an opportunity at stage `new`, attached to an
account created in the same flow. There is no lead table, no conversion step, and no convert
button. A junk enquiry is closed as `lost` with reason `NOT_GENUINE`; the account remains,
harmlessly. Anything the UI labels "Leads" is a saved filter: `opportunities where stage = 'new'`.

---

## 5. Business rules

### Ownership (§8.1)

Accounts, contacts and projects **always** have an owner. Opportunities **may be unassigned** —
that is a genuine, visible exception state, not a gap. On create, ownership defaults to the
current user. Only MANAGER/OWNER may change ownership, and every change is recorded.
**Reassignment moves the opportunity; activity history keeps its original performer.** Deactivating
a user never orphans records — reassignment is a separate, explicit action.

### Next action (§8.3)

Both `next_action` and `next_action_date` are set, or both are null. Logging an activity **prompts**
for a next action; the user may answer "cannot determine yet", which clears both fields and
surfaces the opportunity in the Missing Next Action exception list.

> **Deliberate design point:** the application does **not** hard-block activity logging when a next
> action is unknown. **Blocking causes fabricated dates, which is worse than a visible gap.** The
> exception list is the control.

*(§11.1 marks next action as required in the primary create flow, which contradicts this —
`/docs/SPEC_AUDIT.md` M-04.)*

### Quotations (§8.6)

Lightweight fields on the opportunity plus a PDF in Storage. The quotation document itself is
produced in the existing system. **No line items, no pricing engine, no revision table.**

### Won and lost (§8.7)

Won requires a final order value and a close timestamp; lost requires a reason. Winning sets the
account to ACTIVE and clears the next action, then **prompts — never auto-creates** — a follow-on
opportunity for another category on the same project. `lost_reason = 'UNKNOWN'` is permitted but
counted as a data-quality metric.

### Archiving, never deleting (§8.8)

Archived records disappear from active lists and dashboards, remain readable and searchable by
MANAGER/OWNER/ADMIN, retain all relationships and activities, contribute nothing to pipeline
value, and can be restored. **No role can hard delete anything, ever.**

### Duplicate detection — advisory, never automatic (§8.9)

| Signal | Confidence | Behaviour |
|---|---|---|
| Same normalised phone | **EXACT** | Strong warning, existing record shown with [Open] and [Add opportunity here]; the user may still proceed by confirming |
| Same normalised email | **EXACT** | As above |
| Name similarity ≥ 0.6 **and** same city | POSSIBLE | Review warning, list shown, proceeding is one click |
| Name similarity ≥ 0.8, no city match | POSSIBLE | Review warning |
| Neither | NONE | Save silently |

**Never merge automatically. Never block creation outright.** Merging is a manual MANAGER/OWNER
action, always with a preview. Phone numbers are deliberately **not unique** — two family members
legitimately share a number, and a hard block causes salespeople to enter fake numbers (§25.2).

### Activity immutability (§8.10)

Editable **by the author for 24 hours**; immutable thereafter; **never deletable**. Corrections
after 24 hours are appended as a new activity of type `NOTE`.

### Money and dates (§8.11)

All money is bigint paise; rupee conversion happens only at UI and CSV boundaries; display uses
Indian grouping (`₹4,20,000`). All timestamps are stored UTC and rendered `Asia/Kolkata`; dates
display as `dd MMM yyyy`; recency is relative ("Today", "Overdue by 4 days").

---

## 6. Opportunity lifecycle (§9)

| Stage | Type | Meaning |
|---|---|---|
| `new` | active | Enquiry captured, not yet qualified |
| `qualified` | active | Real requirement, real timeline, decision-maker known |
| `selection` | active | Customer actively choosing product |
| `quoted` | active | Formal quotation issued |
| `negotiation` | active | Discussing price, delivery, terms |
| `verbal_confirmation` | active | Customer has said yes; awaiting order/advance |
| `nurture` | holding | Genuine future business, nothing actionable now |
| `won` | terminal | Order confirmed |
| `lost` | terminal | Not proceeding with us |

> **There is no `follow_up` stage and there must never be one. Follow-up is an action, not a
> pipeline position.**

`nurture` is **excluded from Pipeline Value everywhere**. It exists so that genuine future business
is neither faked as active nor destroyed as lost.

Backward moves are permitted only where §9.2 lists them, and **always require a reason**. `won` is
final; a mistaken win is corrected by MANAGER/OWNER through an explicit reopen that logs an event
— **there is no silent edit**. Skipping stages forward is allowed, because real sales skip stages.
**Historical stage changes are never deleted or rewritten.**

*(Two lifecycle contradictions are unresolved: `selection → negotiation` is matrix-legal but
constraint-illegal, and reopening from `won` contradicts `won → (none)` —
`/docs/SPEC_AUDIT.md` H-10, H-11.)*

---

## 7. Activity and next action (§10)

Two questions, deliberately separate, and **they must not be merged**:

- **Activities** answer *what happened* — append-only, immutable, historical.
- **`next_action` + `next_action_date`** answer *what happens next* — mutable, single-valued,
  always current.

**There is no task table in V1.** One opportunity has exactly one pending next action; multiple
parallel reminders are a V2 feature (§25.1).

**Context inference — the salesperson never chooses foreign keys** (§10.2). Launching from an
opportunity pre-fills account, project and opportunity. From a project: pre-fills account and
project, and offers that project's open opportunities as chips. From an account: pre-fills the
account and offers its open opportunities.

---

## 8. Screens (§12)

### Design direction (§12.1)

Clean, calm, business-like. High contrast, large touch targets, **no decorative imagery**.
Salesperson screens optimise for **speed**; manager screens for **density**. Semantic colour only
for state — and **never colour alone**, always paired with an icon or label. Progressive
disclosure: create forms show **6–7 fields**; everything else is added from the detail page
afterwards.

### Routes (§12.2)

`/login` · `/` (role redirect) · `/today` · `/dashboard` · `/accounts` (labelled **Customers**) ·
`/accounts/new` · `/accounts/:id` (Customer 360) · `/accounts/:id/edit` · `/contacts` ·
`/contacts/:id` · `/projects` · `/projects/new` · `/projects/:id` · `/opportunities` ·
`/opportunities/board` (desktop ≥1024px only) · `/opportunities/:id` · `/team` · `/team/:userId` ·
`/reports` · `/import` · `/settings` · `/settings/users` · `/archive` · `/search?q=`

*(Several creation/edit routes implied by the flows are absent from the route map —
`/docs/SPEC_AUDIT.md` M-11.)*

### Navigation (§12.3)

**Mobile (<768px):** bottom tab bar — Today · Customers · **[+]** (raised centre) · Pipeline ·
More. The `+` sheet offers: New Customer · New Opportunity · Log Activity · Site Visit · Update
Next Action.

**Desktop (≥1024px):** left sidebar, role-gated items **hidden, not disabled**. Top bar: search,
user menu.

### Customer 360 (`/accounts/:id`) — the most-used screen (§12.4)

Sticky header with name, call/WhatsApp actions, type · city · owner, and the next action
(red when overdue). Then Won Value / Pipeline Value / last contact. Then open opportunities with
[+ Add]. Then **exactly three** recent activities with [Log Activity]. Then tabs: Projects ·
People · All activity · Files · Details. **Address, GSTIN, source and audit fields live in the
Details tab.**

### Required states on every list and form (§12.6)

Loading (skeletons matching the final layout, **never a full-page spinner**; dashboard tiles load
independently) · empty-no-data (explanation + primary action) · empty-filtered (different copy +
clear filters) · error (plain language + retry, **never a Postgres message or stack trace**) ·
forbidden · offline (banner; block submission rather than fail silently) · saving (disabled button
+ spinner; **no optimistic UI in V1**).

### Forms (§12.7)

Single column always. Validate on blur. Errors inline and in plain language. **Never lose entered
data** on validation or network failure. **No multi-step wizards except the import flow.**

### Performance targets (§12.8)

`/today` interactive under **1.5 s on 4G** · any list query under **400 ms server-side** ·
pagination 25 mobile / 50 desktop · **no unbounded list query anywhere**.

---

## 9. Dashboards (§13)

Every metric has an exact definition in §13.1 and is implemented as a **named, unit-testable
function** in `dashboard.service.ts`. **No metric depends on accounting data. The word "revenue"
appears nowhere.**

Win Rate is **null when no opportunities closed in the period — display "—", never 0%.**

### Salesperson `/today` (§13.2)

**A work queue, not analytics**, in this order: Overdue → Due today → Upcoming (7 days) →
Missing next action → New enquiries to contact → My pipeline → Won this month. Quick actions
below: [+ New Customer] [Log Activity]. **Nothing else.**

**Not shown to salespeople: other people's numbers, team totals, win rate, leaderboards.**

### Manager `/dashboard` (§13.3)

**Panel A — Exceptions (top, always)**, each linking to a filtered list; these are the daily
review: unassigned · overdue by salesperson · missing next action · new enquiries breaching SLA ·
high-value at risk · stalled · dormant · quotations past validity. **Panel B — Team workload.**
**Panel C — Pipeline health.**

### Owner `/dashboard` (§13.4)

**Deliberately small. Do not add tiles.** This month · Pipeline · Trend (Won Value by month, 12
months, one line chart) · Needs attention (max 5 lines) · Top 3 lost reasons.

---

## 10. Automations (§14)

**Seven automations. Nothing else is automated in V1.** Most "automations" are **computed exception
views, not background jobs** — that is deliberate. Only genuinely time-based notifications need a
job: the new-opportunity SLA reminder (hourly), the daily salesperson digest (08:30 IST, **never a
group email**), the manager exception digest (09:00 IST), the owner summary (per setting), and
nightly maintenance (02:00 IST).

**Explicitly not automated (§14.8):** auto-assignment of opportunities · auto-closing stale
opportunities · auto-merging duplicates · auto-reassignment on inactivity · **any message to a
customer** · per-event notifications on create/edit.

---

## 11. Import (§20)

**The historical books are still on paper. Build the capability; assume no file exists yet.**

`Upload → Validate → Preview → Duplicate analysis → Admin review (per-row decision) → Import →
Result summary`, with rollback available for 7 days. OWNER and ADMIN only. Max 5 MB, max 5,000
rows per batch. V1 templates: **accounts and contacts only**.

Per row the reviewer chooses IMPORT, SKIP or LINK_EXISTING. **Never overwrite an existing record's
fields. Never merge automatically.** Rows flagged as duplicates with no decision block execution.

**No automations fire during import** — a 2,000-row import that emails everyone destroys trust in
alerts permanently (§25).

---

## 12. Acceptance

The product is accepted against §23, tested **as the relevant role**.

> **Never verify a permission as OWNER — OWNER passes everything, which is exactly why it proves
> nothing** (§23).

Full criteria in `/docs/TESTING.md` and per-phase in `/docs/IMPLEMENTATION_PLAN.md`.
