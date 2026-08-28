# Permissions

Derived from `CLAUDE_CODE_BUILD_SPEC.md` §3, §15, with the approved corrections of 2026-08-19
(Project Owner) applied, plus the outlet model of **ADR-016** and the ADMIN correction of
**ADR-017**.

**Status: built and verified.** Every rule below is asserted in `tests/integration/`, **as the
restricted role** — never as OWNER, which passes everything (§23).

> **RLS is the security boundary. Frontend filtering is not a control. A hidden button is never a
> control.** Every permission below must hold against a **direct PostgREST call** carrying a
> salesperson's JWT, not merely against the UI (§15, §19.4).

---

## 1. Roles

Four values on `users.role`: `SALESPERSON`, `MANAGER`, `OWNER`, `ADMIN`.

- **The reporting line is the read boundary (ADR-040).** `users.manager_id` says who reports to
  whom, and a **Sales Head** (database role `MANAGER`) reads their own records and their **direct
  reports'** — not their branch. Three sales heads share one branch in the pilot, and outlet scope
  gave each of them the other two's pipeline. Branch scope still decides which branches a person
  may file against, compare in reporting, and move a record between.
- **A record follows its OWNER's sales head, not its branch.** A deal filed at another branch by
  your salesperson stays yours; a deal filed at your branch by somebody else's does not become
  yours.
- **"Sales Head" is what the UI says; `MANAGER` is what the database stores.** The word "Manager"
  must not appear in the interface for this role — the same discipline §2.4 applies to "Revenue".
  `ROLE_LABELS` in `lib/permissions.ts` is the only place the label lives.
- **The reporting line is legal or it is refused**, by `guard_user_hierarchy()`:
  SALESPERSON → MANAGER → ADMIN → OWNER, no self-manager, no cycle, and nobody may change who
  they report to but the OWNER or an ADMIN.
- **No self-registration.** Users are created by OWNER or ADMIN (§3.2), through a Server Action
  that uses the service-role client **only after a server-side OWNER/ADMIN check** (ADR-009).
- **The FIRST owner is the one exception, and it is not an in-application path.** With no OWNER
  there is nobody who may create one, so a new deployment is deadlocked. `deploy/bootstrap-owner.sh`
  breaks that once, from the server's own shell: it refuses if an active OWNER already exists, and
  it performs the same three steps the Server Action does — Auth admin API, mirroring trigger, role
  applied afterwards (ADR-039). It is an operator command, not a route; nothing in the application
  can reach it.
- Deactivating a user (`is_active = false`) blocks login. Their records are never deleted;
  **ownership must be reassigned separately** as an explicit action.
- **ADMIN is a system/data role, not a sales role:** no dashboards, no reassignment, no export —
  **and, since ADR-017, no automatic business-data visibility at all.** ADMIN administers users,
  outlets, settings and imports. ADMIN's landing route is **`/settings`** (M-01).
- **Roles never encode an outlet.** There are four role values and there will be four. A
  `OUTLET_MANAGER_A` role would be a defect (ADR-016).

### Outlet scope (ADR-016)

Scope is `user_outlets`, a link table. A user holds **zero, one or many** outlets, and an outlet
holds **many** users.

| Role | Scope | Notes |
|---|---|---|
| SALESPERSON | Their posting | Decides where their new records are created. **It does not widen what they can read** — that is ownership plus work context. |
| MANAGER | The outlets assigned to them | Zero, one or many. **Zero means own records only**, so a newly created manager is safe by default. |
| OWNER | Company-wide, **by role** | Deliberately **not** modelled as membership of every outlet: enumerating them would silently narrow the owner's access the day an outlet is added. |
| ADMIN | None | ADR-017. |

Moving a user between outlets sets `revoked_at` and inserts the new row. Nothing is deleted, so
there is a record of who could see which deals, and when.

Deactivating an outlet is `is_active = false`. Records keep pointing at it, so reporting over a
closed outlet still works — the reason outlets are rows rather than a text column.

### The system user (ADR-003)

One additional row exists in `public.users`: a dedicated **system user** that is the `actor_id`
for service-role automated writes (cron, import). It is seeded **`is_active = false`**, so
`user_role()` returns null for it and **it can never authenticate or satisfy any policy**. It is
excluded from `/team`, workload reporting, user lists and every digest.

