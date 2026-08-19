# Specification Audit — `CLAUDE_CODE_BUILD_SPEC.md`

**Audited:** complete document, §1–§25 (1,921 lines)
**Date:** August 2026
**Auditor:** Claude Code (lead architect role)
**Status:** findings recorded, **none resolved**. The specification has not been modified.

This document records contradictions, missing dependencies, impossible requirements, ambiguities,
database dependency problems, authentication/RLS risks, missing environment requirements,
migration-order issues, testing gaps and deployment risks found in the specification.

**Nothing here is a decision.** Items marked **BLOCKER** must be answered before the phase that
depends on them can start. Items marked **HIGH** must be answered before that phase's gate.
Business-level questions are cross-referenced to `/docs/DECISIONS.md`; none of them are
`TODO-BD` items — the twelve `TODO-BD` items are separate and are handled by the
`system_settings` mechanism, not by this audit.

**Severity key** — BLOCKER: the spec as written cannot be implemented, or produces a security or
data-correctness defect. HIGH: implementable but the spec contradicts itself and the choice is
material. MEDIUM: ambiguity, gap or risk that needs a stated position before it bites.

---

## Summary

| Severity | Count | First blocking phase |
|---|---|---|
| BLOCKER | 10 | Phase 3 (migrations) |
| HIGH | 13 | Phase 3 |
| MEDIUM | 30 | Phase 2 |
| **Total** | **53** | |

Nine findings must be answered before **any** migration is written (B-04, B-06, B-07, B-10,
H-03, H-04, M-08, M-23, plus TODO-BD-08 for provisioning). Four must be answered before the
opportunity service exists (B-01, B-02, B-03, H-10).

---

## BLOCKERS

### B-01 — `opportunity_events.reason` cannot be written by the service layer
**Sections:** §5.9, §9.2, §11.9, §15.5
**Type:** contradiction / impossible requirement

§5.9 says events are "written by a database trigger on `opportunities` … **and** by the service
layer for reason text". §9.2 requires backward transitions to store a `reason` on the
`opportunity_events` row, and §11.9 requires the reassignment reason to be "written by the
service into the event row".

But §5.9 also states "There is no UPDATE or DELETE policy on this table for any role. It is
append-only for everyone", and §15.5 restricts `opportunity_events` INSERT to "service-role and
triggers only". §16.3 requires the stage-change transaction to be a `SECURITY INVOKER` RPC so RLS
still applies.

The trigger writes the row without a reason; the service cannot INSERT (no policy) and cannot
UPDATE (no policy) to attach one. **As specified, `reason` is unwritable on any user-initiated
path.**

*Options (decision required):* (a) pass the reason to the trigger through a transaction-local
GUC — `set_config('app.event_reason', …, true)` — read by `log_opportunity_event()`; (b) make
stage/owner changes exclusively `SECURITY DEFINER` RPCs that write the event row themselves and
narrow the trigger to catch only out-of-band changes; (c) grant a narrow INSERT policy on
`opportunity_events`. Option (a) preserves "no path can bypass the audit" with the smallest
change and is the recommendation, but it is not in the spec.

**Blocks:** Phase 11 (opportunities), Phase 6 (services).

### B-02 — the `opportunities` UPDATE `with check` in §15.5 is invalid SQL and recursive
**Sections:** §15.5
**Type:** impossible requirement / RLS risk

The spec offers this expression for "own (any field except `owner_id`)":

```sql
with check (
  public.is_manager_or_above()
  or (owner_id = auth.uid() and owner_id = (select o.owner_id from public.opportunities o where o.id = id))
)
```

Two independent defects:
1. Inside the subquery, unqualified `id` resolves to the **inner** `o.id`, not the row being
   checked. The predicate becomes `o.id = o.id`, the subquery returns every row, and the
   statement fails with *"more than one row returned by a subquery used as an expression"*.
2. Even with the reference corrected, the subquery reads `public.opportunities` from inside an
   `public.opportunities` policy → policy recursion.

The spec anticipates this ("If that proves awkward… **Prefer the RPC**") and offers a
`SECURITY DEFINER` `reassign_opportunity` RPC with `owner_id` changes denied in the table policy.
That path is sound and is the recommendation — but the choice is not made, and the fallback SQL
must not be copied into a migration.

