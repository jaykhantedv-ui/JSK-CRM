# Testing

Derived from `CLAUDE_CODE_BUILD_SPEC.md` §19, §23. **No tests have been written yet.**

---

## The gate

```bash
npm run verify     # typecheck -> lint -> unit -> integration -> build -> bundle check
npm run test:e2e   # Playwright, separately (it starts a dev server)
```

**Run the full suite each phase. Fix every failure. Never skip, `.skip`, or delete a failing test
to make a phase pass** (§22.1 step 8).

Do not chase a coverage percentage. The gate is **the fifteen E2E scenarios plus the RLS suite**.

### Current state — Master Phase 1

| Suite | Count | Status |
|---|---|---|
| Unit (Vitest) | 232 | passing |
| Integration + RLS (Vitest + PostgreSQL) | 154 | passing |
| E2E smoke (Playwright) | 8 | passing |
| `tsc --noEmit` | — | clean |
| ESLint | — | clean |
| `next build` | — | clean |
| Service-role key absent from the bundle | — | verified |

### Where the tests run (ADR-018)

§19.2 assumes `supabase start`. Where the Supabase container images are unreachable — as in the
environment this was built in — the database suites run against a **real PostgreSQL 16 server**
with the platform bootstrap in `supabase/platform/`.

A test impersonates a user **exactly as PostgREST does**:

```ts
await db.query('select set_config($1, $2, true)', [
  'request.jwt.claims',
  JSON.stringify({ sub: userId, role: 'authenticated' }),
])
await db.query('set local role authenticated')
```

Nothing is mocked. `auth.uid()` resolves the way it does in production, and a policy that would
refuse a real request refuses the test, with the same error code.

**What cannot be tested here, and is not claimed to be:** Supabase Auth itself — password hashing,
JWT issue, the built-in login rate limiting of C-5 — Storage buckets and their policies (§15.6),
and PostgREST's own request handling. Those need a real Supabase project in `ap-south-1`.

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
| Permissions | The §3.1 capability matrix cell by cell, outlet scope for zero/one/many outlets, and the ADR-017 ADMIN case — mirroring the RLS policies so the UI never offers an action the database refuses |

**Built in Master Phase 1:** phone, money, dates, transitions, permissions, error mapping.
**Arriving with their features:** duplicate confidence (§8.9) and the dashboard metrics (§13.1) —
there is nothing to test until the code they describe exists, and a test written against an
imagined implementation tests the imagination.

---

## 2. Integration (Vitest + a real database) — database and RLS (§19.2)

Fixture users of every role, in `supabase/seed/dev-fixtures.sql`: an owner with no outlets, an
admin, a manager on one outlet, a manager on two, a manager on none, three salespeople across two
outlets, and a deactivated user. Three outlets, so *"assigned to A and C"* is distinguishable from
*"sees everything"*.

> **These are the most important tests in the project.**

Files: `harness.ts` · `rls-outlet-scope.test.ts` · `schema-constraints.test.ts` ·
`audit-trail.test.ts` · `no-hard-delete.test.ts` · `activities-window.test.ts` ·
`timezone-and-flags.test.ts`.

### Constraints and triggers
- Check constraints reject: won without value, won without `closed_at`, lost without reason, lost
  without `closed_at`, quoted without quotation ref, next-action half-set, nurture without date,
  contact with neither phone nor email, stakeholder with neither target.
- **`selection → negotiation` succeeds with no quotation information** — the ADR-006 regression
  test, because the constraint binds on `quoted` alone.
- An account with neither phone nor email is rejected (`account_reachable`, ADR-013).
- The trigger writes an `opportunity_events` row on **every** stage and owner change, emits
  `REOPENED` for `won → qualified` and `ARCHIVED`/`RESTORED` on archive, and reads the reason from
  the `app.event_reason` GUC (ADR-001).
- A service-role write with no `auth.uid()` is attributed to the system actor (ADR-003).
- Reopening a won opportunity clears `final_order_value` and `closed_at`, **preserves the WON
  event**, and leaves `accounts.status` alone (ADR-007).
- The partial unique index rejects a second primary stakeholder.
- `phone_normalized` matches `lib/phone.ts` case for case, and is deliberately **not** unique.
- **`v_opportunity_flags` has `security_invoker = true`** — asserted against `pg_class.reloptions`
  *and* behaviourally, because a default view silently leaks every salesperson's pipeline (§25).