---

## 2. Capability matrix (§3.1)

| Capability | SALESPERSON | MANAGER | OWNER | ADMIN |
|---|:--:|:--:|:--:|:--:|
| See own-owned accounts/projects/opportunities | ✔ | ✔ | ✔ | ✔ |
| See records related to an opportunity they own | ✔ | ✔ | ✔ | ✔ |
| **See all records** | ✘ | **✘ — outlet-scoped** | ✔ | **✘ — ADR-017** |
| See records for their assigned outlet(s) | ✘ | ✔ | ✔ | ✘ |
| Create accounts, contacts, projects, opportunities, activities | ✔ | ✔ | ✔ | ✔ |
| Edit own-owned records | ✔ | ✔ | ✔ | ✔ |
| Edit any record | ✘ | **✔ within their outlets** | ✔ | **✘ — ADR-017** |
| **Assign / reassign ownership** | ✘ | ✔ | ✔ | **✘ — ADR-017** |
| **Archive / restore records** | ✘ | ✔ | ✔ | **✘ — see below** |
| **Hard delete anything** | ✘ | ✘ | ✘ | ✘ |
| **Export CSV** | ✘ | ✔ | ✔ | ✘ |
| Import CSV | ✘ | ✘ | ✔ | ✔ |
| Team dashboard, reports, workload | ✘ | ✔ | ✔ | ✘ |
| Manage users | ✘ | ✘ | ✔ | ✔ |
| Edit system settings / controlled values | ✘ | ✘ | ✔ | ✔ |
| View audit trail | ✘ | ✔ (their outlets) | ✔ | **✘ — ADR-017** |

**ADR-017 — the ✘ marks against ADMIN.** §3.1's matrix marked ADMIN ✔ for "See all records" while
§3.2 called it "a system/data role, not a sales role". A policy cannot hold both, and the narrower
reading is the one that matches how the role is used and whose failure mode is a support request
rather than a customer-data leak. **ADMIN is removed from `is_manager_or_above()`**, so it reads
only its own records — the same as anybody with no elevated business role.

An administrator who genuinely needs pipeline visibility is given OWNER, or MANAGER with outlet
scope: an explicit, auditable grant rather than a side effect of holding the keys to user
provisioning.

**Archive/restore for ADMIN** follows as a consequence, not as a separate decision: the UPDATE
policy's `USING` clause hides business rows from ADMIN, so there is nothing for it to archive.

**H-05 resolved by the same change.** With ADMIN out of `is_manager_or_above()`, that helper *is*
`MANAGER, OWNER` — the separate `can_reassign()` the audit proposed would now be a redundant alias
and is not written.

**H-13 resolved (C-1).** **V1 has one manager**, so "own team" is **the salespeople operating
under the current single-manager structure**. **No `team_id`, no `manager_id`** — no team model
enters the schema. The trail is surfaced **in the opportunity detail timeline**, where audit
events are **visually and semantically distinguishable from activities** (§10.1 keeps them
separate). **No `/audit` route in V1.** No policy change is needed: `opportunity_events` SELECT is
already gated on `can_see_opportunity()`, which yields exactly this scope. If a second manager is
ever hired, "own team" becomes a real question again — a V2 decision.

**M-02 resolved (C-2).** **Manager CSV export is available directly from the manager-accessible
list and report screens** — `/opportunities`, `/accounts`, `/projects`, `/team`, `/reports` —
exporting the current filtered view. It does **not** live only under `/settings`. OWNER keeps the
§21.4 `/settings` bulk export as well. **The ADMIN restriction is preserved**: the control is not
rendered for ADMIN **and** the Server Action rejects ADMIN — a hidden button is not a control
(§19.4). Export is therefore a capability check (`role in (MANAGER, OWNER)`) applied at the
action, not a property of a route, and exported rows are scoped by RLS so an export and a screen
always agree.

---

## 3. The read model

A salesperson's read access is **ownership-based plus work-context** (§3.2):

> They may read an account or project they do **not** own *only if* they own an opportunity
> attached to it. **This is expressed as an RLS `EXISTS` clause, not as application filtering.**

So a salesperson sees:
- accounts, projects, contacts and opportunities they own; **plus**
- any account or project on which they own an opportunity, and that account's contacts;
- activities on accounts they can see;
- opportunity events on opportunities they can see.

