# Specification Audit — `CLAUDE_CODE_BUILD_SPEC.md`

**Audited:** complete document, §1–§25 (1,921 lines)
**Audit date:** August 2026
**Auditor:** Claude Code (lead architect role)
**Resolution date:** 2026-08-19 · **Decided by:** Project Owner
**Status:** **all 53 findings resolved.** **The specification itself has not been modified and never will be.**

This document records contradictions, missing dependencies, impossible requirements, ambiguities,
database dependency problems, authentication/RLS risks, missing environment requirements,
migration-order issues, testing gaps and deployment risks found in the specification.

**Every original finding below is preserved verbatim.** Resolutions are recorded beneath each one
and never replace it — the finding is the record of what was wrong, the resolution is the record of
what was decided.

> **Reading note.** Because finding text is frozen at audit time, it may describe states that have
> since been superseded — for example B-09 says "`CLAUDE.md` §7 records the carve-out pending
> approval" and M-28 says `.env.example` holds "commented additions pending approval". Both were
> true when written and are no longer: the carve-out is approved (ADR-005) and the variables are
> uncommented. **These are legitimate historical references, not contradictions.** The resolution
> block under each finding is always the current state.

Each resolution states its **type**:

- **Business decision** — the owner chose a value or a product position.
- **Architecture correction** — the spec's *intent* was sound and its *text* was defective; the
  implementation follows the intent. No ADR needed.
- **Architecture deviation** — the built system will differ from what the spec says. Carries an
  **ADR** in `/docs/DECISIONS.md` §B.

**Severity key** — BLOCKER: the spec as written cannot be implemented, or produces a security or
data-correctness defect. HIGH: implementable but the spec contradicts itself and the choice is
material. MEDIUM: ambiguity, gap or risk that needs a stated position before it bites.

---

## Summary

| Severity | Total | Resolved | Open |
|---|---|---|---|
| BLOCKER | 10 | **10** | 0 |
| HIGH | 13 | **13** | 0 |
| MEDIUM | 30 | **30** | 0 |
| **Total** | **53** | **53** | **0** |

Resolved across two decision passes, both dated 2026-08-19: the first closed 47 findings, the
second closed the remaining six (**H-13, M-02, M-05, M-06, M-11, M-12**) and the five follow-on
questions the first pass raised.

**All ten blockers are closed.** Every finding that affects migration design is resolved, with two
sub-questions flagged for confirmation before migration 010 is written (see **H-10** and the open
items table).