- Every date expression in the view converts to Asia/Kolkata; the view definition is asserted to
  contain **no bare `current_date`**, and `businessDate()` in TypeScript is checked against the SQL
  expression at the 18:30 UTC boundary and across a year end.

### RLS — every assertion made as the restricted role
- Salesperson A cannot SELECT, UPDATE or INSERT-on-behalf-of salesperson B's records.
- Salesperson **can** read an account they do not own when they own an opportunity on it — and
  that account's contacts and projects by the same route.
- Salesperson cannot change `owner_id`, cannot null it, cannot move a record to another outlet and
  cannot archive one.
- **Cross-outlet (ADR-016):** Manager A reaches outlet A and **not** B or C; a manager on A and C
  reaches both and still not B; a manager with **no** outlets reaches nothing; revoking an
  assignment removes the scope immediately. A record's outlet decides scope, **not its owner's
  posting**.
- **ADMIN reads no business data at all** (ADR-017) while still administering users, outlets and
  settings; a manager cannot manage users or outlets.
- A deactivated user holding a valid token reads nothing; an anonymous caller reaches nothing.
- ADMIN cannot reassign; MANAGER and OWNER can (H-05, subsumed by ADR-017).
- **ADMIN cannot export** through the Server Action, not merely through a hidden button (C-2).
- **No role can DELETE from any business table**, including `users` (H-06) — asserted table by
  table and role by role, plus a check that `authenticated` holds the DELETE privilege on nothing
  else. **`project_stakeholders` is the single approved exception** (ADR-004) and must *succeed*;
  all twelve other tables must *fail*, for every role.
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

**Master Phase 1 ships a smoke suite, not the fifteen scenarios.** Signing a user in needs Supabase
Auth, which cannot run in this environment (ADR-018), and a test that faked a session would prove
nothing about the thing it claims to test.

What the smoke suite proves today:

- the login screen renders, with an email field, a password field and a submit button;
- **there is no sign-up link and no registration path** (§3.2);
- an unauthenticated visitor to `/`, `/today`, `/dashboard`, `/settings` or `/accounts` lands on
  the login screen;
- no part of the authenticated shell renders for a signed-out visitor.

The fifteen scenarios arrive with the features they cover, against a real Supabase project.

### The fifteen required scenarios

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

**All fifteen must pass** (§23.8). Scenario 9 asserts **404 / not-found** — resolved (M-03):
unauthorised record access never confirms the record exists. §12.6's "Forbidden" state is reserved
for route-level denial where no record identity is revealed.

---

## 4. Security tests — mandatory (§19.4)

- Direct PostgREST calls with salesperson credentials attempting cross-user reads
- Role escalation via profile update
- **Login rate limiting** (C-5): repeated failed logins throttle, the provider error maps to
  `AppError`, and the message leaks no implementation detail — no retry-after internal, no hint of
  which credential was wrong
- **The user-provisioning action rejects a salesperson before touching the admin client** (ADR-009)
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

The 20,000-opportunity performance fixture (M-18) and the Supabase/Docker CI strategy (M-20) are
both approved and are built in Phase 19. The RLS suite runs **on every commit**, not locally only.

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
confirmation, preserves all activities, and records source/target in `opportunity_events.metadata`
per moved opportunity. **Merge is not reversible in V1** (ADR-008) — the UI must warn so before
confirmation, and no document or screen may claim otherwise.

### §23.8 Security
All fifteen E2E scenarios pass · salesperson cannot read/write another's records through a **direct
PostgREST call** · role escalation via self-update is rejected · **no role can DELETE from any
business table** (ADR-004's `project_stakeholders` link row is the single documented exception) · service-role key absent from the client bundle (verified by grep of the build) ·
Storage objects unreadable without entity visibility · **no database error text ever reaches the
user**.

### §23.9 Launch readiness
Migrations apply cleanly to an empty database · seed produces a working OWNER login and the
ADR-003 system user · `system_settings.cities` populated with the **ten Erode District revenue
taluks** (**TODO-BD-06**; Chennimalai is a block/firka under Perundurai and belongs in `area`) · backup and restore procedure documented
**and tested once** · all nine `/docs` files reflect the built system · `npm run build` passes with
zero TypeScript and lint errors · mobile create-customer flow completes in under 60 seconds on a
real Android device.

---

## 7. Coverage expectations (§19.5)

Services and RLS: **high and meaningful**. UI components: **only where logic exists**.
The gate is behavioural, not numeric.