**Blocks:** Phase 5 (RLS), Phase 11.

### B-03 — `opportunity_events.actor_id` is `not null` but `auth.uid()` is null for service-role writes
**Sections:** §5.9, §14.6, §15.7, §20.5
**Type:** impossible requirement

`actor_id uuid not null references public.users(id)`. The trigger sets it from `auth.uid()` on
UPDATE and `coalesce(new.created_by, auth.uid())` on INSERT.

Service-role clients (cron routes §14.7, import executor §20.5) have **no `auth.uid()`**. Any
service-role statement that changes `opportunities.stage` or `owner_id` — or inserts an
opportunity with a null `created_by` — raises a not-null violation and aborts the job. The
nightly maintenance job (§14.6) writes to `opportunities` today; a future service-role path that
touches stage would fail hard.

*Options:* a reserved system user row in `public.users` used as the actor for automated writes,
`coalesce(auth.uid(), new.created_by, <system uuid>)`; or making `actor_id` nullable with a
check that it is non-null when `auth.uid()` is present. Neither is specified.

**Blocks:** Phase 3 (migration 012), Phase 18 (cron).

### B-04 — migration `014_rls_helpers` cannot run in Phase 1
**Sections:** §5.12, §22 (phase table), §15.1
**Type:** migration-order defect

§22 assigns migrations "001–003, **014** (helpers)" to Phase 1. But `owns_opportunity_on_account()`
and `owns_opportunity_on_project()` are `language sql` functions whose bodies select from
`public.opportunities`, which does not exist until migration 010.

PostgreSQL validates `language sql` function bodies at creation time (`check_function_bodies` is
`on` by default, including on Supabase). Migration 014 therefore **fails** if applied before 010.

*Options:* split 014 into `014a` (role helpers: `user_role`, `is_manager_or_above`,
`is_owner_or_admin` — safe in Phase 1) and `014b` (work-context helpers — after 010); or keep
014 whole and move it to Phase 4. The split is cleaner and matches §22's own instruction that
"RLS policies are written as each table is created".

**Blocks:** Phase 3, Phase 4.

### B-05 — the SLA-notification dedup key has nowhere to live
**Sections:** §4.2, §14.2, §14.6, §5.1, §5.9
**Type:** impossible requirement

§14.2 requires the new-opportunity SLA email to fire "once per opportunity (deduplicated by a
`notified_new_sla` key in the event metadata)". §14.6 requires alerting the OWNER "if the job
fails **twice consecutively**".

Neither state has a home:
- §4.2 rejects a `notifications` table; its stated substitute — "folded into
  `system_settings`-driven cron jobs" — describes scheduling, not per-record state.
- `opportunity_event_type` (§5.1) has no notification value, so the cron cannot insert an event
  row without a new enum value (a migration).
- Existing event rows cannot be updated: `opportunity_events` has **no UPDATE policy for anyone**
  and is append-only by design.

Without a resolution the SLA reminder **re-sends every hour, forever**, for every opportunity
sitting in `new` — the exact alert-fatigue failure §25 warns about for imports.

*Options:* add an enum value + append a `NOTIFIED` event; a `notified_at` column on
`opportunities`; a `system_settings` key holding a cursor/last-run watermark (cron uses
service-role and can write it); or accept "once per hour until the stage changes" as the
behaviour. All four are spec changes.

**Blocks:** Phase 18 (cron and email).

### B-06 — `normalize_phone()` must be `IMMUTABLE` and the spec never says so
**Sections:** §5.0, §5.3, §5.4
**Type:** database dependency problem

`accounts.phone_normalized` and `contacts.phone_normalized` are
`generated always as (public.normalize_phone(phone)) stored`. PostgreSQL requires the generation
expression to call only **`IMMUTABLE`** functions. `create function … language sql` defaults to
`VOLATILE`, so the table DDL fails with *"generation expression is not immutable"*.

The function must be declared `immutable` (and `strict`/`parallel safe` is advisable) in
migration 001. This is a one-word fix but it is invisible until migration 005 fails, and it
also constrains the implementation: the body must be genuinely deterministic (regex/`translate`
only — no locale-dependent or configuration-dependent calls).