Work context does **not** extend sideways: owning an opportunity on somebody's account lets you
read the account, not that person's other opportunities on it.

**MANAGER** sees the same, plus every record whose `outlet_id` is in their scope. **OWNER** sees
everything. **ADMIN** sees no business records at all (ADR-017).

A record's outlet decides its scope — **not its owner's posting**. A salesperson posted to Erode
who books a deal for Gobichettipalayam creates a record the Gobi manager sees and the Erode manager
does not. Deriving scope from the owner instead would silently move history between outlets on
every reassignment.

**M-16 resolved.** §23.1's "salesperson sees only their own accounts in list, search and counts"
understated this and would have failed correct behaviour. **The acceptance tests are corrected to
own accounts *plus* work-context accounts.**

**M-15 resolved.** §13.2's claim that `/today` tiles are "scoped to `owner_id = current user` by
RLS" is true only for SALESPERSON. `/today` is available to all roles and MANAGER/OWNER/ADMIN pass
`is_manager_or_above()`, so **`/today` queries must filter by the current owner explicitly.**

---

## 4. Role resolution without recursion (§15.1)

A policy that reads `public.users` to find the caller's role **will recurse** when applied to
`public.users` itself. §25 names this as the most likely early blocker. The answer is
`SECURITY DEFINER` helpers.

| Function | Returns | Notes |
|---|---|---|
| `current_user_id()` | The caller's id, **or null when `is_active` is false** | Every ownership test goes through this rather than `auth.uid()`, so deactivation closes the database boundary immediately instead of when the token expires up to an hour later |
| `user_role()` | The caller's role, or null when `is_active` is false | |
| `is_manager_or_above()` | **`MANAGER`, `OWNER`** | ADR-017 — ADMIN removed. Read "or above" as *above SALESPERSON in the sales hierarchy* |
| `is_owner()` | `OWNER` | Company-wide authority |
| `manages_outlet(uuid)` | OWNER always; MANAGER when the outlet is in their scope | ADR-016. The outlet-scope gate on every business table |
| `manages_user(uuid)` | OWNER always; MANAGER when they share an outlet | Backs the `users` and `contacts` read rules |
| `is_owner_or_admin()` | `OWNER`, `ADMIN` | Settings, import, user management |
| **`can_reassign()`** | **`MANAGER`, `OWNER`** | **New — H-05.** The only gate for ownership changes |
| `owns_opportunity_on_account(uuid)` | Work-context read grant | Created after `opportunities` (B-04) |
| `owns_opportunity_on_project(uuid)` | Work-context read grant | Created after `opportunities` (B-04) |
| **`can_see_account(uuid)`** | Visibility predicate | **New — H-12** |
| **`can_see_project(uuid)`** | Visibility predicate | **New — H-12** |
| **`can_see_opportunity(uuid)`** | Visibility predicate | **New — H-12** |
| **`can_see_activity(uuid)`** | Visibility predicate | **New — H-12** |

All are `stable`, `security definer`, **`set search_path = public`** (which prevents search-path
hijacking of a definer function), with **least privilege**: `revoke execute from anon`,
`grant execute to authenticated`.

They must be `SECURITY DEFINER` specifically **so they do not re-enter the policies they support**.

**B-04 resolved — creation order.** All helpers live in `015_rls_helpers.sql`, after every table,
because PostgreSQL validates `language sql` bodies at creation time and the work-context and
`can_read_*` helpers select from the business tables.

**M-19 applied — performance.** Argument-free helpers are called as **`(select public.fn())`** so
PostgreSQL evaluates them once per query as an InitPlan rather than per row. Helpers taking a row
column — `manages_outlet(outlet_id)` — are called directly, because wrapping a correlated
reference defeats the point.

Because `current_user_id()` and `user_role()` both return null for a deactivated user, every
policy denies them — including the ownership clauses, which is why ownership is tested through
`current_user_id()` and never through `auth.uid()` directly.
**M-25 resolved — documented behaviour:** deactivation takes effect immediately at the policy
layer, while the already-issued JWT itself remains valid until it expires. The practical result is
an app that denies every read and write, not a clean sign-out. §19.4's session-expiry test asserts
this.

---

## 5. Policy pattern (§15.2)

