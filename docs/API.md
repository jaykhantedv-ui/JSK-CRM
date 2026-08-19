# API and Services

Derived from `CLAUDE_CODE_BUILD_SPEC.md` §16, §10.2, §17.2.

**Built as of Master Phase 2 (Core CRM):** accounts, contacts, projects, opportunities, activities,
search, and the `/today` plus basic-pipeline halves of the dashboard service. **Not built:** import,
archive, merge, the manager/owner dashboard panels, reports and the cron routes — those are later
master phases and are listed here as the contract they will implement.

---

## 1. The rule

> **All business logic lives in `src/services/*`. Server Actions and route handlers only:
> authenticate → validate with Zod → call a service → map errors. No business rule is duplicated
> in a component.** (§16)

There is no REST or GraphQL API surface of our own. The three call paths are:

| Path | Mechanism | Auth | RLS |
|---|---|---|---|
| Reads | Server Components → services → `@supabase/ssr` server client | User session cookie | Applies |
| Writes | Client → **Server Action** → service → client or RPC | User session cookie | Applies |
| Scheduled | Vercel Cron → `/api/cron/*` → service | `CRON_SECRET` bearer token | **Bypassed** (service-role) |

Client Components may read via TanStack Query for lists and filters. **They never write** — with
one approved exception: a browser Storage upload against a **server-issued signed upload URL**
(**ADR-005**), where the database row is still written by a Server Action.

---

## 2. Service signatures (§16.1)

### Accounts
```ts
createAccount(input: CreateAccountInput): Promise<Account>
updateAccount(id: string, input: UpdateAccountInput): Promise<Account>
archiveAccount(id: string, reason?: string): Promise<void>
restoreAccount(id: string): Promise<void>
checkDuplicates(input: { phone?, email?, name?, city? }): Promise<DuplicateMatch[]>
mergeAccounts(survivorId: string, mergedId: string): Promise<MergeResult>   // MANAGER/OWNER
searchAccounts(q: string, filters?): Promise<AccountSearchResult[]>
getAccount360(id: string): Promise<Account360>
```

### Contacts
```ts
createContact(input): Promise<Contact>
updateContact(id, input): Promise<Contact>
archiveContact(id): Promise<void>
```

### Projects
```ts
createProject(input): Promise<Project>
updateProject(id, input): Promise<Project>
archiveProject(id): Promise<void>
addProjectStakeholder(projectId, input): Promise<ProjectStakeholder>
removeProjectStakeholder(stakeholderId): Promise<void>      // deletes the link row — ADR-004
setPrimaryStakeholder(projectId, stakeholderId): Promise<void>   // two statements, one transaction
```

### Opportunities
```ts
createOpportunity(input): Promise<Opportunity>
updateOpportunity(id, input): Promise<Opportunity>
changeOpportunityStage(id, toStage, payload, reason?): Promise<Opportunity>
markOpportunityWon(id, { finalOrderValue, orderReference? }): Promise<Opportunity>
markOpportunityLost(id, { lostReason, lostDetail?, competitor? }): Promise<Opportunity>
reopenOpportunity(id, reason): Promise<Opportunity>            // MANAGER/OWNER — won → qualified (ADR-007)
assignOpportunity(id, userId, reason?): Promise<Opportunity>   // MANAGER/OWNER
reassignOpportunity(id, userId, reason): Promise<Opportunity>  // MANAGER/OWNER
bulkReassign(fromUserId, toUserId, reason): Promise<BulkResult> // MANAGER/OWNER
updateNextAction(id, { nextAction, nextActionDate } | null): Promise<Opportunity>
archiveOpportunity(id, reason?): Promise<void>
```

### Activities
```ts
logActivity(input): Promise<{ activity: Activity; opportunity?: Opportunity }>
updateActivity(id, input): Promise<Activity>   // author, <24h
listTimeline(accountId, opts): Promise<Activity[]>
```

### Dashboards
```ts
getSalespersonDashboard(userId): Promise<SalespersonDashboard>
getManagerDashboard(filters): Promise<ManagerDashboard>
getOwnerDashboard(period): Promise<OwnerDashboard>
getTeamWorkload(): Promise<TeamWorkload[]>
```

### Import
```ts
createImportBatch(entity, file): Promise<ImportBatch>
validateImportBatch(batchId): Promise<ImportBatch>
analyzeImportDuplicates(batchId): Promise<ImportBatch>
setImportRowDecision(rowId, decision): Promise<ImportRow>
executeImport(batchId): Promise<ImportResult>
rollbackImport(batchId): Promise<void>        // OWNER, within 7 days
```