**Blocks:** Phase 3 (migrations 001, 005, 006).

### B-07 — §5.3's `accounts` DDL contradicts the migration order in §5.12
**Sections:** §5.3, §5.12, §25
**Type:** contradiction / migration-order defect

The `accounts` DDL in §5.3 declares `referred_by_contact_id uuid references public.contacts(id)`
inline. §5.12 orders `005_accounts` → `006_contacts` → `007_accounts_fk` precisely because the
tables are mutually referential, and §25 lists the circular FK as a known risk.

The §5.3 block **cannot execute as written** at position 005. The column must be created without
the `references` clause in 005, and the FK added by `alter table` in 007.

The spec is internally consistent in intent and inconsistent in text; the DDL blocks in §5 are
"the intended migration content" per §5, so this needs an explicit note in `/docs/DATABASE.md`
(done) so nobody pastes §5.3 verbatim.

**Blocks:** Phase 3.

### B-08 — `removeProjectStakeholder()` can neither delete nor archive
**Sections:** §16.1, §5.6, §8.8, §15.2
**Type:** contradiction / impossible requirement

`removeProjectStakeholder(stakeholderId): Promise<void>` is in the service contract. But:
- §8.8 and §15.2: "No role has a `DELETE` policy on any business table", "Nothing is ever
  hard-deleted";
- `project_stakeholders` (§5.6) has **no `archived_at` / `archived_by` columns** — it is not in
  the archivable set;
- §11.4's UI shows stakeholder chips, implying removal is a normal correction, not an exception.

There is no legal implementation. *Options:* add `archived_at`/`archived_by` to
`project_stakeholders` (a schema change, and it changes the partial unique indexes, which must
then become `where … and archived_at is null`); grant a narrow DELETE policy on this one
join table on the grounds that it is a link, not a business record; or drop the operation and
require correcting the row instead.

**Blocks:** Phase 10 (projects and stakeholders).

### B-09 — Storage uploads conflict with "no client-side Supabase writes" and with the platform body limit
**Sections:** §17.2, §15.6, §11.5, §5.8
**Type:** contradiction / deployment risk

§17.2: "**No client-side Supabase writes.**" §15.6: files up to **10 MB**, private bucket,
authenticated users may `INSERT`. §11.5: photo upload on site visits, and "upload failure does
not block the activity — the activity saves and the upload retries", which only makes sense if
the upload is a separate client-initiated call.

Routing a 10 MB upload through a Server Action is not possible on the target host: Vercel's
serverless request body limit is **4.5 MB**, and Next.js Server Actions have their own (lower,
configurable) body limit. A 10 MB file **must** go browser → Storage directly.

The resolution — a server-issued **signed upload URL**, with the database row still written by a
Server Action — is standard and safe, but it is an explicit carve-out from a rule the spec states
absolutely, and it must be written down rather than discovered. `CLAUDE.md` §7 records the
carve-out pending approval.

**Blocks:** Phase 17 (storage), Phase 12 (site-visit activity).

### B-10 — the business day is Asia/Kolkata but every date expression in the spec is session-timezone
**Sections:** §10.3, §13.1, §8.11, §19.1, §17.4
**Type:** correctness defect (affects every accountability metric)

§8.11 stores UTC and displays `Asia/Kolkata`. But `v_opportunity_flags` (§10.3) and all §13.1
metric definitions use bare `current_date` and `stage_changed_at::date` /
`last_activity_at::date`. In PostgreSQL these evaluate in the **database session timezone**,
which is UTC on Supabase.

Concretely: between **00:00 and 05:30 IST** every day, `current_date` in the database is still
*yesterday*. During that window "Due Today" shows yesterday's list, "Overdue" under-counts by a
day, `days_in_stage` and `days_since_activity` are off by one, and the 02:00 IST nightly
maintenance job (§14.6) computes dormancy against the wrong day boundary. `TZ=Asia/Kolkata`
(§17.4) sets the **Node** timezone and does not affect Postgres at all, so the application layer
and the database will also disagree with each other.

Every date expression must be written `(now() at time zone 'Asia/Kolkata')::date` and
`(ts at time zone 'Asia/Kolkata')::date`. §19.1 already requires tests for "date/overdue
calculations across timezone boundaries" — those tests will fail against the spec's own SQL.