For every table: `SELECT`, `INSERT`, `UPDATE`.

> **No `DELETE` policy on any table — with exactly one approved exception.**

**H-06 / P1-04 resolved.** §15.3's `users_admin_all … for all` silently included DELETE,
contradicting §3.1's "hard delete: nobody". **The `FOR ALL` policy is not written**; the permitted
operations are enumerated as separate `for insert` / `for update` policies, with SELECT already
covered. Enumerating makes the grant auditable.

**ADR-004 (B-08) — the one exception.** `project_stakeholders` carries a `DELETE` policy, scoped
identically to its `UPDATE` policy, because the row is a relationship/link rather than a business
entity. `accounts`, `contacts`, `projects`, `opportunities`, `activities`, `opportunity_events`,
`users`, `outlets`, `user_outlets`, `system_settings`, `import_batches` and `import_rows` remain
**undeletable by every role, including OWNER**. A reviewer should be able to grep for `for delete`
and find exactly one policy — and `tests/integration/no-hard-delete.test.ts` proves it, table by
table and role by role.

### `users` (§15.3)

- SELECT: self, `manages_user(id)` (a manager sharing an outlet), or owner/admin.
- UPDATE self: `with check (id = auth.uid() and role = public.user_role())` — **this clause is what
  prevents self-escalation.** A salesperson editing their own profile cannot change their role.
- OWNER/ADMIN: enumerated SELECT / INSERT / UPDATE. **No `FOR ALL`. No DELETE** (H-06).

### `accounts` — the pattern all business tables follow (§15.4 + ADR-016)

```sql
SELECT  owner_id = (select current_user_id())
        or manages_outlet(outlet_id)
        or owns_opportunity_on_account(id)
INSERT  with check (owner_id = (select current_user_id()) or manages_outlet(outlet_id))
UPDATE  using      (owner_id = (select current_user_id()) or manages_outlet(outlet_id))
        with check (owner_id = (select current_user_id()) or manages_outlet(outlet_id))
```

`is_manager_or_above()` is replaced by **`manages_outlet(outlet_id)`** on every business table:
manager authority is scoped to their outlets, and OWNER passes it for every outlet by role.

Three escapes are closed:

- **Reassignment.** Changing `owner_id` to somebody else leaves the row failing
  `owner_id = current_user_id()`, so the `WITH CHECK` refuses it. Setting it to null fails the
  same way.
- **Moving a record to another outlet**, which would hide it from the manager who is accountable
  for it — refused by the `guard_record_scope()` trigger unless the caller manages the outlet the
  record is leaving.
- **Archiving**, which §3.1 gives to MANAGER and OWNER only — refused by the same trigger.

The last two are a trigger rather than a `WITH CHECK` because the rule compares OLD to NEW, and a
policy subquerying its own table to read the old value would recurse.

### Remaining tables (§15.5)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `outlets` | any active user | owner/admin | owner/admin | **none** |
| `user_outlets` | self · `manages_outlet(outlet_id)` · owner/admin | owner/admin | owner/admin — a move sets `revoked_at` | **none** |
| `contacts` | own · `can_read_account(account_id)` · `can_read_account(linked_account_id)` · `manages_user(owner_id)` | owner = self, or manager+ | own or `manages_user(owner_id)` | **none** |
| `projects` | own · `manages_outlet(outlet_id)` · `owns_opportunity_on_project(id)` | owner = self, or `manages_outlet` | own or `manages_outlet` | **none** |
| `project_stakeholders` | `can_read_project(project_id)` | `can_write_project(project_id)` | same | **permitted — ADR-004** |
| `opportunities` | own · `manages_outlet(outlet_id)` | own or `manages_outlet` | own or `manages_outlet` — **an `owner_id` change fails the `WITH CHECK`** | **none** |
| `activities` | `can_read_account(account_id)` | `performed_by = current_user_id()`, and caller can read the account | **author only, and `created_at > now() - 24h`** | **none** |
| `opportunity_events` | `can_read_opportunity(opportunity_id)` | **none — the trigger writes** | **none** | **none** |
| `system_settings` | any active user | owner/admin | owner/admin | **none** |
| `import_batches` / `import_rows` | owner/admin | owner/admin | owner/admin | **none** |

