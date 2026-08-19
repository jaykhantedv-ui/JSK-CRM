# Permissions

Derived from `CLAUDE_CODE_BUILD_SPEC.md` §3, §15, with the approved corrections of 2026-08-19
(Project Owner) applied. **Nothing has been built yet.**

> **RLS is the security boundary. Frontend filtering is not a control. A hidden button is never a
> control.** Every permission below must hold against a **direct PostgREST call** carrying a
> salesperson's JWT, not merely against the UI (§15, §19.4).

---

## 1. Roles

Four values on `users.role`: `SALESPERSON`, `MANAGER`, `OWNER`, `ADMIN`.

- **No self-registration.** Users are created by OWNER or ADMIN (§3.2), through a Server Action
  that uses the service-role client **only after a server-side OWNER/ADMIN check** (ADR-009).
- Deactivating a user (`is_active = false`) blocks login. Their records are never deleted;
  **ownership must be reassigned separately** as an explicit action.
- **ADMIN is a system/data role, not a sales role:** no dashboards, no reassignment, no export.
  ADMIN's landing route is **`/settings`** (M-01), not `/dashboard`.

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
| **See all records** | ✘ | ✔ | ✔ | ✔ |
| Create accounts, contacts, projects, opportunities, activities | ✔ | ✔ | ✔ | ✔ |
| Edit own-owned records | ✔ | ✔ | ✔ | ✔ |
| Edit any record | ✘ | ✔ | ✔ | ✔ |
| **Assign / reassign ownership** | ✘ | ✔ | ✔ | **✘ — enforced by `can_reassign()`** |
| **Archive / restore records** | ✘ | ✔ | ✔ | ✔ |
| **Hard delete anything** | ✘ | ✘ | ✘ | ✘ |
| **Export CSV** | ✘ | ✔ | ✔ | ✘ |
| Import CSV | ✘ | ✘ | ✔ | ✔ |
| Team dashboard, reports, workload | ✘ | ✔ | ✔ | ✘ |
| Manage users | ✘ | ✘ | ✔ | ✔ |
| Edit system settings / controlled values | ✘ | ✘ | ✔ | ✔ |
| View audit trail | ✘ | ✔ (own team) | ✔ | ✔ |

**H-05 resolved.** "Assign/reassign — ADMIN ✘" is now enforceable: a dedicated
**`can_reassign() = MANAGER, OWNER`** helper replaces `is_manager_or_above()` on every
ownership-change gate. Every §15 write policy previously gated on `is_manager_or_above()`, which
includes ADMIN and therefore contradicted §3.1.

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

MANAGER, OWNER and ADMIN see everything.

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
| `user_role()` | The caller's role, or null when `is_active` is false | |
| `is_manager_or_above()` | `MANAGER`, `OWNER`, `ADMIN` | Read and general-edit gates |
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

**B-04 resolved — creation order.** Role helpers are created before the business tables; the
work-context and `can_see_*` helpers **after** the tables they reference, because PostgreSQL
validates `language sql` bodies at creation time.

**M-19 resolved — performance.** Wrap each helper call as **`(select public.fn(...))`** inside
policies so PostgreSQL evaluates it once as an InitPlan rather than per row. This is the main
threat to the §12.8 latency budget and is measured in Phase 5.

Because `user_role()` returns null for a deactivated user, every policy denies them.
**M-25 resolved — documented behaviour:** deactivation takes effect immediately at the policy
layer, while the already-issued JWT itself remains valid until it expires. The practical result is
an app that denies every read and write, not a clean sign-out. §19.4's session-expiry test asserts
this.

---

## 5. Policy pattern (§15.2)

For every table: `SELECT`, `INSERT`, `UPDATE`.

> **No `DELETE` policy on any table — with exactly one approved exception.**

**H-06 resolved.** §15.3's `users_admin_all … for all` silently included DELETE, contradicting
§3.1's "hard delete: nobody". **The `FOR ALL` policy is removed** and the permitted operations are
enumerated as separate `for select` / `for insert` / `for update` policies. Enumerating makes the
grant auditable.

**ADR-004 (B-08) — the one exception.** `project_stakeholders` carries a `DELETE` policy, scoped
identically to its `UPDATE` policy, because the row is a relationship/link rather than a business
entity. `accounts`, `contacts`, `projects`, `opportunities`, `activities`, `opportunity_events`,
`users`, `system_settings`, `import_batches` and `import_rows` remain **undeletable by every role,
including OWNER**. A reviewer should be able to grep for `for delete` and find exactly one policy.