**Blocks:** Phase 3 (view), Phase 12, Phase 14, Phase 18.

---

## HIGH

### H-01 — `stage_changed_at` has no specified maintainer
**Sections:** §5.7, §10.3, §13.1**Type:** missing dependency
`stage_changed_at timestamptz not null default now()` is never updated by anything the spec
describes. `log_opportunity_event()` writes the event but does not touch it, and no service rule
sets it. `days_in_stage` and the "Stalled" exception tile (§13.1, §13.3) depend on it, so as
specified every opportunity appears to have been in its current stage since creation. Needs a
line in the trigger (`if new.stage is distinct from old.stage then new.stage_changed_at = now()`)
or an explicit service rule — the trigger is safer because it cannot be bypassed.

### H-02 — `mergeAccounts` is specified as reversible but nothing records the merge
**Sections:** §8.9, §16.1, §4.1, §23.7**Type:** impossible requirement
§8.9: merging is "always reversible via the audit trail". §23.7 requires the merge to be
"recorded in the audit trail". The only audit table is `opportunity_events`, which is scoped to a
single opportunity and has no `ACCOUNT_MERGED` event type; `accounts`, `contacts` and `projects`
have no event table at all, and §4.1 caps the model at eleven tables. After a merge, nothing
records which contacts/projects/opportunities were moved from the merged account, so the
operation cannot be reversed. Needs a decision: partial reversibility recorded per-opportunity in
`opportunity_events.metadata`, a twelfth table, or dropping the reversibility claim.

### H-03 — §22's phase→migration mapping contradicts §5.12's ordering
**Sections:** §22, §5.12**Type:** migration-order defect
Three conflicts: (a) `013_system_settings` is assigned to **Phase 7**, but `stage_probabilities`
is required for Weighted Pipeline (Phase 6 / §13), and `dormancy_days` + `stage_stall_days` are
required for the flags and exception lists (Phase 5 / §13.1); (b) `012_opportunity_events` is
assigned to Phase 4 while `011_activities` is assigned to Phase 5, but migrations apply in
numeric order, so 011 must be applied to reach 012; (c) `004 (extend)` in Phase 7 conflicts with
"never edit a migration that has been applied" (§21.2) — an extension must be a new numbered file.

### H-04 — RLS is enabled only in migration 015, in Phase 8
**Sections:** §22, §5.12, §15**Type:** authentication/RLS risk
`015_rls_policies` ("enable RLS + all policies") is a single file scheduled for Phase 8, yet §22
also says "RLS policies are written **as each table is created** (phases 2–5). Do not defer all
security to phase 8." Both cannot be true of one migration file. If 015 is the only place RLS is
enabled, then throughout Phases 2–7 **every authenticated user can read and write every row**
via the anon key and PostgREST — and any staging deployment in that window is fully exposed.
Policies must be created per table in the table's own migration; 015 becomes an audit/hardening
migration.

### H-05 — `is_manager_or_above()` grants ADMIN the reassignment rights §3.1 denies
**Sections:** §3.1, §15.1, §15.4, §15.5**Type:** contradiction / permission defect
§3.1 gives ADMIN "See all records ✔", "Edit any record ✔", but "**Assign / reassign ownership ✘**".
Every write policy in §15 gates on `is_manager_or_above()`, which is defined as
`MANAGER, OWNER, ADMIN`. As written, ADMIN can change `owner_id` on accounts, projects and
opportunities. A distinct helper — `can_reassign()` = `MANAGER, OWNER` — is required, and the
`reassign_opportunity` RPC must use it.

### H-06 — `users_admin_all … for all` grants DELETE on `users`
**Sections:** §15.3, §3.1, §15.2**Type:** contradiction / RLS risk
`create policy users_admin_all on public.users for all …` includes `DELETE`. §3.1 gives
"Hard delete anything" to nobody, and §15.2 says no DELETE policy on any business table. Deleting
a `users` row would also break `activities.performed_by` and `opportunity_events.actor_id`
(both `not null` FKs, no `on delete` clause → the delete would fail anyway, noisily). The policy
should be `for select`, `for insert`, `for update` — enumerated, not `for all`.