Twelve resolutions are **architecture corrections** (B-02, B-04, B-06, B-07, B-10, H-01, H-03,
H-04, H-05, H-06, H-09, H-12). Ten are **architecture deviations** carrying ADRs (B-01→ADR-001,
B-05→ADR-002, B-03→ADR-003, B-08→ADR-004, B-09→ADR-005, H-10→ADR-006, H-11→ADR-007,
H-02→ADR-008, H-07→ADR-009, H-08→ADR-012, M-05→ADR-013, plus M-10→ADR-010, M-26→ADR-011 and
the §14.6 failure state→ADR-014). Five are **product decisions** recorded as C-1 … C-5 in
`/docs/DECISIONS.md` §C (H-13, M-02, M-06, M-11, M-12).

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** Option (a). The service sets a transaction-local GUC,
> `set_config('app.event_reason', …, true)`, and `log_opportunity_event()` reads it when
> constructing the audit event. The append-only model is preserved: no INSERT policy, no UPDATE
> policy, no DELETE policy on `opportunity_events`.
> **Rationale.** It is the only option that keeps the trigger as the single writer, so §5.9's
> stated guarantee — "no path can bypass the audit" — survives intact. A narrow INSERT policy
> would let a caller forge events; moving everything into `SECURITY DEFINER` RPCs enlarges the
> privileged surface and still needs the trigger for out-of-band changes.
> **Type.** Architecture deviation — **ADR-001**.
> **Phases affected.** 6 (services), 11 (opportunities), 16 (archive/restore events).

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** Use the `SECURITY DEFINER` `reassign_opportunity` RPC. `owner_id` changes are
> denied in the table policy entirely. **The broken/recursive fallback SQL from §15.5 must never
> be copied into a migration.**
> **Rationale.** §15.5 itself states *"Prefer the RPC — it is easier to test and audit."* The
> implementation follows the spec's own stated preference; the alternative expression is provably
> non-functional. The RPC checks `can_reassign()` (see H-05), not `is_manager_or_above()`.
> **Type.** Architecture correction — the spec's intent is unchanged; its fallback text was
> defective. No ADR.
> **Phases affected.** 5 (RLS), 11 (opportunities).

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** Create **one dedicated system user** in `public.users`, seeded with a fixed uuid.
> All service-role automated writes record that row as `actor_id`. The trigger resolves
> `coalesce(auth.uid(), new.created_by, <system user uuid>)`. The system user is seeded
> `is_active = false` so it can never authenticate or pass a policy, and it is excluded from
> `/team`, workload reporting, user lists and every digest.
> **Rationale.** Keeps `actor_id not null`, which is what makes the audit trail trustworthy, and
> makes automated changes visibly attributable to the system rather than silently to a person.
> It is a `users` row, not a twelfth table.
> **Type.** Architecture deviation — **ADR-003**.
> **Phases affected.** 3 (migrations 003, 012, 017 seed), 15 (import), 18 (cron).

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** Split helper creation into dependency-safe migrations: **role helpers first**
> (`user_role`, `is_manager_or_above`, `is_owner_or_admin`, `can_reassign`), **context /
> work-visibility helpers after** the business tables they reference exist. **No SQL helper
> function may reference a table before that table exists.**
> **Rationale.** PostgreSQL validates `language sql` bodies at creation; the split is the only
> ordering that applies cleanly to an empty database, and it matches §22's own instruction that
> policies are written as each table is created.
> **Type.** Architecture correction. No ADR.
> **Phases affected.** 3 (migrations), 5 (RLS).

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** **No generic `notifications` table.** Per-opportunity SLA notification state is
> stored **on the opportunity record** as an explicit column — recorded name
> `sla_notified_at timestamptz`, null meaning not yet notified. The state must let the system
> determine whether the new-opportunity SLA notification has already been sent, and the
> notification is sent **no more than once per opportunity** for that SLA event.
> **Rationale.** It is the smallest change that fixes an unbounded-email defect: no new table, no
> new enum value, the eleven-table model intact, and the append-only audit trail unpolluted by
> system noise. Explicitly approved as an architectural deviation from §14.2's undeveloped
> "event metadata" concept.
> **Type.** Architecture deviation — **ADR-002**. Adds a column §5.7 does not list.
> **Phases affected.** 3 (migration 010), 18 (cron).
> **Also now covered.** §14.6's "job failed twice consecutively" state was left open by this
> resolution and is closed separately by **ADR-014**: `maintenance_consecutive_failures` and
> `maintenance_last_failure_at` in `system_settings`, updated after every run, alerting the OWNER
> at 2 and resetting on success. Still **no notifications table**.

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** Declare `normalize_phone()` **`IMMUTABLE`** and ensure its implementation is
> **genuinely deterministic** — regex/`translate` only, no locale- or configuration-dependent
> calls.
> **Rationale.** Without it the generated columns cannot be created at all. Determinism is not
> optional decoration: a stored generated column is not recomputed, so a non-deterministic body
> would silently produce inconsistent data across rows written at different times.
> **Type.** Architecture correction. No ADR.
> **Phases affected.** 3 (migrations 001, 005, 006), 6 (`lib/phone.ts` parity test).

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** Create `accounts` **without** the `referred_by_contact_id` foreign key in
> migration 005. Add the foreign key in the later migration (007) where `contacts` exists.
> **Rationale.** §5.12 already prescribes the three-step order for exactly this reason and §25
> names the circular FK as a known implementer risk; only the §5.3 DDL block is inconsistent
> with it. The intent is unchanged.
> **Type.** Architecture correction. No ADR.
> **Phases affected.** 3 (migrations 005, 007).

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** Allow deletion of the **`project_stakeholders` relationship row only**. This is
> an explicit exception to the no-DELETE rule because the row represents a **relationship/link**,
> not a business entity. **Deletion of accounts, contacts, projects, opportunities, activities,
> users, `opportunity_events`, `system_settings`, `import_batches` and `import_rows` remains
> forbidden for every role, including OWNER.** The DELETE policy is scoped identically to the
> table's UPDATE policy.
> **Rationale.** A link row carries no history, no ownership and no money; removing a
> wrongly-added person from a site is an ordinary correction. Adding `archived_at` instead would
> force all three partial unique indexes in §5.6 to be rewritten for a table with nothing worth
> preserving.
> **Type.** Architecture deviation — **ADR-004**. Recorded in `/docs/DECISIONS.md` as instructed.
> **Phases affected.** 5 (RLS), 10 (projects and stakeholders), 19 (the negative test must prove
> DELETE fails on every other table).

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** Approved as an explicit storage exception:
> **browser → signed upload URL → private Supabase Storage.** Database writes remain server-side.
> The signed URL must be **short-lived**, and authorization is based on **visibility of the parent
> entity**, checked server-side before the URL is issued. The carve-out applies to Storage object
> uploads only — **no other client-side Supabase write is permitted anywhere.**
> **Rationale.** There is no alternative: 10 MB exceeds the platform request-body limit, so
> lowering the cap would mean changing a stated product requirement to suit an implementation
> constraint. Phone photos routinely exceed 4.5 MB.
> **Type.** Architecture deviation — **ADR-005**.
> **Phases affected.** 12 (site-visit activity), 17 (storage).

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** All business-day calculations use **explicit `Asia/Kolkata` conversion**.
> **Bare PostgreSQL `current_date` must not be used for business-day logic.** Use
> `(now() at time zone 'Asia/Kolkata')::date` and the equivalent conversion for UTC timestamps.
> **SQL and TypeScript date helpers must be behaviourally identical**, with boundary tests.
> **Rationale.** §8.11 already defines the business day as Asia/Kolkata; the spec's SQL simply
> did not implement it. Without this, every accountability metric is a day stale for 5.5 hours
> daily, and §19.1's own required test would fail against the spec's own view definition.
> **Type.** Architecture correction. No ADR — the intent was always IST.
> **Phases affected.** 3 (flags view), 6 (`lib/dates.ts`), 12 (`/today`), 14 (dashboards),
> 18 (cron, including ADR-011's hour gate).

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** `stage_changed_at` is maintained **automatically whenever the stage changes**,
> by the **database trigger**, so the invariant cannot be bypassed.
> **Rationale.** A service rule can be bypassed by any other write path; the trigger cannot.
> `days_in_stage` and the Stalled tile are only meaningful if the column is always correct.
> **Type.** Architecture correction. No ADR.
> **Phases affected.** 3 (migration 012), 14 (Stalled tile).

### H-02 — `mergeAccounts` is specified as reversible but nothing records the merge
**Sections:** §8.9, §16.1, §4.1, §23.7**Type:** impossible requirement
§8.9: merging is "always reversible via the audit trail". §23.7 requires the merge to be
"recorded in the audit trail". The only audit table is `opportunity_events`, which is scoped to a
single opportunity and has no `ACCOUNT_MERGED` event type; `accounts`, `contacts` and `projects`
have no event table at all, and §4.1 caps the model at eleven tables. After a merge, nothing
records which contacts/projects/opportunities were moved from the merged account, so the
operation cannot be reversed. Needs a decision: partial reversibility recorded per-opportunity in
`opportunity_events.metadata`, a twelfth table, or dropping the reversibility claim.

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** **No twelfth table.** V1 account merge is **not guaranteed to be reversible**.
> The merge flow must show a complete **preview**, require **explicit confirmation**, record the
> source/target accounts and affected relationships in the available audit metadata, and
> **clearly warn that the merge is irreversible in V1**. **Do not claim "always reversible via
> the audit trail"** anywhere, because the implementation cannot provide that guarantee.
> **Rationale.** Honesty over a claim the system cannot honour. Reversibility would cost a
> twelfth table for a rare admin operation, breaking §4.1.
> **Type.** Architecture deviation — **ADR-008**. §8.9's reversibility sentence is a known,
> accepted documentation deviation.
> **Phases affected.** 16 (archive and merge). §23.7's merge acceptance criterion is interpreted
> as partial (per-opportunity) audit recording.

### H-03 — §22's phase→migration mapping contradicts §5.12's ordering
**Sections:** §22, §5.12**Type:** migration-order defect
Three conflicts: (a) `013_system_settings` is assigned to **Phase 7**, but `stage_probabilities`
is required for Weighted Pipeline (Phase 6 / §13), and `dormancy_days` + `stage_stall_days` are
required for the flags and exception lists (Phase 5 / §13.1); (b) `012_opportunity_events` is
assigned to Phase 4 while `011_activities` is assigned to Phase 5, but migrations apply in
numeric order, so 011 must be applied to reach 012; (c) `004 (extend)` in Phase 7 conflicts with
"never edit a migration that has been applied" (§21.2) — an extension must be a new numbered file.

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** Correct the migration ordering. **`system_settings` must exist before the
> services that depend on it.** Migration phases must not be assigned in a way that contradicts
> numeric migration ordering. **Never modify an already-applied migration** — an extension is
> always a new numbered file.
> **Rationale.** Migrations apply in numeric order; a phase plan that contradicts that order
> cannot be executed. §21.2 already forbids editing applied migrations.
> **Type.** Architecture correction. No ADR.
> **Phases affected.** 3 (migration sequence), 12, 14 (settings consumers), 15 (import extension
> becomes a new file, not an edit to 004).

### H-04 — RLS is enabled only in migration 015, in Phase 8
**Sections:** §22, §5.12, §15**Type:** authentication/RLS risk
`015_rls_policies` ("enable RLS + all policies") is a single file scheduled for Phase 8, yet §22
also says "RLS policies are written **as each table is created** (phases 2–5). Do not defer all
security to phase 8." Both cannot be true of one migration file. If 015 is the only place RLS is
enabled, then throughout Phases 2–7 **every authenticated user can read and write every row**
via the anon key and PostgREST — and any staging deployment in that window is fully exposed.
Policies must be created per table in the table's own migration; 015 becomes an audit/hardening
migration.

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** **Enable RLS in each table's own creation migration**, with that table's
> policies. **Migration 015 is an audit/hardening migration, not the first time RLS is enabled.**
> **Rationale.** §22 already instructs that policies are written as each table is created and
> explicitly says not to defer all security to phase 8. The single-file reading would leave every
> intermediate environment fully readable and writable by any authenticated user.
> **Type.** Architecture correction. No ADR.
> **Phases affected.** 3 (every table migration), 5 (RLS), 19 (015 hardening audit).

### H-05 — `is_manager_or_above()` grants ADMIN the reassignment rights §3.1 denies
**Sections:** §3.1, §15.1, §15.4, §15.5**Type:** contradiction / permission defect
§3.1 gives ADMIN "See all records ✔", "Edit any record ✔", but "**Assign / reassign ownership ✘**".
Every write policy in §15 gates on `is_manager_or_above()`, which is defined as
`MANAGER, OWNER, ADMIN`. As written, ADMIN can change `owner_id` on accounts, projects and
opportunities. A distinct helper — `can_reassign()` = `MANAGER, OWNER` — is required, and the
`reassign_opportunity` RPC must use it.

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** Create a dedicated capability check **`can_reassign() = MANAGER or OWNER`**.
> **ADMIN must not be allowed to reassign ownership**, on any table, by any route.
> **Rationale.** §3.1 is explicit that ADMIN is a system/data role without reassignment rights;
> `is_manager_or_above()` is simply the wrong helper for that gate.
> **Type.** Architecture correction. No ADR.
> **Phases affected.** 5 (RLS helpers and policies), 11 (`reassign_opportunity`, `bulk_reassign`),
> 19 (negative test: ADMIN reassignment rejected).

### H-06 — `users_admin_all … for all` grants DELETE on `users`
**Sections:** §15.3, §3.1, §15.2**Type:** contradiction / RLS risk
`create policy users_admin_all on public.users for all …` includes `DELETE`. §3.1 gives
"Hard delete anything" to nobody, and §15.2 says no DELETE policy on any business table. Deleting
a `users` row would also break `activities.performed_by` and `opportunity_events.actor_id`
(both `not null` FKs, no `on delete` clause → the delete would fail anyway, noisily). The policy
should be `for select`, `for insert`, `for update` — enumerated, not `for all`.

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** **Remove the `FOR ALL` users policy.** Define the permitted SELECT / INSERT /
> UPDATE operations explicitly. **No DELETE policy anywhere** — the single exception in the whole
> schema is `project_stakeholders` per ADR-004.
> **Rationale.** `FOR ALL` silently includes DELETE, contradicting §3.1's "hard delete: nobody".
> Enumerating the operations makes the grant auditable.
> **Type.** Architecture correction. No ADR.
> **Phases affected.** 3 (migration 003), 5 (RLS), 19 (no-DELETE test covers `users`).

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** The explicitly authorized **user-provisioning Server Action may use the
> service-role client, but only after a server-side OWNER/ADMIN authorization check**. The
> service-role key **must never be available to the browser**.
> **Rationale.** §12.2 puts user management inside the app at `/settings/users`, so a third
> permitted caller is required. Ordering matters: the authorization check runs *before* the admin
> client is touched, or the action is a privilege-escalation hole.
> **Type.** Architecture deviation — **ADR-009**. §15.7's permitted-caller list becomes three.
> **Phases affected.** 4 (auth and users), 19 (negative test: salesperson calling the
> provisioning action is rejected before any admin call). `handle_new_auth_user()` is defined in
> Phase 4: `role` defaults to `SALESPERSON`, `branch` to `'MAIN'`, `full_name` from the payload.

### H-08 — "one transaction per batch" and "progress reported per 100 rows" are mutually exclusive
**Sections:** §20.5, §16.3, §21**Type:** impossible requirement / deployment risk
A single database transaction is invisible to any other session until it commits, so progress
written inside it cannot be read by a polling client. Additionally, 5,000 rows of insert +
duplicate analysis in one serverless invocation risks the platform's function timeout (60 s
default on Vercel Pro, 300 s maximum), and a failure at row 4,900 discards ~5 minutes of work.
Needs a position: keep the atomic guarantee and drop live progress (report only on completion),
or chunk into per-N-row transactions and rely on §20.6 rollback for compensation — the latter
weakens "any unhandled error rolls the whole batch back".

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** **Preserve import atomicity.** Drop the requirement for live per-100-row
> progress reporting. Progress may be reported when the atomic transaction completes.
> **Rationale.** §20.5's "any unhandled error rolls the whole batch back" is the guarantee that
> protects data integrity; live progress is cosmetic by comparison and cannot coexist with it.
> **Type.** Architecture deviation — **ADR-012**.
> **Phases affected.** 15 (import). The UI shows a working state during execution and a full
> result summary on completion. The serverless timeout stays a real constraint at 5,000 rows.

