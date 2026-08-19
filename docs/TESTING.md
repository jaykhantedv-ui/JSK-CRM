# Testing

Derived from `CLAUDE_CODE_BUILD_SPEC.md` §19, §23. **No tests have been written yet.**

---

## The gate

> **Do not chase a coverage percentage — the fifteen E2E scenarios plus the RLS integration suite
> are the real gate** (§19.5).

> **Never verify a permission as OWNER — OWNER passes everything, which is exactly why it proves
> nothing** (§23).

> **A hidden button is never a control. Every security test must attack the API, not the UI**
> (§19.4).

> **Run the full suite each phase. Fix every failure. Never skip a failing test** (§22.1 step 8).

---

## 1. Unit (Vitest) — pure logic, no database (§19.1)

| Area | What must be covered |
|---|---|
| Phone normalisation | `+91`, leading `0`, leading `91`, spaces, dashes, brackets, too short, non-numeric — **and parity with the SQL `normalize_phone()` over the same fixture table** |
| Money | paise ↔ rupee conversion, Indian grouping (`₹4,20,000`), zero, large values, no `parseFloat` anywhere |
| Stage transitions | **Every valid and invalid pair** in §9.2 — all 81 combinations, exhaustively |
| Duplicate confidence | All five §8.9 rows: exact phone, exact email, similarity ≥ 0.6 + same city, similarity ≥ 0.8 without city, none |
| Dashboard metrics | Every §13.1 definition against fixture arrays, including **Win Rate returning null (displayed `—`) when the denominator is 0** |
| Dates | Overdue/due-today/days-in-stage **across timezone boundaries** — the IST↔UTC 00:00–05:30 window (`/docs/SPEC_AUDIT.md` B-10) |
| Error mapping | Every constraint name → friendly message; unmapped errors become `INTERNAL` and never leak Postgres text |

---

## 2. Integration (Vitest + local Supabase) — database and RLS (§19.2)

Run against `supabase start` with seeded users of each role.

> **These are the most important tests in the project.**

### Constraints and triggers
- Check constraints reject: won without value, won without `closed_at`, lost without reason, lost
  without `closed_at`, quoted without quotation ref, next-action half-set, nurture without date,
  contact with neither phone nor email, stakeholder with neither target.
- The trigger writes an `opportunity_events` row on **every** stage and owner change — and both
  rows when stage and owner change in one statement.
- The partial unique index rejects a second primary stakeholder.
- `stage_changed_at` advances on stage change and only then (`/docs/SPEC_AUDIT.md` H-01).
- `v_opportunity_flags` has `security_invoker = true` — asserted against `pg_class.reloptions`,
  because a default view silently leaks every salesperson's pipeline (§25).

### RLS — every assertion made as the restricted role
- Salesperson A cannot SELECT, UPDATE or INSERT-on-behalf-of salesperson B's records.
- Salesperson **can** read an account they do not own when they own an opportunity on it — and
  that account's contacts and projects by the same route.
- Salesperson cannot change `owner_id` — by table UPDATE, by PostgREST, or through the RPC.
- ADMIN cannot reassign; MANAGER and OWNER can (`/docs/SPEC_AUDIT.md` H-05).
- **No role can DELETE from any business table**, including `users` (H-06).
- A salesperson cannot escalate their own role via a profile update.
- Archived records are excluded from active queries and included in archive queries for
  authorised roles.
- Activities: the author can update within 24 h, cannot at 24 h + 1 s, and a non-author cannot
  update at all. Nobody can delete.

### Atomicity
- `create_account_with_opportunity` leaves no account when the activity insert fails.
- `log_activity` updates both `last_activity_at` columns and the next-action fields in one commit.
- Import execution rolls the whole batch back on any unhandled error.

---

## 3. End-to-end (Playwright) — the fifteen required scenarios (§19.3)

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
13. Salesperson cannot access another salesperson's opportunity via direct URL **or via a direct
    Supabase query from the browser console**
14. CSV import detects duplicates and honours per-row decisions
15. The full mobile workflow at **375×812 completes in under 60 seconds**

**All fifteen must pass** (§23.8). Scenario 9's "404" and §12.6's Forbidden state contradict each
other — decide before writing it (`/docs/SPEC_AUDIT.md` M-03).

---

## 4. Security tests — mandatory (§19.4)

- Direct PostgREST calls with salesperson credentials attempting cross-user reads
- Role escalation via profile update
- **Service-role key absent from the client bundle — verified by grepping the build output**
- Storage object access without visibility of the parent entity
- Unauthenticated access to every route
- Session expiry handling
- File upload of a **disguised executable** (magic-byte verification, not extension)
- SQL injection attempts through the search input

---

## 5. Non-functional checks