### H-07 — creating users requires the service-role key, which §15.7 restricts to cron and import
**Sections:** §3.2, §15.7, §5.12 (003 `handle_new_auth_user()`), §12.2**Type:** contradiction
§3.2 forbids self-registration; OWNER/ADMIN create users at `/settings/users`. Creating a
Supabase Auth user from the server requires `auth.admin.createUser()` — i.e. the **service-role**
key. §15.7 says the service-role key is for "cron routes and the import executor **only**".
Either the restriction gains a third permitted caller (a user-provisioning Server Action that
verifies OWNER/ADMIN before touching the admin client), or user creation happens outside the app
(Supabase dashboard + invite), which contradicts §12.2's `/settings/users` screen. Also,
`handle_new_auth_user()` is named in the migration list but never specified — its behaviour
(what `role`, `full_name` and `branch` a new `auth.users` row gets) is undefined.

### H-08 — "one transaction per batch" and "progress reported per 100 rows" are mutually exclusive
**Sections:** §20.5, §16.3, §21**Type:** impossible requirement / deployment risk
A single database transaction is invisible to any other session until it commits, so progress
written inside it cannot be read by a polling client. Additionally, 5,000 rows of insert +
duplicate analysis in one serverless invocation risks the platform's function timeout (60 s
default on Vercel Pro, 300 s maximum), and a failure at row 4,900 discards ~5 minutes of work.
Needs a position: keep the atomic guarantee and drop live progress (report only on completion),
or chunk into per-N-row transactions and rely on §20.6 rollback for compensation — the latter
weakens "any unhandled error rolls the whole batch back".

### H-09 — the nightly maintenance job can silently disqualify an import rollback
**Sections:** §14.6, §20.6**Type:** interaction defect
§20.6 allows rollback within 7 days "**only if no imported record has been edited since import**".
§14.6 runs nightly and sets `accounts.status = 'DORMANT'` where there has been no activity beyond
the threshold — which describes freshly imported historical accounts exactly. On the first night
after any import, every imported account is updated (and `touch_updated_at` bumps `updated_at`),
so a naive "edited" test (`updated_at > created_at`) permanently blocks rollback for the whole
batch. "Edited" must be defined against a signal the maintenance job does not touch, or the job
must exclude rows whose `import_batch_id` is within the rollback window.

### H-10 — `selection → negotiation` is permitted by §9.2 but rejected by the §5.7 constraint
**Sections:** §9.1, §9.2, §5.7**Type:** contradiction
The transition matrix allows `selection → negotiation`, and §9.1 lists **no** entry requirement
for `negotiation`. But `quoted_requires_quotation` covers `('quoted','negotiation','verbal_confirmation')`,
so entering `negotiation` requires `quotation_ref`, `quoted_value` **and** `quotation_date`.
A user following a legal path from `selection` hits a check-constraint violation the UI has no
field for. §9.3's side-effects table only lists quotation requirements under `quoted`. Either the
matrix entry goes, the constraint narrows to `quoted`, or the negotiation modal must collect
quotation fields — three materially different products.

### H-11 — `reopenOpportunity()` from `won` contradicts `won → (none)`
**Sections:** §9.2, §16.1, §5.7, §8.7**Type:** contradiction / ambiguity
§9.2 states `won → (none)` and simultaneously that "a mistaken win is corrected by MANAGER/OWNER
through `reopenOpportunity()`". The matrix's `lost → new, qualified [reopen only]` row covers
reopening a loss but not a win. Unspecified in both cases: the **target stage**, and whether the
service clears `final_order_value` / `closed_at` / `lost_reason` / `lost_detail` (the check
constraints permit them to persist on a non-terminal row, so a reopened opportunity can carry a
stale `final_order_value` straight into the Won Value metric via a later re-win), and whether
`accounts.status` reverts from `ACTIVE`.