`contacts` has no outlet of its own: it is reachable through the account it belongs to, or through
the person who owns it. `manages_user(owner_id)` is what lets a manager see a contact that has no
account yet.

**H-04 resolved.** `alter table … enable row level security` is in **each table's own creation
migration**, so a table is deny-by-default from the moment it exists. The policies are collected in
`016_rls_policies.sql` so the authorization model can be read as one document, and 016 re-asserts
the flag and **fails the migration** if any table arrives without it. Table privileges are granted
in 016 as well, so `authenticated` holds nothing at all until the policies exist.

### `opportunities.owner_id` — use the RPC (B-02 resolved)

§15.5 offered a `with check` expression to express "any field except `owner_id`". **That
expression is invalid SQL and recursive** — unqualified `id` binds to the inner alias, so the
subquery returns every row, and reading `opportunities` inside an `opportunities` policy recurses.
**It must never be written into a migration.**

**Resolution:** the `WITH CHECK` clause already denies a salesperson's `owner_id` change without
any subquery — after the change the row no longer satisfies `owner_id = current_user_id()`, so the
policy refuses it with 42501.

**Built in Master Phase 2 (migration 019).** The manager-side path is the **`reassign_opportunity`**
RPC, and it is **`SECURITY INVOKER`**, not `DEFINER` as this document previously planned. The same
`WITH CHECK` that denies the salesperson *permits* a manager for the record's outlet, before and
after the change, so the policy already expresses the whole rule. A `DEFINER` function would bypass
that policy and then restate the rule in PL/pgSQL — the same rule in two places, which is what
CLAUDE.md §6 forbids — and would expose a callable function that moves ownership with its own
privileges. `bulk_reassign` follows the same pattern and returns 0 for a salesperson.

ADMIN is excluded either way (H-05, ADR-017): it holds no outlet rows, so `manages_outlet()` is
false for every record and `is_manager_or_above()` does not include it.

The RPC exists rather than a plain update only because ADR-001's reason GUC must share a
transaction with the update. Both roles are covered in
`tests/integration/crm-permissions.test.ts`: a manager reassigns and the reason lands on the
`OWNER_CHANGED` event; a salesperson calling the RPC directly is refused with 42501.

---

## 6. Storage (§15.6)

Bucket `crm-files`, **private**. Path convention `{entity_type}/{entity_id}/{uuid}-{filename}`.

- **Upload (ADR-005 / B-09).** The browser uploads directly against a **server-issued signed
  upload URL**. The URL is **short-lived**, and it is issued **only after a server-side check that
  the caller can see the parent entity**. **All database writes remain server-side** — the row
  referencing the file is written by a Server Action. This is the **only** permitted client-side
  Supabase write, approved because 10 MB exceeds the platform request-body limit.
- **Read.** `SELECT` requires **visibility of the parent entity**, checked by a policy function
  that parses the path prefix using the `can_read_*` helpers (H-12).

**Storage is built** (migration `024_storage.sql`, `services/storage.service.ts`). Its bucket, its
policies and its path-prefix visibility checks are in the schema and covered by
`tests/integration/storage-authorization.test.ts`. What has **not** been exercised is Supabase
Storage's own HTTP service, which this environment cannot run (ADR-018): the upload round trip
itself is proved on the office server the first time a photo is attached.
- **No public URLs.** Serve via signed URLs with a **60-second expiry**.
- **Validation.** Max **10 MB**; MIME allow-list (`image/jpeg`, `image/png`, `image/webp`,
  `application/pdf`) verified by a **hand-rolled magic-byte signature check, not by extension**
  (M-14).

---

## 7. Additional controls (§15.8)

Passwords via Supabase Auth (**no custom hashing**) · sessions in **httpOnly cookies** via
`@supabase/ssr` · rate-limit login attempts (**C-5 / M-12 resolved** — **Supabase Auth's
built-in authentication rate limiting**, with **no Redis or other distributed infrastructure**;
throttling surfaces as a plain-language message that leaks no implementation detail, no
retry-after internal and no hint of which credential was wrong, and it is covered by automated
tests) · **all mutations validated server-side with Zod regardless of
client validation** · no raw SQL string interpolation · security headers (CSP, HSTS,
`X-Frame-Options: DENY`, `nosniff`) · **never log tokens, keys or full request bodies containing
personal data**.