| Check | Target | Source |
|---|---|---|
| `/today` interactive | under 1.5 s on 4G | §12.8 |
| Any list query | under 400 ms server-side | §12.8 |
| Dashboard tiles | under 400 ms with **20,000 opportunities seeded** | §23.6 |
| Pagination | 25 mobile / 50 desktop; **no unbounded list query anywhere** | §12.8 |
| Mobile create-customer | under 60 s **on a real Android device** | §23.9 |
| Build | `npm run build` with **zero** TypeScript and lint errors | §23.9 |
| Vocabulary | the word **"revenue" appears nowhere** in the UI | §2.4, §23.6 |

The 20,000-opportunity fixture and the measurement method are not specified anywhere in the spec
(`/docs/SPEC_AUDIT.md` M-18), and integration tests need Docker in CI (M-20). Both need decisions
before Phase 19.

---

## 6. Acceptance criteria by area (§23)

Tested **as the relevant role**, never as OWNER.

### §23.1 Accounts
Create with name, type, and phone or email; owner defaults to the creating user · `+91 98765-43210`
normalises to `9876543210` · exact phone match triggers a strong warning showing the existing
record, and creation is **still possible** after confirmation · possible duplicate (similar name +
same city) triggers a review warning · **no record is ever merged automatically** · archive removes
it from active lists, restore returns it, relationships and activities survive both · salesperson
sees only their own accounts in list, search and counts *(plus work-context accounts — M-16)* ·
salesperson reading another's account by direct URL gets not-found · Customer 360 shows next
action, Won Value, Pipeline Value, last contact and **exactly 3** recent activities · usable
one-handed at 375px.

### §23.2 Contacts
**A homeowner account works with no contact record** · contact attaches to an account, and a
standalone contact (independent architect) also works · `linked_account_id` correctly represents a
contact who is also a customer · the constraint rejects a contact with neither phone nor email.

### §23.3 Projects and stakeholders
Project created under an account · three stakeholders with different roles and influence ·
a second primary is rejected with a friendly message · a stakeholder can reference a contact, an
account, or both · **project detail lists multiple opportunities** · filters by construction stage
and city work.

### §23.4 Opportunities
Created from an account and from a project; `project_id` remains optional · valid transitions
succeed, invalid ones are rejected by the service · backward transition requires a reason, stored
in `opportunity_events` · entering `quoted` without quotation fields is **rejected by the
database** · `won` requires `final_order_value`, the account becomes ACTIVE, next action cleared ·
`lost` requires `lost_reason` · `nurture` requires a next action date and is excluded from Pipeline
Value · **every stage and owner change produces an `opportunity_events` row** · unassigned
opportunities appear on the manager dashboard · **salesperson cannot change `owner_id` by any
route**.

### §23.5 Activities and next actions
Activity logged in **3 taps** from an opportunity · `account_id` always populated · site visit
exposes measurements, location and photo upload · **"Can't say yet" is accepted** and the
opportunity appears in Missing Next Action · overdue shows red with "Overdue by N days" · activity
editable by its author for 24 hours, immutable after, **deletable by nobody** · timeline is
reverse-chronological with type icons and outcome.

### §23.6 Dashboards
Salesperson sees only their own data in every tile · Pipeline Value equals a manual sum of active
non-nurture opportunities · Win Rate matches the §13.1 formula and shows **"—"** when no closed
deals · every manager exception tile links to a correctly filtered list · **owner dashboard
contains no more than the §13.4 blocks** · **the word "revenue" appears nowhere** · tiles render
under 400 ms with 20,000 opportunities seeded.

### §23.7 Import, archive, merge
Templates download; invalid rows report row number and specific reason · in-file duplicates are
ERROR, against-database duplicates require a decision · imported records carry `is_imported`,
`import_batch_id`, `legacy_ref` · **import fires no notifications** · rollback within 7 days
archives everything from the batch and refuses if records were edited · merge requires
confirmation, preserves all activities, and is recorded in the audit trail *(blocked by H-02)*.

### §23.8 Security
All fifteen E2E scenarios pass · salesperson cannot read/write another's records through a **direct
PostgREST call** · role escalation via self-update is rejected · **no role can DELETE from any
business table** · service-role key absent from the client bundle (verified by grep of the build) ·
Storage objects unreadable without entity visibility · **no database error text ever reaches the
user**.

### §23.9 Launch readiness
Migrations apply cleanly to an empty database · seed produces a working OWNER login ·
`system_settings.cities` populated (**TODO-BD-06**) · backup and restore procedure documented
**and tested once** · all nine `/docs` files reflect the built system · `npm run build` passes with
zero TypeScript and lint errors · mobile create-customer flow completes in under 60 seconds on a
real Android device.

---

## 7. Coverage expectations (§19.5)

Services and RLS: **high and meaningful**. UI components: **only where logic exists**.
The gate is behavioural, not numeric.