### `users` (§15.3)

- SELECT: self, or manager+.
- UPDATE self: `with check (id = auth.uid() and role = public.user_role())` — **this clause is what
  prevents self-escalation.** A salesperson editing their own profile cannot change their role.
- OWNER/ADMIN: enumerated SELECT / INSERT / UPDATE. **No `FOR ALL`. No DELETE** (H-06).

### `accounts` — the pattern all business tables follow (§15.4)

- SELECT: `is_manager_or_above() or owner_id = auth.uid() or owns_opportunity_on_account(id)`
- INSERT: `with check (owner_id = auth.uid() or is_manager_or_above())`
- UPDATE: `using (is_manager_or_above() or owner_id = auth.uid())`
  `with check (is_manager_or_above() or owner_id = auth.uid())`

Reassignment is therefore impossible for a salesperson: changing `owner_id` to another user fails
the `with check`.

### Remaining tables (§15.5)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `contacts` | manager+ · own · `can_see_account(account_id)` | owner = self, or manager+ | manager+ or own | **none** |
| `projects` | manager+ · own · `owns_opportunity_on_project(id)` | owner = self, or manager+ | manager+ or own | **none** |
| `project_stakeholders` | `can_see_project(project_id)` | caller can update the parent project | same | **permitted — ADR-004** |
| `opportunities` | manager+ · `owner_id = auth.uid()` | `owner_id = auth.uid()` or manager+ | manager+ · own — **`owner_id` changes denied entirely; use the RPC** | **none** |
| `activities` | `can_see_account(account_id)` | `performed_by = auth.uid()`, and caller can see the account | **author only, and `created_at > now() - 24h`** | **none** |
| `opportunity_events` | `can_see_opportunity(opportunity_id)` | triggers only | **none** | **none** |
| `system_settings` | all authenticated (read) | owner/admin | owner/admin | **none** |
| `import_batches` / `import_rows` | owner/admin | owner/admin | owner/admin | **none** |

**H-04 resolved.** RLS is enabled and these policies are created **in each table's own creation
migration**, not deferred to a single `015`. `015_rls_policies` becomes an audit/hardening pass.
Otherwise every environment between Phase 3 and Phase 8 would be fully readable and writable by
any authenticated user.

### `opportunities.owner_id` — use the RPC (B-02 resolved)

§15.5 offered a `with check` expression to express "any field except `owner_id`". **That
expression is invalid SQL and recursive** — unqualified `id` binds to the inner alias, so the
subquery returns every row, and reading `opportunities` inside an `opportunities` policy recurses.
**It must never be written into a migration.**

**Resolution:** `owner_id` changes are **denied in the table policy entirely**. Reassignment goes
exclusively through the `SECURITY DEFINER` **`reassign_opportunity`** RPC, which checks
**`can_reassign()`** itself — not `is_manager_or_above()`, so **ADMIN is excluded** (H-05).
§15.5 states the same preference: *"Prefer the RPC — it is easier to test and audit."*
`bulk_reassign` follows the same pattern.

---

## 6. Storage (§15.6)

Bucket `crm-files`, **private**. Path convention `{entity_type}/{entity_id}/{uuid}-{filename}`.

- **Upload (ADR-005 / B-09).** The browser uploads directly against a **server-issued signed
  upload URL**. The URL is **short-lived**, and it is issued **only after a server-side check that
  the caller can see the parent entity**. **All database writes remain server-side** — the row
  referencing the file is written by a Server Action. This is the **only** permitted client-side
  Supabase write, approved because 10 MB exceeds the platform request-body limit.
- **Read.** `SELECT` requires **visibility of the parent entity**, checked by a policy function
  that parses the path prefix using the `can_see_*` helpers (H-12).
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

**Service-role key (§15.7, ADR-009).** Three permitted callers: **cron routes**, **the import
executor**, and **the user-provisioning Server Action** — the last only after a server-side
OWNER/ADMIN check, performed **before** the admin client is touched. `lib/supabase/admin.ts`
throws if `typeof window !== 'undefined'`, and the security suite greps the build output for the
key.

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
- **DELETE fails on all ten tables and succeeds only on `project_stakeholders`** (H-06, ADR-004),
  asserted table by table, including `users`.
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