**M-03 resolved.** Unauthorised record access returns **404 / not-found**, never a screen that
confirms the record exists. §12.6's "Forbidden" state is reserved for route-level denial where no
record identity is revealed.

**ADMIN runs the business; OWNER runs the business and controls the system (ADR-042).**

| | SALESPERSON | SALES HEAD | ADMIN | OWNER |
|---|---|---|---|---|
| Own records | ✔ | ✔ | ✔ | ✔ |
| Direct reports' records | — | ✔ | ✔ | ✔ |
| Every operational record | — | — | ✔ | ✔ |
| Dashboard · Team · Reports · Export | — | ✔ | ✔ | ✔ |
| Import | — | — | ✔ | ✔ |
| People · branches · reporting structure | — | — | ✔ | ✔ |
| Archive · reassign · write business records | own | ✔ | — | ✔ |
| The §24 business rules (`system_settings`) | — | — | **—** | ✔ |
| Create, alter or deactivate an OWNER | — | — | **—** | ✔ |
| Roll back an import · set the company target | — | — | — | ✔ |

The two bold cells were found open by the ADR-042 audit and closed by migration
032: an administrator could rewrite every business threshold, and could appoint a
second owner and deactivate the real one — both with a JWT and a PostgREST call,
neither reachable through the interface. `guard_owner_role()` and
`system_settings_update` are the controls.

**Three controls, and only one of them is authorization (ADR-040).**

| | What it decides | Where | Removing it |
|---|---|---|---|
| Row-level security | what a query returns | migration 031 | breaks everything |
| Route authorization | whether a screen renders at all | `requireRole` / layout guards | costs a clear refusal, leaks nothing |
| Navigation | what is worth offering | `components/layout/nav-items.ts` | costs tidiness, leaks nothing |

A salesperson typing `/reports`, `/dashboard`, `/team` or `/settings` is answered with a refusal —
not a redirect, which reads as a broken link — and would read nothing from the database even if
both of the weaker controls were deleted.

| Role | Navigation |
|---|---|
| SALESPERSON | Today · Customers · Contacts · Pipeline · Projects · My Day · My Targets |
| SALES HEAD | Today · Customers · Contacts · Pipeline · Projects · Team · Reports |
| ADMIN · OWNER | everything |

**Service-role key (§15.7, ADR-009).** Three permitted callers: **cron routes**, **the import
executor**, and **the user-provisioning Server Action** — the last only after a server-side
OWNER/ADMIN check, performed **before** the admin client is touched. `lib/supabase/admin.ts`
throws if `typeof window !== 'undefined'`, and the security suite greps the build output for the
key.

Outside `src/` there is one more holder of that key: `deploy/bootstrap-owner.sh` reads it from the
server's environment file to call the Auth admin API once (ADR-039). It is an operator command on
the machine, has no route into the application, and its regression test asserts the key never
appears in its output.

---

## 8. How permissions are tested (§19.2, §19.4, §23)

> **Never verify a permission as OWNER — OWNER passes everything, which is exactly why it proves
> nothing** (§23).

Every capability row needs a passing **positive** test and a passing **negative** test, written as
the restricted role, attacking the API rather than the UI:

- Salesperson A cannot SELECT, UPDATE, or INSERT-on-behalf-of salesperson B's records.
- Salesperson **can** read an account they do not own when they own an opportunity on it — and
  its contacts and projects by the same route (H-12, M-16).
- Salesperson cannot change `owner_id` by any route — table UPDATE, PostgREST, or the RPC.
- **ADMIN cannot reassign** (H-05); MANAGER and OWNER can.
- **DELETE fails on all twelve other tables and succeeds only on `project_stakeholders`**
  (H-06, ADR-004), asserted table by table and role by role, including `users`.
- **Cross-outlet reads fail** (ADR-016): Manager A cannot reach outlet B or outlet C; a manager
  assigned to A and C reaches both and still not B; a manager with no outlets reaches nothing.
- **ADMIN reads no business data at all** (ADR-017) — accounts, contacts, projects, opportunities,
  activities and events all return empty — while still administering users, outlets and settings.
- A deactivated user holding a valid token reads nothing.
- A salesperson cannot escalate their own role via a profile update.
- **A salesperson calling the user-provisioning action is rejected before any admin client call**
  (ADR-009).