### H-09 — the nightly maintenance job can silently disqualify an import rollback
**Sections:** §14.6, §20.6**Type:** interaction defect
§20.6 allows rollback within 7 days "**only if no imported record has been edited since import**".
§14.6 runs nightly and sets `accounts.status = 'DORMANT'` where there has been no activity beyond
the threshold — which describes freshly imported historical accounts exactly. On the first night
after any import, every imported account is updated (and `touch_updated_at` bumps `updated_at`),
so a naive "edited" test (`updated_at > created_at`) permanently blocks rollback for the whole
batch. "Edited" must be defined against a signal the maintenance job does not touch, or the job
must exclude rows whose `import_batch_id` is within the rollback window.

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** The 7-day import rollback eligibility **must not be invalidated by nightly
> maintenance**. Maintenance operations must not cause an imported record to appear user-edited
> for rollback purposes. **Preferred mechanism:** exclude records still inside the rollback window
> from the maintenance update; otherwise use a maintenance-safe edit signal.
> **Rationale.** §20.6's rollback is the safety net for a 5,000-row import; a background job
> silently removing it is the worst kind of failure — invisible until it is needed.
> **Type.** Architecture correction. No ADR.
> **Phases affected.** 15 (rollback eligibility test), 18 (maintenance job filter). An integration
> test must import a batch, run maintenance, and prove rollback is still permitted.