### Settings
```ts
getSettings(): Promise<Settings>
updateSetting(key, value): Promise<void>      // OWNER/ADMIN
```

**`settings.service.ts` is the only reader of `system_settings`** — a cached server helper. No
other module reads that table, and no module hard-codes any of its values (§5.10, `CLAUDE.md` §3).

---

## 3. Error contract (§16.2)

```ts
class AppError extends Error {
  code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_TRANSITION'
      | 'DUPLICATE_WARNING' | 'CONSTRAINT_VIOLATION' | 'CONFLICT' | 'INTERNAL'
  field?: string
  details?: unknown
}
```

Postgres check-constraint violations are **caught and mapped by constraint name**:

| Constraint | User-facing message |
|---|---|
| `won_requires_value` | "Enter the confirmed order value before marking this won." |
| `won_requires_closed` | *(service sets `closed_at`; a violation here is an internal bug)* |
| `account_reachable` | "Add a phone number or an email for this customer." |
| `lost_requires_reason` | "Choose a reason before marking this lost." |
| `quoted_requires_quotation` | "Add the quotation reference, date and value before moving to Quoted." *(binds `quoted` only — ADR-006)* |
| `next_action_pairing` | "Set both the next action and its date, or neither." |
| `nurture_needs_date` | "Nurture needs a date to come back to this." |
| `contact_reachable` | "Add a phone number or an email for this person." |
| `stakeholder_target` | "Choose a person or a firm for this role." |
| `one_primary_per_project` | "This project already has a primary contact." |

> **A raw database error must never reach the UI** (§16.2, §12.6, §23.8). Anything unmapped becomes
> `INTERNAL` with a generic message; the detail is logged server-side, **never including tokens,
> keys or personal data** (§15.8).

`DUPLICATE_WARNING` is advisory data returned to the form, not a failure — duplicates never block
creation (§8.9).

---

## 4. Transactional RPCs (§16.3)

Multi-table writes go through a Postgres RPC so they are atomic and **RLS still applies**
(`SECURITY INVOKER`), rather than sequential client calls.

| RPC | Called by | Writes |
|---|---|---|
| `create_account_with_opportunity` | §11.1 primary mobile flow | account (owner = caller, status `PROSPECT`) → opportunity (stage `new`, auto title) → activity (`NOTE` / `ENQUIRY`) → `CREATED` event via trigger |
| `log_activity` | `logActivity()` | activity → next-action decision → returns the updated opportunity. **The two `last_activity_at` columns are NOT written here** — a trigger maintains them, because a work-context salesperson may log the activity without being able to update the parent (**ADR-020**) |
| `change_opportunity_stage` | `changeOpportunityStage()` | opportunity update → stage event via trigger; the reason reaches the event row through the transaction-local `app.event_reason` GUC (**ADR-001**) |
| `reassign_opportunity` | `reassignOpportunity()` | `owner_id` + `OWNER_CHANGED` event with its reason — **`SECURITY INVOKER`**, see the deviation note below (§15.5, **B-02**) |
| `bulk_reassign` | `bulkReassign()` | many opportunities + owner events |
| `execute_import` | `executeImport()` | the whole batch, service-role (§20.5, **H-08**) |

### Deviation — `reassign_opportunity` is SECURITY INVOKER, not DEFINER

This document previously specified `SECURITY DEFINER` with an internal `can_reassign()` check. It
was built as `SECURITY INVOKER` instead, and the reason is that the DEFINER version buys nothing
and costs a control.

The `opportunities_update` policy already expresses the rule exactly:

```sql
using       (owner_id = current_user_id() or manages_outlet(outlet_id))
with check  (owner_id = current_user_id() or manages_outlet(outlet_id))
```

A manager for the record's outlet satisfies both clauses before and after the change. A
salesperson satisfies `USING` on their own record but fails `WITH CHECK` the moment `owner_id`
names somebody else — so reassignment is refused by the database, with no application check
involved. A `SECURITY DEFINER` function would bypass that policy and then have to re-implement it
in PL/pgSQL, which is the same rule written twice, in the one place CLAUDE.md §6 says the rule must
live once. It would also expose a callable function that moves ownership with its own privileges.

Both cases are covered in `tests/integration/crm-permissions.test.ts`: a manager's reassignment
succeeds and writes the reason to the `OWNER_CHANGED` event; a salesperson calling the same RPC
directly is refused with `42501`.

The function is an RPC at all — rather than a plain update — only because ADR-001 sends the reason
to the audit trigger through a transaction-local GUC, and PostgREST gives each statement its own
transaction. A `set_config` in one request and an update in the next would record every
reassignment with an empty reason.

---