- Direct PostgREST calls with salesperson credentials fail for cross-user reads.
- Storage objects are unreadable without visibility of the parent entity; an upload URL is not
  issued without it either.
- The service-role key is absent from the built client bundle (verified by grepping the build).
- A manager's `/today` shows only their own work, not the company's (M-15).
- **ADMIN cannot export through the Server Action**, not merely through a hidden button (C-2).
- **Repeated failed logins throttle**, the provider error maps to `AppError`, and the message
  leaks no implementation detail (C-5).
- E2E scenario 13: a salesperson cannot reach another's opportunity by direct URL **or via a
  direct Supabase query from the browser console**.

### What is proved today

`tests/integration/` holds **154 passing assertions** covering every row above that does not
require Supabase Auth, Storage or PostgREST. Each impersonates a user exactly as PostgREST does —
`set role authenticated` plus `set_config('request.jwt.claims', …)` — so a policy that would
refuse a real request refuses these, for the same reason and with the same error code.

**Still unproved, and honestly so** (ADR-018): Supabase Auth's own behaviour including login
throttling (C-5), Storage policies, and PostgREST request handling. Hosted verification was
attempted on 2026-08-19 with official tooling and is **blocked** — the Supabase control plane and
data plane are both denied by the environment's egress policy and no account is attached. See
`/docs/DEPLOYMENT.md` §0.


---

## Master Phase 3 — the management surface

### Who reaches what

| Surface | SALESPERSON | MANAGER | OWNER | ADMIN |
|---|:---:|:---:|:---:|:---:|
| `/dashboard` | ✘ → `/today` | ✔ their branches | ✔ company-wide | ✘ → `/settings` |
| `/team`, `/team/:userId` | ✘ | ✔ their branches | ✔ | ✘ |
| `/reports/*` | ✘ | ✔ their branches | ✔ | ✘ |
| `/reports/targets` — branch figure | ✘ | ✔ their branches | ✔ | ✘ |
| `/reports/targets` — company figure | ✘ | ✘ | ✔ | ✘ |
| `/api/export/*` | ✘ 403 | ✔ | ✔ | ✘ 403 |
| Read `sales_targets` | ✘ | ✔ their branches | ✔ | ✘ |

**ADMIN is absent from every row**, which is ADR-017 applied without exception: system
administration is not sales management, and reaching `/settings` confers no dashboard.

### Where each refusal actually lives

A redirect is not a control and a hidden menu item is not a control. Each rule above holds at the
database or at the server:

| Rule | Enforced by | Proved by |
|---|---|---|
| Management reporting is MANAGER/OWNER | `assert_management_access()`, called by `perform` on the first line of all thirteen analytics RPCs | `management-scope.test.ts` — 26 assertions, one per RPC per denied role |
| A manager sees only their branches | RLS on `opportunities`/`accounts`/`activities`, plus `scoped_outlet_ids()` | Branch A and branch B carry **different values**, so a leak changes the total rather than only the row count |
| An owner sees every branch | `user_role() = 'OWNER'` in `scoped_outlet_ids()`, **by role, not membership** | The OWNER fixture holds no `user_outlets` rows at all and still sees all three branches |
| Targets are management data | RLS on `sales_targets` | A salesperson sees zero rows, including their own target |
| The company target is the owner's | `outlet_id is null → is_owner()` | A manager's insert is rejected `42501` |
| A target cannot be moved out of a branch | `guard_target_scope()` trigger | The WITH CHECK alone only proves the destination |
| Export is MANAGER/OWNER | `canExportCsv()` in `export.service.ts`, before any read | The route is attacked directly, not through the button |
| An unauthenticated API call | middleware returns **401 JSON**, not a redirect (ADR-024) | Smoke suite asserts the status, which runs without Supabase Auth |

### Why the analytics gate exists at all

RLS alone would not have been enough. A salesperson calling `management_team_workload` through
PostgREST would have received a **one-row report of their own numbers** — no other person's data,
because the policies hold, but a team surface all the same. Master Phase 3 §4 is explicit that team
dashboards are not a salesperson surface, so the refusal belongs at the database boundary.