### H-12 — four RLS helper functions referenced by §15.5 and §15.6 are never defined
**Sections:** §15.1, §15.5, §15.6**Type:** missing dependency
§15.5 describes policies in prose that need visibility predicates the spec never writes:
`contacts` SELECT ("contact of an account the caller can see"), `project_stakeholders`
("caller can see the parent project"), `activities` ("caller can see the parent account"),
`opportunity_events` ("caller can see the parent opportunity"). §15.6 needs the same for Storage
paths, keyed by `{entity_type}/{entity_id}`. §15.1 defines only `user_role`,
`is_manager_or_above`, `is_owner_or_admin`, `owns_opportunity_on_account`,
`owns_opportunity_on_project`. Four more `SECURITY DEFINER` helpers are required
(`can_see_account`, `can_see_project`, `can_see_opportunity`, `can_see_activity`), and they must
be `SECURITY DEFINER` specifically to avoid re-entering the policies they support.

### H-13 — "View audit trail — MANAGER (own team)" is not expressible and has no screen
**Sections:** §3.1, §12.2, §5.9**Type:** missing dependency / ambiguity
§3.1 grants "View audit trail" to MANAGER scoped to "own team". There is no team model: `users`
has `role`, `is_active` and `branch`, but no `team_id` or `manager_id`, and §1.3 describes a
single manager. There is also **no audit route in §12.2** — no `/audit`, and no audit tab in the
route map — so the capability has no surface. Either "own team" means "everyone" for the single
manager, or `branch` is the team proxy (which would also need RLS), and the trail is shown
inline on the opportunity detail page (§12.2 lists "timeline" there, which §10.1 defines as
`activities`, not events).

---

## MEDIUM