### H-10 — `selection → negotiation` is permitted by §9.2 but rejected by the §5.7 constraint
**Sections:** §9.1, §9.2, §5.7**Type:** contradiction
The transition matrix allows `selection → negotiation`, and §9.1 lists **no** entry requirement
for `negotiation`. But `quoted_requires_quotation` covers `('quoted','negotiation','verbal_confirmation')`,
so entering `negotiation` requires `quotation_ref`, `quoted_value` **and** `quotation_date`.
A user following a legal path from `selection` hits a check-constraint violation the UI has no
field for. §9.3's side-effects table only lists quotation requirements under `quoted`. Either the
matrix entry goes, the constraint narrows to `quoted`, or the negotiation modal must collect
quotation fields — three materially different products.

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** **Keep `selection → negotiation` as a valid transition.** Quotation-required
> constraints apply to **`quoted`**, and are **not** applied automatically to `negotiation`.
> **Do not force salespeople to invent quotation data merely to enter negotiation.**
> **Rationale.** Fabricated quotation references are worse than a missing one — the same
> reasoning §25.3 applies to fabricated next-action dates. §9.3's side-effects table already
> listed quotation requirements under `quoted` alone.
> **Type.** Architecture deviation — **ADR-006**. Narrows a §5.7 check constraint.
> **Phases affected.** 3 (migration 010), 11 (stage modal).
> **⚠ Sub-question flagged for confirmation before migration 010 is written.** The approved text
> names `quoted`. `verbal_confirmation` was in the original constraint and was not named. Because
> `verbal_confirmation` is reachable from `negotiation`, leaving it in would recreate the
> identical trap one stage later, so the recorded resolution narrows the constraint to
> `stage <> 'quoted' or (…)`. **Confirm this reading.** See the open items table.

### H-11 — `reopenOpportunity()` from `won` contradicts `won → (none)`
**Sections:** §9.2, §16.1, §5.7, §8.7**Type:** contradiction / ambiguity
§9.2 states `won → (none)` and simultaneously that "a mistaken win is corrected by MANAGER/OWNER
through `reopenOpportunity()`". The matrix's `lost → new, qualified [reopen only]` row covers
reopening a loss but not a win. Unspecified in both cases: the **target stage**, and whether the
service clears `final_order_value` / `closed_at` / `lost_reason` / `lost_detail` (the check
constraints permit them to persist on a non-terminal row, so a reopened opportunity can carry a
stale `final_order_value` straight into the Won Value metric via a later re-win), and whether
`accounts.status` reverts from `ACTIVE`.

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** A WON opportunity may be reopened **only** through the approved MANAGER/OWNER
> workflow. Reopen behaviour: **`won → qualified`**. **Clear `final_order_value` and `closed_at`.**
> **Do not leave stale final-order values capable of contaminating later reporting.** The
> historical audit event showing the opportunity had previously been won is **preserved**.
> **Rationale.** A stale `final_order_value` would re-enter Won Value on any later re-win — a
> silent reporting corruption. Preserving the `WON` event honours §9.2's rule that historical
> stage changes are never deleted or rewritten.
> **Type.** Architecture deviation — **ADR-007**. Adds `won → qualified` to the §9.2 matrix.
> **Phases affected.** 6 (transition matrix), 11 (reopen workflow), 14 (Won Value integrity test).
> **⚠ Sub-question flagged.** Whether `accounts.status` reverts from `ACTIVE` is not specified.
> Reverting blindly is wrong when the account has other won opportunities. See open items.

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

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** Define all required context-visibility helper functions and implement them as
> **`SECURITY DEFINER`** helpers using a **safe search path** and **least privilege**
> (`revoke execute from anon`, `grant execute to authenticated`).
> **Rationale.** The policies §15.5 and §15.6 describe in prose cannot be written without them,
> and they must be `SECURITY DEFINER` specifically so they do not re-enter the policies they
> support. `set search_path = public` prevents search-path hijacking of a definer function.
> **Type.** Architecture correction. No ADR.
> **Phases affected.** 5 (RLS helpers), 9 (contacts), 10 (stakeholders), 12 (activities),
> 17 (Storage path policies). Created after their referenced tables exist (B-04).

### H-13 — "View audit trail — MANAGER (own team)" is not expressible and has no screen
**Sections:** §3.1, §12.2, §5.9**Type:** missing dependency / ambiguity
§3.1 grants "View audit trail" to MANAGER scoped to "own team". There is no team model: `users`
has `role`, `is_active` and `branch`, but no `team_id` or `manager_id`, and §1.3 describes a
single manager. There is also **no audit route in §12.2** — no `/audit`, and no audit tab in the
route map — so the capability has no surface. Either "own team" means "everyone" for the single
manager, or `branch` is the team proxy (which would also need RLS), and the trail is shown
inline on the opportunity detail page (§12.2 lists "timeline" there, which §10.1 defines as
`activities`, not events).

> ### ✅ RESOLVED — 2026-08-19 · Project Owner
> **Resolution.** **V1 has one manager**, so "own team" is interpreted as **the salespeople
> operating under the current single-manager structure**. **Do not add `team_id` or
> `manager_id`** — no team model enters the schema. The audit trail is exposed **through the
> opportunity detail timeline**, where **audit events must be visually and semantically
> distinguishable from normal activities**. **No separate `/audit` route in V1.**
> **Rationale.** The capability was unimplementable only because it presumed a team model the
> business does not have. With one manager the scope question is moot, and §12.2 already places a
> timeline on the opportunity detail page — the trail needs a surface, not a route. Keeping events
> visually distinct honours §10.1: activities are what the salesperson did with the customer,
> events are what the system recorded about the record, and they must not be merged.
> **Type.** Business decision — **`/docs/DECISIONS.md` C-1**.
> **Phases affected.** 11 (opportunity detail timeline), 14 (`/team`). No schema change; no policy
> change — `opportunity_events` SELECT is already gated on `can_see_opportunity()`, which yields
> exactly this scope.
> **Note.** If a second manager is ever hired, "own team" becomes a real question again and needs
> a team model — a V2 decision.

---

## MEDIUM

Original findings, unchanged:

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

### MEDIUM resolutions — 2026-08-19 · Project Owner