The gate is a `perform` on the first line of a `plpgsql` body rather than a WHERE predicate,
deliberately. As a predicate in a `language sql` body it would be subject to the planner: for a
caller who can see nothing, the scan yields nothing and the gate may never be evaluated — the caller
would get a polite empty report instead of a refusal. **A security control must not depend on a
planner decision.**

### What is proved today

`tests/integration/` holds **314 passing assertions**, 75 of them added by Master Phase 3 and all
made **as the restricted role** (§23 — verifying a permission as OWNER proves nothing). Still
unproved, and honestly so (ADR-018): Supabase Auth, Storage policies and PostgREST request handling,
which need a real Supabase project.


---

## Master Phase 4 — operations

| Action | SALESPERSON | MANAGER | OWNER | ADMIN | Enforced by |
|---|---|---|---|---|---|
| Import (upload, review, run) | ✗ | ✗ | ✓ | ✓ | RLS on `import_batches` / `import_rows`; `requireImporter()` |
| Roll back an import | ✗ | ✗ | ✓ | ✗ | `rollbackImport` (§20.6) |
| Archive / restore | ✗ | ✓ own outlets | ✓ | ✗ | `guard_record_scope()` trigger |
| Merge customers | ✗ | ✓ own outlets | ✓ | ✗ | `merge_accounts` role + visibility checks (ADR-026) |
| Read a stored file | own / work context | own outlets | ✓ | **✗** | `crm_files_select` on `storage.objects` |
| Upload a file | into what they can see | into their outlets | ✓ | **✗** | `crm_files_insert` |
| Edit settings | ✗ | ✗ | ✓ | ✓ | `system_settings_update` |
| Trigger a cron route | — | — | — | — | `CRON_SECRET` only; no user role reaches them |

**ADMIN is absent from every business-data row above, including files.** ADR-017: ADMIN
administers users, outlets, settings and imports and carries no automatic sales visibility. The
storage suite asserts an ADMIN sees **zero** objects.

**No role may delete anything**, including a storage object. The single approved DELETE policy in
the schema is still `project_stakeholders` (ADR-004).

**The maintenance counters are not settings.** `maintenance_consecutive_failures` and
`maintenance_last_failure_at` are written only by the maintenance cron (ADR-014) and are excluded
from `EDITABLE_SETTING_KEYS`. `/settings` displays them and offers no reset — an administrator
must not be able to silence a failing job instead of fixing it.

---

## Policy shape — how often the rule is asked (028, 029)

**No rule on this page changed.** Migrations 028 and 029 changed only how often the planner
evaluates them, because outlet scope was costing 792 ms on 20,005 opportunities and the accounts
list 3,754 ms, paid on `/today` from a salesperson's phone.

| Was — evaluated per row | Is — evaluated once per query |
|---|---|
| `manages_outlet(outlet_id)` | `(select is_owner()) or outlet_id in (select scoped_outlet_ids())` |
| `owns_opportunity_on_account(id)` | `id in (select my_opportunity_account_ids())` |
| `owns_opportunity_on_project(id)` | `id in (select my_opportunity_project_ids())` |
| `can_read_opportunity(opportunity_id)` | `opportunity_id in (select readable_opportunity_ids())` |
| `can_read_account(account_id)` | `account_id in (select readable_account_ids())` |

Two things about this are load-bearing:

**The owner test is a separate disjunct.** `scoped_outlet_ids()`'s OWNER branch lists only
`is_active` outlets. Folding the owner case into it would have quietly taken a **deactivated**
outlet's history away from the owner — so `is_owner()` is tested on its own, and
`rls-scope-equivalence.test.ts` pins that case.

**`readable_opportunity_ids()` and `readable_account_ids()` are `SECURITY INVOKER`.** A
`SECURITY DEFINER` version would have to restate "owner, or outlet scope, or work context" — a
second copy of the rules on this page, and CLAUDE.md §8 says a rule lives in one place. As
`INVOKER` they select ids and let the parent table's own policy do the filtering, so **this page
remains the single definition of who may read a row.**

`manages_outlet()` still exists and still answers the same question; it simply carries a comment
saying it must not be used inside a row predicate.

Proof: the whole integration suite passed unchanged across both migrations, plus 22 assertions
comparing each new form against the function it replaced — for OWNER, both managers, a manager
with no outlets, two salespeople, ADMIN (who still gets nothing, ADR-017) and a deactivated user
(who still gets nothing). See ADR-032.