| ID | Finding | Sections | Type |
|---|---|---|---|
| **M-01** | `/` redirects "others → `/dashboard`", but ADMIN is denied `/dashboard` (§12.2 roles: MANAGER, OWNER) and §3.1 denies ADMIN dashboards. ADMIN lands on a forbidden route at login. Needs an ADMIN landing route (`/settings`?). | §12.2, §3.1 | contradiction |
| **M-02** | MANAGER has "Export CSV ✔" (§3.1) but export is specified only on `/settings` (§21.4), which MANAGER cannot access (§12.2). ADMIN can reach `/settings` but has "Export CSV ✘". Both roles are wrong by one. | §3.1, §12.2, §21.4 | contradiction |
| **M-03** | Unauthorised record access: §12.6 specifies a **Forbidden** state ("You don't have access to this record") while §23.1 and §19.3 scenario 9 require **not-found**. "Never confirm existence" argues for 404; the Forbidden copy contradicts it. Pick one — it is directly tested. | §12.6, §23.1, §19.3 | contradiction |
| **M-04** | §11.1 marks `next_action_date*` and `next_action type*` **required** in the primary create flow, contradicting §8.3 and §25.3 ("strongly prompted, not enforced… blocking produces fabricated dates"). | §11.1, §8.3, §25 | contradiction |
| **M-05** | `accounts` has **no** database constraint requiring phone or email, though §11.1 and §20.3 both require one and `contacts` has `contact_reachable`. §5.7's "the database enforces the business rules" does not hold here. | §5.3, §5.4, §11.1, §20.3 | gap |
| **M-06** | §8.8: "Archiving an account does **not** cascade-archive its opportunities — the service layer archives children explicitly and reports what it will archive before doing so." The two halves contradict each other. Is the child archive automatic-after-preview, or opt-in? | §8.8 | ambiguity |
| **M-07** | `v_opportunity_flags` booleans are **NULL, not false**, when `next_action_date is null` (`true and null → null`). `is_overdue`/`is_due_today` must be typed `boolean \| null`, and any `count(*) filter (where not is_overdue)` will silently under-count. Use `coalesce(…, false)` or `is not true`. | §10.3 | correctness |
| **M-08** | §5.0 says "**every** table has `id`, `created_at`, `updated_at`, `created_by`" and archivable tables add `archived_at`/`archived_by`. The actual DDL contradicts this for `system_settings` (text PK, no `created_at`/`created_by`), `project_stakeholders` (no `updated_at`), `opportunity_events` (no `updated_at`/`created_by`), `import_rows` (no `updated_at`/`created_by`). The DDL is taken as authoritative. | §5.0 vs §5.6, §5.9, §5.10, §5.11 | contradiction |
| **M-09** | `setPrimaryStakeholder()` against the **non-deferrable** partial unique index `one_primary_per_project`: a single `update … set is_primary = (id = $2)` can transiently violate the index depending on row order. Must be two statements in one transaction (clear, then set), which is not stated. | §16.1, §5.6 | implementation trap |
| **M-10** | `dormancy_days` drives two different things: `accounts.status = 'DORMANT'` (§14.6) and the opportunity **Dormant** exception (§13.1). One key, two business meanings, one value. | §13.1, §14.6, §5.10 | ambiguity |
| **M-11** | Routes missing from §12.2 that flows require: `/opportunities/new` (§12.3 `+` sheet), `/contacts/new` (§11.4 inline creation), `/projects/:id/edit`, `/opportunities/:id/edit`, `/accounts/:id` tab routes (§12.4 shows five tabs). Modal-vs-route is unspecified, which affects deep-linking and E2E scenario URLs. | §12.2, §12.3, §11.3, §11.4, §12.4 | gap |
| **M-12** | "Rate-limit login attempts" (§15.8) with Redis and queues rejected (§17.1) and a serverless host with no shared memory. Supabase Auth's built-in rate limits may satisfy this, but that must be stated — otherwise it is an unimplementable requirement. | §15.8, §17.1 | ambiguity |
| **M-13** | `date-fns` alone cannot convert UTC→`Asia/Kolkata`; that requires `date-fns-tz` (a separate package, not in the frozen §17.1 stack) or `Intl.DateTimeFormat` with `timeZone`. Needs an approved choice, per `CLAUDE.md` §16. | §17.1, §8.11 | missing dependency |
| **M-14** | Magic-byte MIME verification (§15.6, and §19.4's disguised-executable test) needs a sniffing implementation — a package (`file-type`) or a hand-rolled signature check. Not in the frozen stack. | §15.6, §17.1, §19.4 | missing dependency |
| **M-15** | §13.2 says `/today` tiles are "scoped to `owner_id = current user` **by RLS**". True only for SALESPERSON; `/today` is available to all roles (§12.2) and MANAGER/OWNER/ADMIN pass `is_manager_or_above()`, so their `/today` would show the whole company. The queries must filter by owner explicitly. | §13.2, §15.5, §12.2 | RLS risk |
| **M-16** | §23.1 "Salesperson sees only **their own** accounts in list, search and counts" understates §3.2/§15.4, which also grant read access to accounts where the salesperson owns an opportunity. The acceptance test as written would fail correct behaviour. | §23.1, §3.2, §15.4 | contradiction |
| **M-17** | §21.2 names both `supabase db push` (dev) and `supabase migration up` (pipeline). The production command needs pinning (`supabase db push --linked` vs `migration up --linked`), along with whether the pipeline uses `DATABASE_URL` or a Supabase access token. | §21.2, §17.4 | ambiguity |
| **M-18** | §23.6 gates on "tiles render under 400 ms with **20,000 opportunities** seeded", but the only seed specified is `017_seed` "sample data (dev only)". No performance fixture, no generator, no measurement method (server-side query time vs TTFB vs LCP). | §23.6, §5.12, §12.8 | testing gap |
| **M-19** | The work-context RLS helpers (`owns_opportunity_on_account`, `can_see_*`) are `EXISTS` subqueries evaluated **per candidate row**. On Supabase this is the standard RLS performance cliff; at 20,000 opportunities it will miss the §12.8 400 ms budget unless each call is wrapped as `(select public.fn(...))` to force a cached InitPlan and the supporting indexes exist. Not mentioned in the spec. | §15.1, §12.8, §23.6 | performance risk |
| **M-20** | §19.2 requires integration tests against `supabase start` (Docker). No CI runner, database-reset strategy, per-role test credentials, or parallelism policy is specified — and these are called "the most important tests in the project". | §19.2, §21 | testing gap |
| **M-21** | §21.4 requires "a weekly `pg_dump` to storage **the business controls independently of Supabase**". No destination, credentials, scheduler or retention is specified, and Vercel Cron cannot run `pg_dump`. Needs infrastructure not in the stack (a GitHub Action + an object store). | §21.4, §17.1 | deployment risk |
| **M-22** | `import_rows.duplicate_of uuid` has no FK and no entity-type discriminator — it may point at an account or a contact depending on `import_batches.entity`. Referential integrity is unenforced by design; note it, or add the discriminator. | §5.11, §20.4 | gap |
| **M-23** | `opportunity_stage` values are **lowercase** (`'new'`, `'won'`) while every other enum is UPPERCASE. This is a genuine typo hazard across ~40 call sites (`'WON'` fails at runtime, not at compile time, if strings are used). Must be preserved exactly and surfaced through generated types, never string literals. | §5.1 | hazard |
| **M-24** | `opportunity_event_type` includes `ARCHIVED` and `RESTORED`, but the §5.9 trigger emits only `CREATED`/`STAGE_CHANGED`/`OWNER_CHANGED`/`WON`/`LOST`. No writer is specified for `ARCHIVED`, `RESTORED` or `REOPENED` — and per B-01 the service layer cannot insert events at all. | §5.1, §5.9, §15.5 | gap |
| **M-25** | §3.2: deactivating a user "blocks login". An **existing** session keeps working until its JWT expires — though `user_role()` returns null for `is_active = false`, which denies every policy, so the practical effect is a broken-looking app rather than a clean sign-out. Session-revocation behaviour on deactivation should be stated (§19.4 tests "session expiry handling"). | §3.2, §15.1, §19.4 | risk |
| **M-26** | `owner_summary_schedule` is a **settings** value (§5.10, TODO-BD-05) but Vercel Cron schedules are **static in `vercel.json`** and require a redeploy to change. The spec's "Cron, per `system_settings.owner_summary_schedule`" is not directly implementable. The mechanism must be an hourly trigger with an in-route gate that reads the setting — which preserves the TODO-BD rule but is not what §14.5 says. | §14.5, §5.10, §17.1 | deployment risk |
| **M-27** | Vercel Cron: hourly schedules and >2 jobs require a **Pro** plan (Hobby allows 2 daily jobs); the spec needs 5 routes including an hourly one. Cron expressions are **UTC**, so 08:30/09:00/19:00/02:00 IST become 03:00/03:30/13:30/20:30 UTC (the 02:00 IST job crosses the date line to the previous UTC day). Neither the plan requirement nor the conversion is in the spec. | §14, §17.1, §21 | deployment risk |
| **M-28** | §17.4's env list is incomplete for what §14/§19/§21 require: a Resend **verified sender domain / from-address**, CI credentials for `supabase` CLI migrations, Playwright base URL and per-role test-user credentials, and a staging Supabase project's keys. `.env.example` records the §17.4 list plus these as commented additions pending approval. | §17.4, §14, §19, §21 | missing environment |
| **M-29** | §17.3 says to "parse as **string** from Supabase", but PostgREST serialises `bigint` as a **JSON number**, so `supabase-js` already loses precision before application code runs. Values here (≤ ₹90,000 crore) are far below 2^53 so no data is at risk, but the stated mitigation does not do what it says without an explicit `::text` cast in the select or a custom fetch. | §17.3 | ambiguity |
| **M-30** | §18's "a feature folder must **never** import from another feature folder" needs enforcement (`eslint-plugin-import` / `import/no-restricted-paths` or Biome equivalent), which is not part of the frozen stack. Without a lint rule it is a convention that will be violated silently. | §18, §17.1 | tooling gap |

---

## Cross-cutting observations (not defects)

1. **The spec is unusually complete and internally disciplined.** §25 already resolves seven
   conflicts against earlier material and names four implementer risks — three of which
   (RLS recursion, `security_invoker`, circular FK) are correct and important, and the fourth
   (import suppressing notifications) is the right instinct but has no state to suppress with
   (B-05).
2. **The check-constraint backbone (§5.7) is the strongest part of the design** and should not
   be weakened when H-10 is resolved.
3. **Enum-vs-settings discipline is right**: values that code branches on are enums; values the
   business extends are `system_settings`. The `TODO-BD` mechanism follows from that correctly.
4. **The heaviest residual risk is RLS performance** (M-19) meeting the §12.8/§23.6 latency
   gates, because the work-context read grant makes `accounts` and `projects` policies
   subquery-bound. This should be measured in Phase 5, not discovered in Phase 20.

---

## Resolution log

| ID | Raised | Decision | Decided by | Date |
|---|---|---|---|---|
| *(all open — awaiting business/architecture review)* | 2026-08 | — | — | — |