| ID | Resolution | Rationale | Type | Phase |
|---|---|---|---|---|
| **M-01** | ADMIN's landing route is **`/settings`**. | §3.2: ADMIN is a system/data role with no dashboards. `/settings` is the only route it both owns and can reach. | Business decision | 4 |
| **M-02** | **Manager CSV export is available directly from the manager-accessible list and report screens** (`/opportunities`, `/accounts`, `/projects`, `/team`, `/reports`), exporting the current filtered view — **not only under `/settings`**. OWNER keeps the §21.4 `/settings` bulk export as well. **The ADMIN export restriction is preserved**: the control is not rendered for ADMIN and the Server Action rejects ADMIN. | §3.1 grants MANAGER export; §21.4 only ever described OWNER's surface. Export becomes a capability check applied at the action, not a property of a route — and a hidden button is not a control (§19.4). | Business decision — **C-2** | 14, 20 |
| **M-03** | Unauthorised record access returns **404 / not-found**. | §12.6's own rule is "never confirm existence"; §23.1 and §19.3 scenario 9 both test for not-found. The Forbidden copy is the outlier. | Business decision | 7, then every detail route |
| **M-04** | **Resolved by the specification itself.** §25 is binding and §25.3 states: *"Mandatory next action… Resolution: strongly prompted, not enforced."* §11.1's asterisks are stale relative to §25.3. Next action is **never hard-blocking**. | §25 is the consistency audit and declares its findings binding; no owner decision was needed. | Architecture correction | 8, 12 |
| **M-05** | **Add a database-level check on `accounts`: `phone is not null or email is not null`** (constraint `account_reachable`). An account must have at least one contact method. Service and UI validation still provide the friendly message, but **database integrity is authoritative**. | §5.7's principle — a service-layer bug must not be able to create invalid data — did not hold for the most important table in the system, while `contacts` already enforced exactly this rule. The constraint strengthens the schema rather than weakening it. | Architecture deviation — **ADR-013** | 3 (migration 005), 8, 15 |
| **M-06** | Archiving an account is a **four-step controlled operation**: preview the complete set of affected child records → clearly display what will be archived → require explicit confirmation → archive the account and its explicitly defined children **as one controlled operation**. **The preview is informational; individual child records do not require separate opt-ins. No hard delete.** | Reconciles §8.8's two halves: no *silent* cascade (the first half's concern), one *confirmed* operation (the second half's mechanism). Activities and opportunity events are history and are never archived, which is what preserves §8.8's "retain all relationships and activities". | Business decision — **C-3** | 16 |
| **M-07** | **Implementer-closable.** Use `coalesce(…, false)` in the view (or `is not true` at every call site) and type the columns accordingly, so a missing next action reads as *not overdue* rather than unknown. | A correctness detail inside the approved architecture; no business input needed. Recorded so it is not rediscovered. | Architecture correction | 3, 12, 14 |
| **M-08** | **Closed by documentation.** The per-table DDL in §5 is authoritative; §5.0's blanket sentence is descriptive, not normative. Recorded in `/docs/DATABASE.md`. | No table is changed; only the reading is fixed. | Architecture correction | 3 |
| **M-09** | **Implementer-closable.** `setPrimaryStakeholder` runs as **two statements in one transaction** — clear the existing primary, then set the new one. | The partial unique index is not deferrable, so a single statement can transiently violate it depending on row order. | Architecture correction | 10 |
| **M-10** | **Resolved by TODO-BD-03.** `dormancy_days` splits into `account_dormancy_days` and `opportunity_dormancy_days`, both seeded `30`. | One value cannot serve two business meanings that will not stay equal. | Business decision → **ADR-010** | 3, 12, 14, 18 |
| **M-11** | **Explicit routes**: `/opportunities/new`, `/contacts/new`, `/projects/:id/edit`, `/opportunities/:id/edit`. For **account tab navigation**, use the existing `/accounts/:id` route with **explicit URL/query state** (e.g. `?tab=projects`) rather than inventing nested routes. | Every creation and edit surface becomes deep-linkable and directly addressable by the Playwright suite. Query-state tabs reuse `FilterBar`'s existing "state in URL params" convention (§12.5), so the codebase has one pattern rather than two. §12.2's map is extended, never contradicted. | Product decision — **C-4** | 7, 8–11 |
| **M-12** | **Use Supabase Auth's built-in authentication rate limiting for V1. Do not add Redis or any other distributed rate-limiting infrastructure.** The application must surface throttling failures **without leaking implementation details**. **Automated tests cover rate-limit and error behaviour.** | Satisfies §15.8 without touching the frozen stack (§17.1 rejects Redis and queues, and a serverless host has no shared memory). Leaking the provider's raw error or a retry-after internal would tell an attacker which credential was wrong. | Architecture correction — **C-5** | 4, 19 |
| **M-13** | Use **`Intl.DateTimeFormat`** with `timeZone: 'Asia/Kolkata'` for timezone rendering. | No new dependency; the frozen stack stays frozen. | Architecture correction | 1, 6 |
| **M-14** | Use a **hand-rolled magic-byte signature check** for the four allowed types (JPEG, PNG, WebP, PDF). | Four signatures are a small, testable function; a package addition is not warranted. | Architecture correction | 1, 17 |
| **M-15** | `/today` queries **explicitly filter by the current owner** where required, rather than relying on RLS. | RLS scopes salespeople only; a manager's `/today` would otherwise show the whole company. | Architecture correction | 12, 14 |
| **M-16** | Correct the salesperson acceptance tests to reflect **opportunity-based work-context visibility**: own accounts *plus* accounts where the salesperson owns an opportunity. | §23.1 as written would fail correct behaviour. | Architecture correction | 5, 8, 19 |
| **M-17** | **Pin the production migration command** and the required CI credentials in `/docs/DEPLOYMENT.md`. | An unpinned deploy command is an incident waiting for its first hotfix. | Architecture correction | 21 |
| **M-18** | **Add an actual 20,000-opportunity performance fixture**, separate from `dev-fixtures.sql`. | §23.6's gate is unverifiable without it. | Architecture correction | 14, 19 |
| **M-19** | Wrap RLS helper calls as **`(select public.function(...))`** where appropriate, for InitPlan caching. | The standard Supabase RLS performance pattern; the difference between meeting and missing the §12.8 400 ms budget. | Architecture correction | 5, 14, 20 |
| **M-20** | **Define the Supabase/Docker CI testing strategy** — runner, reset strategy, per-role credentials, parallelism. | §19.2 calls these the most important tests in the project; they must run on every commit. | Architecture correction | 19 |
| **M-21** | **Keep the independent backup requirement**, and **document the external backup infrastructure** needed to satisfy it. | §21.4 requires recovery without vendor cooperation; that cannot be dropped for convenience. Destination and credentials remain open. | Architecture correction (partial) | 21 |
| **M-22** | **Implementer-closable.** `duplicate_of` stays polymorphic with no FK; the entity type is read from `import_batches.entity`. Documented, not changed. | Adding a discriminator changes a spec'd table for a staging record with a 7-day life. | Architecture correction | 15 |
| **M-23** | **Preserve lowercase `opportunity_stage` values exactly** as defined and rely on **generated types**, never handwritten string literals. | A `'WON'` typo fails at runtime, not compile time. Generated types make it a compile error. | Architecture correction | 3, 6, 11 |
| **M-24** | **Define event writers for archive / restore / reopen** behaviour, using the ADR-001 GUC mechanism so the trigger remains the single writer. | Enum values with no writer are dead; the audit trail must record archive, restore and reopen. | Architecture correction | 11, 16 |
| **M-25** | **Document session behaviour on user deactivation** — `user_role()` returns null immediately so every policy denies, while the JWT itself remains valid until expiry. | §19.4 tests session expiry; the expected behaviour must be written down before it is asserted. | Architecture correction | 4, 19 |
| **M-26** | Use the **hourly-gate mechanism** for the settings-driven owner summary. | Vercel Cron is static; the gate keeps the value in `system_settings` where §24 requires it. | Architecture deviation → **ADR-011** | 18 |
| **M-27** | Treat Vercel hourly Cron as **requiring a plan that supports hourly Cron execution**. Convert all IST schedules to UTC in `vercel.json`. | Five routes including an hourly one exceed the Hobby plan; cron expressions are UTC. | Architecture correction | 21 |
| **M-28** | **Add the required Resend sender configuration and the CI/staging environment variables** to `.env.example` and `/docs/SETUP.md`. | No email sends without a verified sender; no pipeline migration runs without CLI credentials. | Architecture correction | 1, 19, 21 |
| **M-29** | **Implementer-closable.** Values are far below 2^53 so no data is at risk; where an explicit string is wanted, cast in the select rather than relying on §17.3's wording. `lib/money.ts` remains the only conversion point and **never `parseFloat`s a rupee string**. | The stated mitigation does not do what it says, but the risk it guards against does not exist at this scale. | Architecture correction | 6 |
| **M-30** | **Enforce the cross-feature import rule through linting.** | Without a rule §18's boundary is a convention that will be violated silently. | Architecture correction (approved dependency, see ADR-000) | 1 |

---

## Cross-cutting observations (not defects)

1. **The spec is unusually complete and internally disciplined.** §25 already resolves seven
   conflicts against earlier material and names four implementer risks — three of which
   (RLS recursion, `security_invoker`, circular FK) are correct and important, and the fourth
   (import suppressing notifications) is the right instinct but has no state to suppress with
   (B-05). *Post-resolution note: §25 also silently resolved M-04, which no decision was needed
   for — §25 declares its findings binding.*
2. **The check-constraint backbone (§5.7) is the strongest part of the design** and should not
   be weakened when H-10 is resolved. *Post-resolution note: exactly one constraint was narrowed
   (ADR-006), and only because it contradicted the transition matrix. The other nine stand.*
3. **Enum-vs-settings discipline is right**: values that code branches on are enums; values the
   business extends are `system_settings`. The `TODO-BD` mechanism follows from that correctly.
   *Post-resolution note: resolving a `TODO-BD` fixes the value, not the mechanism — approved
   values still live in `system_settings` and are still read only through `settings.service.ts`.*
4. **The heaviest residual risk is RLS performance** (M-19) meeting the §12.8/§23.6 latency
   gates, because the work-context read grant makes `accounts` and `projects` policies
   subquery-bound. This should be measured in Phase 5, not discovered in Phase 20.

---

## Open items — none

All six findings that survived the first decision pass are closed above, and the five follow-on
questions those resolutions raised are answered:

| Follow-on | Answer | Recorded in |
|---|---|---|
| **H-10 sub** — does `verbal_confirmation` drop out of `quoted_requires_quotation`? | **Yes.** Quotation fields are required **only when entering `quoted`** — not for `negotiation`, not for `verbal_confirmation`. The constraint narrows to `stage <> 'quoted' or (…)`. An integration regression test must prove **`selection → negotiation` succeeds with no quotation information**. | **ADR-006** (updated) |
| **H-11 sub** — does `accounts.status` revert on reopen? | **No — do not automatically change `accounts.status`.** Account status is independent of any single opportunity, because the account may hold other WON opportunities. A regression test covers an account with multiple opportunities including another WON one. | **ADR-007** (updated) |
| **§14.6 failure state** — where does "failed twice consecutively" live? | **`system_settings`**, via `maintenance_consecutive_failures` and `maintenance_last_failure_at`. The route updates both after every execution; the OWNER is notified at 2; success resets the count. **No notifications table.** | **ADR-014** |
| **TODO-BD-06 seed list** — the Erode District enumeration | **The ten official revenue taluks**: Erode, Perundurai, Modakkurichi, Kodumudi, Gobichettipalayam, Sathyamangalam, Bhavani, Anthiyur, Thalavadi, Nambiyur. **Chennimalai is not a revenue taluk** — it is a development block and firka within Perundurai taluk and belongs in `area`. | **TODO-BD-06** (final) |
| **M-21 destination** — the independent backup target | **AWS S3, Mumbai `ap-south-1`**, in a business-controlled AWS account: dedicated bucket, encryption, versioning, least-privilege IAM, weekly `pg_dump`, automated retention, **90-day minimum**, documented restore procedure, at least one tested restore before go-live. | `/docs/DEPLOYMENT.md` §7 |

**The Decision Gate's blocking criteria are met** — see `/docs/IMPLEMENTATION_PLAN.md`.
Nothing in this audit blocks Phase 2 or Phase 3.

---

## Resolution log

| ID | Type | Resolution | ADR | Phase |
|---|---|---|---|---|
| B-01 | Architecture deviation | Reason via transaction-local GUC read by the trigger | ADR-001 | 6, 11, 16 |
| B-02 | Architecture correction | `SECURITY DEFINER` `reassign_opportunity` RPC; fallback SQL never used | — | 5, 11 |
| B-03 | Architecture deviation | Dedicated system user as `actor_id` for automated writes | ADR-003 | 3, 15, 18 |
| B-04 | Architecture correction | Role helpers first, context helpers after their tables exist | — | 3, 5 |
| B-05 | Architecture deviation | `sla_notified_at` column on `opportunities`; no notifications table | ADR-002 | 3, 18 |
| B-06 | Architecture correction | `normalize_phone()` declared `IMMUTABLE` and deterministic | — | 3, 6 |
| B-07 | Architecture correction | `accounts` FK deferred to migration 007 | — | 3 |
| B-08 | Architecture deviation | DELETE permitted on `project_stakeholders` link rows only | ADR-004 | 5, 10, 19 |
| B-09 | Architecture deviation | Browser → signed upload URL → private Storage | ADR-005 | 12, 17 |
| B-10 | Architecture correction | Explicit `Asia/Kolkata` conversion in every business-day expression | — | 3, 6, 12, 14, 18 |
| H-01 | Architecture correction | `stage_changed_at` maintained by the database trigger | — | 3, 14 |
| H-02 | Architecture deviation | Merge is not reversible in V1; preview + confirm + warn | ADR-008 | 16 |
| H-03 | Architecture correction | Migration ordering corrected; `system_settings` before its consumers | — | 3, 12, 14, 15 |
| H-04 | Architecture correction | RLS enabled per table migration; 015 is hardening | — | 3, 5, 19 |
| H-05 | Architecture correction | `can_reassign() = MANAGER or OWNER`; ADMIN excluded | — | 5, 11, 19 |
| H-06 | Architecture correction | `FOR ALL` users policy removed; operations enumerated | — | 3, 5, 19 |
| H-07 | Architecture deviation | User provisioning is a third service-role caller, after an authz check | ADR-009 | 4, 19 |
| H-08 | Architecture deviation | Import atomicity kept; live progress dropped | ADR-012 | 15 |
| H-09 | Architecture correction | Maintenance must not invalidate rollback eligibility | — | 15, 18 |
| H-10 | Architecture deviation | `quoted_requires_quotation` applies to `quoted` only | ADR-006 | 3, 11 |
| H-11 | Architecture deviation | `won → qualified` reopen; clear `final_order_value` and `closed_at` | ADR-007 | 6, 11, 14 |
| H-12 | Architecture correction | All context-visibility helpers defined as `SECURITY DEFINER` | — | 5, 9, 10, 12, 17 |
| H-13 | Business decision | Single-manager scope; trail on the opportunity timeline, visually distinct; no `/audit`, no team model | C-1 | 11, 14 |
| M-01 | Business decision | ADMIN lands on `/settings` | — | 4 |
| M-03 | Business decision | Unauthorised access returns 404 | — | 7 |
| M-04 | Architecture correction | Resolved by §25.3 — next action is never hard-blocking | — | 8, 12 |
| M-07 | Architecture correction | `coalesce(…, false)` for the flag booleans | — | 3, 12, 14 |
| M-08 | Architecture correction | Per-table DDL is authoritative over §5.0's blanket sentence | — | 3 |
| M-09 | Architecture correction | `setPrimaryStakeholder` as two statements in one transaction | — | 10 |
| M-10 | Business decision | Dormancy split into two settings keys | ADR-010 | 3, 12, 14, 18 |
| M-13 | Architecture correction | `Intl.DateTimeFormat`, no new dependency | — | 1, 6 |
| M-14 | Architecture correction | Hand-rolled magic-byte check for four types | — | 1, 17 |
| M-15 | Architecture correction | `/today` filters by owner explicitly | — | 12, 14 |
| M-16 | Architecture correction | Acceptance tests corrected for work-context visibility | — | 5, 8, 19 |
| M-17 | Architecture correction | Production migration command and CI credentials pinned | — | 21 |
| M-18 | Architecture correction | 20,000-opportunity performance fixture added | — | 14, 19 |
| M-19 | Architecture correction | `(select public.fn(...))` InitPlan wrapping | — | 5, 14, 20 |
| M-20 | Architecture correction | Supabase/Docker CI strategy defined | — | 19 |
| M-21 | Architecture correction (partial) | Requirement kept; external infrastructure documented; destination open | — | 21 |
| M-22 | Architecture correction | `duplicate_of` stays polymorphic; documented | — | 15 |
| M-23 | Architecture correction | Lowercase stage values preserved; generated types only | — | 3, 6, 11 |
| M-24 | Architecture correction | Event writers defined for archive/restore/reopen via ADR-001 | — | 11, 16 |
| M-25 | Architecture correction | Deactivation session behaviour documented | — | 4, 19 |
| M-26 | Architecture deviation | Hourly trigger + in-route gate for the owner summary | ADR-011 | 18 |
| M-27 | Architecture correction | Vercel plan supporting hourly cron; IST→UTC conversion | — | 21 |
| M-28 | Architecture correction | Resend sender + CI/staging env vars added | — | 1, 19, 21 |
| M-29 | Architecture correction | Cast in the select where a string is wanted; no `parseFloat` | — | 6 |
| M-30 | Architecture correction | Cross-feature import rule enforced by lint | — | 1 |
| M-02 | Business decision | Manager export from manager-accessible list/report screens; ADMIN restriction preserved | C-2 | 14, 20 |
| M-05 | Architecture deviation | `account_reachable` check constraint on `accounts` | ADR-013 | 3, 8, 15 |
| M-06 | Business decision | Archive: preview → display → confirm → one controlled operation | C-3 | 16 |
| M-11 | Product decision | Explicit creation/edit routes; account tabs via query state | C-4 | 7, 8–11 |
| M-12 | Architecture correction | Supabase Auth built-in rate limiting; no Redis; tested | C-5 | 4, 19 |
| §14.6 state | Architecture deviation | Maintenance failure counters in `system_settings` | ADR-014 | 3, 18 |
| §3.1 ADMIN row | Architecture deviation | ADMIN removed from `is_manager_or_above()`; no automatic business-data read | ADR-017 | 3, 4 |
| TODO-BD-12 `branch` | Architecture deviation | `branch` retired; `outlets` + `user_outlets` + `outlet_id`; outlet scope enforced in RLS | ADR-016 | 3, 4 |
| M-20 (revisited) | Architecture deviation | Docker egress blocked; plain PostgreSQL + platform bootstrap + `postgres-meta` generator | ADR-018 | 3, 19 |
| P1-05 | Architecture deviation | `opportunity_events.created_at` defaults to `clock_timestamp()` | ADR-019 | 3 |

---

## Findings raised during Master Phase 1

Three items were found while implementing the platform foundation. Each is recorded here rather
than resolved in code, per `CLAUDE.md` §2.

### P1-01 — §3.1 grants ADMIN "See all records" while §3.2 calls it "not a sales role"

**Severity:** HIGH · **Type:** Architecture deviation · **Resolved by:** **ADR-017**

§3.1's capability matrix marks "See all records" ✔ for ADMIN and §15.1 puts ADMIN inside
`is_manager_or_above()`, so ADMIN passed the SELECT policy on every business table. §3.2 says the
opposite in prose: "ADMIN is a system/data role, not a sales role". A policy cannot hold both.
Resolved in favour of the narrower reading: ADMIN administers users, settings and imports and has
**no automatic business-data visibility**. Carries a negative test.

### P1-02 — `branch text` cannot express the stated outlet requirement

**Severity:** HIGH · **Type:** Architecture deviation · **Resolved by:** **ADR-016**

§5.2–§5.7 carry `branch text not null default 'MAIN'` and TODO-BD-12 froze it as inert. The stated
requirement — manager scope over zero, one or many outlets, several managers per outlet, users
moving between outlets, an outlet deactivated without losing history — needs identity and
assignment, which free text has neither of. `branch` is retired and replaced. **The table count
rises from eleven to thirteen**; both additions are organizational structure, not CRM records.

### P1-03 — §19.2's "local Supabase" is unreachable under the environment's egress policy

**Severity:** BLOCKER (for verification) · **Type:** Architecture deviation · **Resolved by:** **ADR-018**

`supabase start` and `supabase gen types --local` pull images from `public.ecr.aws`, whose blob CDN
is denied by the egress policy. Rather than skip execution or fabricate a result, migrations, RLS
tests and type generation run against a **real PostgreSQL 16 server** with a platform bootstrap
providing the Supabase objects the application depends on. **What this cannot verify is listed in
ADR-018 and remains open**: Supabase Auth's own behaviour, Storage policies (§15.6), and
PostgREST request handling.

### P1-04 — §15.3's `users_admin_all` policy grants DELETE

**Severity:** HIGH · **Type:** Architecture correction · **No ADR needed**

§15.3 writes the OWNER/ADMIN policy on `public.users` as
`create policy users_admin_all … for all`. **`for all` includes DELETE**, which would put a second
delete grant in the schema and contradict §15.2's "no `DELETE` policy on any business table" and
ADR-004's "exactly one". The spec's *intent* is unambiguous — §15.2 and ADR-004 both state it — so
the text is defective rather than the design.

**Resolution.** Split into explicit `users_admin_insert` and `users_admin_update`; SELECT is
already covered by `users_select`. No DELETE policy is created. `tests/integration/no-hard-delete.test.ts`
asserts the schema has exactly one DELETE policy and that it is on `project_stakeholders`.

### P1-05 — audit events written in one transaction have no defined order

**Severity:** MEDIUM · **Type:** Architecture deviation · **Resolved by:** **ADR-019**

`opportunity_events.created_at` defaults to `now()`, which is **transaction start time**, and
§16.3 requires `changeOpportunityStage`, `logActivity` and `bulkReassign` to run as single
transactions. Several events therefore share an identical timestamp routinely — a stage change and
a reassignment in one RPC — and `(opportunity_id, created_at desc)`, the index §5.9 specifies for
reading the trail, cannot order them. The audit timeline is non-deterministic to read.

**Resolved 2026-08-19 by the Project Owner (ADR-019).** The column defaults to
**`clock_timestamp()`**, which records the instant each row is actually written, so events from one
transaction receive distinct and correctly ordered timestamps. Nothing else about the audit model
changes: the trigger is still the single writer, and there is still no INSERT, UPDATE or DELETE
policy. `013_opportunity_events.sql` had never been applied to a shared environment, so the change
is an edit rather than a follow-on migration (§21.2). `tests/integration/audit-trail.test.ts` now
asserts the ordering directly — several events written in one transaction come back strictly
ordered, and their timestamps are distinct.

---

## Master Phase 5 findings

### P5-01 — outlet scope was evaluated once per row

**Severity:** HIGH · **Type:** Performance defect · **Resolved by:** **ADR-032**, migrations 028/029

Every scoped policy tested `manages_outlet(outlet_id)` — a `SECURITY DEFINER` function taking a row
column, so it ran per row, each call re-reading `public.users` for the caller's role. Measured on
20,005 opportunities as a salesperson: **792 ms with RLS against 4.8 ms without**. The accounts list
was worse at **3,754 ms**, and `search_crm` reached **7.3 s**.

This was not a hypothetical at scale: the cost is proportional to rows scanned and is paid on
`/today`, on every list and on every search, from a phone, from the first thousand rows.

**Resolution.** Thirteen policies rewritten to evaluate scope once per query, using the InitPlan
pattern §15.1 already describes and migration 022 already uses. `/today` 881 → 75 ms, accounts
3,754 → 103 ms, `opportunity_events` 3,277 → 14 ms, search 7,299 → 245 ms. **No rule changed** —
the whole integration suite passed unchanged, and `rls-scope-equivalence.test.ts` adds 22
assertions comparing each new form against the function it replaced, role by role.

### P5-02 — a schema-filtered dump does not carry its extensions

**Severity:** HIGH · **Type:** Data-recovery defect · **Resolved in** `scripts/restore.sh`

Found by performing the restore §18 requires rather than by reading the script. The first drill
reported a clean restore, every table present and **every row count matching** — and search was
completely broken in the restored database.

`pg_trgm` and `pgcrypto` live in Supabase's `extensions` schema. `pg_dump --schema=public …`
carries the *uses* of an extension without the `CREATE EXTENSION` that defines it, so the three
trigram indexes silently failed to restore and `search_crm` and `find_account_duplicates` raised
`schema "extensions" does not exist` on every call.

**Resolution.** `restore.sh` prepares the target's `extensions` schema before restoring — a no-op
against a real Supabase project, and what makes the archive restorable onto a bare PostgreSQL
server, which is the entire point of holding it. `verify-restore.sql` now **calls** `search_crm()`
and asserts the three indexes exist, so this failure can never be silent again.

**The general lesson, recorded because it generalises:** counting rows does not verify a restore.
Exercising the functionality does.

### P5-03 — a nonce-based CSP silently breaks a prerendered page

**Severity:** HIGH · **Type:** Implementation trap · **Resolved by:** **ADR-031**

`/login` was statically prerendered, and Next.js can only stamp a nonce onto scripts it renders per
request. Under `script-src 'self' 'nonce-…' 'strict-dynamic'` — where `'strict-dynamic'` causes
`'self'` to be **ignored** — the page shipped twelve unnonced script tags, so a browser would have
blocked every script on the sign-in screen.

Every header check passed. This is exactly the failure §23 warns about when it says not to break
the application to satisfy a superficial header check, and it was caught only by loading the page
in a real browser.

**Resolution.** `/login` is `dynamic = 'force-dynamic'`. `scripts/smoke.sh` asserts the nonce is
fresh per request *and* present on the page's own scripts.

### P5-04 — two configuration gaps, reported rather than mutated

**Severity:** LOW · **Type:** Business configuration · **Open — for the Project Owner**

`scripts/data-quality.sql` found these on the development fixtures. Neither is a code defect and
neither was silently "fixed" (§28):

| Finding | What it means |
|---|---|
| `material_types` is `[]` | An empty list removes a field's options from every enquiry form, which looks like a bug to a salesperson. **The owner must supply the list before launch** (§33). |
| One MANAGER has no outlet scope | Correct and deliberate — ADR-016 makes a manager with an empty scope see only their own records, which is safe by default for a newly created manager. Reported so it is a decision rather than an oversight. |