## 5. `logActivity` — the exact sequence (§10.2)

One transaction:

1. Insert the activity. **`account_id` is always resolved and populated**, even when launched from
   an opportunity.
2. `accounts.last_activity_at` and, when applicable, `opportunities.last_activity_at` are updated —
   **by the trigger from migration 018, not by this function** (ADR-020). A salesperson may log an
   activity against an account they do not own, and cannot update that account, so a write here
   would silently match zero rows. Back-dating uses `greatest(...)`, so logging last month's call
   never makes an account look staler than it is.
3. Apply the next-action decision from the same form:
   - a date and type were given → update the opportunity's `next_action` and `next_action_date`;
   - **"cannot determine yet" → set both to null**; the opportunity appears in Missing Next Action;
   - the opportunity is closed → **no next-action fields are touched**.
4. Return the updated opportunity so the UI refreshes without a second round-trip.

> **Context inference — the salesperson never chooses foreign keys.** Launching from an opportunity
> pre-fills account, project and opportunity; from a project, pre-fills account and project and
> offers that project's open opportunities as chips; from an account, pre-fills the account and
> offers its open opportunities.

---

## 6. Stage-change side effects (§9.3)

| Target stage | The service must |
|---|---|
| `quoted` | Require quotation fields; set `quotation_status = 'SENT'` if currently `NONE` |
| `won` | Require `final_order_value`; set `closed_at`; clear next action; `accounts.status = 'ACTIVE'` is applied by the trigger from 018 (ADR-020); **prompt (never auto-create)** a follow-on opportunity for another category on the same project |
| `lost` | Require `lost_reason`; set `closed_at`; clear next action |
| `nurture` | Require `next_action_date`; warn if under 14 days out |
| any backward move | **Require a `reason`**, stored on the `opportunity_events` row |

Transitions are validated against the constant map in `lib/opportunity/transitions.ts`; anything
not listed in §9.2 is rejected with `INVALID_TRANSITION`. **`won` is final** — correction is an
explicit `reopenOpportunity()` by MANAGER/OWNER that logs a `REOPENED` event; **there is no silent
edit**.

Marking won also creates an activity with purpose `ORDER_CONFIRMATION` (§11.8).

---

## 7. Cron routes (§14.7)

`POST|GET /api/cron/{new-opportunity-sla, daily-digest, manager-digest, owner-summary, maintenance}`

- Require an `Authorization: Bearer ${CRON_SECRET}` header.
- Use the Supabase **service-role** client.
- Excluded from the public sitemap.
- Return `{ processed, sent, failed, durationMs }`.
- **Never block, never crash.** Log per-item failures and continue.

| Route | Schedule (IST) | Behaviour |
|---|---|---|
| `new-opportunity-sla` | hourly | Email the owner (or manager if unassigned) once per opportunity past `new_enquiry_sla_hours` |
| `daily-digest` | 08:30 | One email per salesperson — **never a group email**; skipped entirely when all three lists are empty |
| `manager-digest` | 09:00 | One email grouped by salesperson when any Panel A tile is non-zero |
| `owner-summary` | per `owner_summary_schedule` | §13.4 exactly, max 10 lines. **No retry** — a stale summary is worse than none |
| `maintenance` | 02:00 | Dormant accounts · expired quotations · recompute `last_activity_at` **and log every row it had to correct** |

> A non-zero correction count from `maintenance` indicates a bug in a write path.
> **Do not suppress that log** (§14.6).

Open items: **B-05** (the SLA "already notified" state has nowhere to live), **B-03**
(`actor_id` when there is no `auth.uid()`), **H-09** (maintenance can defeat import rollback),
**M-26/M-27** (Vercel Cron is static and UTC).

---

## 8. Integration interfaces (§16.4)

Implemented in V1: `WhatsAppIntegration.buildDeepLink(phone, text?)` → `https://wa.me/91{phone}`,
and `NotificationService.sendEmail(to, subject, html)` → Resend.

**Not implemented, and not stubbed:** `AccountingIntegration`, `InventoryIntegration`. They exist
as type declarations only. **Do not write fake adapters** (§16.4, `CLAUDE.md` §14).

---

## 9. Validation

- Zod schemas live in `src/features/*/schemas.ts` and are shared client and server.
- **All mutations are validated server-side with Zod regardless of client validation** (§15.8).
- Validation mirrors the database constraints; it does not replace them. **Database integrity is
  authoritative.** `accounts` now carries `account_reachable check (phone is not null or email is
  not null)` (**ADR-013**), matching `contacts.contact_reachable`, so the phone-or-email rule
  cannot be defeated by a service-layer bug or a faulty import validator.
