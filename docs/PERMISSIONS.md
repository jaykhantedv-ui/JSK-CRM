# Permissions

Derived from `CLAUDE_CODE_BUILD_SPEC.md` §3, §15. **Nothing here has been built yet.**

> **RLS is the security boundary. Frontend filtering is not a control. A hidden button is never a
> control.** Every permission below must hold against a **direct PostgREST call** carrying a
> salesperson's JWT, not merely against the UI (§15, §19.4).

---

## 1. Roles

Four values on `users.role`: `SALESPERSON`, `MANAGER`, `OWNER`, `ADMIN`.

- **No self-registration.** Users are created by OWNER or ADMIN (§3.2).
- Deactivating a user (`is_active = false`) blocks login. Their records are never deleted;
  **ownership must be reassigned separately** as an explicit action.
- **ADMIN is a system/data role, not a sales role:** no dashboards, no reassignment, no export.

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
| **Assign / reassign ownership** | ✘ | ✔ | ✔ | **✘** |
| **Archive / restore records** | ✘ | ✔ | ✔ | ✔ |
| **Hard delete anything** | ✘ | ✘ | ✘ | ✘ |
| **Export CSV** | ✘ | ✔ | ✔ | ✘ |
| Import CSV | ✘ | ✘ | ✔ | ✔ |
| Team dashboard, reports, workload | ✘ | ✔ | ✔ | ✘ |
| Manage users | ✘ | ✘ | ✔ | ✔ |
| Edit system settings / controlled values | ✘ | ✘ | ✔ | ✔ |
| View audit trail | ✘ | ✔ (own team) | ✔ | ✔ |

Two rows are not currently satisfiable as written:

- **Assign/reassign — ADMIN ✘.** Every write policy in §15 gates on `is_manager_or_above()`, which
  includes ADMIN. A separate `can_reassign()` = `MANAGER, OWNER` helper is required.
  (`/docs/SPEC_AUDIT.md` **H-05**.)
- **View audit trail — MANAGER (own team).** There is no team model on `users` (no `team_id`, no
  `manager_id`) and no audit route in §12.2, so neither the scope nor the surface exists.
  (`/docs/SPEC_AUDIT.md` **H-13**.)

Also inconsistent: **Export CSV** is granted to MANAGER but lives on `/settings`, which MANAGER
cannot reach; ADMIN can reach `/settings` but has export ✘ (`/docs/SPEC_AUDIT.md` M-02).

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

*(§23.1's "salesperson sees only their own accounts" understates this — `/docs/SPEC_AUDIT.md`
M-16.)*

---

## 4. Role resolution without recursion (§15.1)

A policy that reads `public.users` to find the caller's role **will recurse** when applied to
`public.users` itself. §25 names this as the most likely early blocker. The answer is
`SECURITY DEFINER` helpers:

| Function | Returns |
|---|---|
| `user_role()` | The caller's role, or null when `is_active` is false |
| `is_manager_or_above()` | `MANAGER`, `OWNER`, `ADMIN` |
| `is_owner_or_admin()` | `OWNER`, `ADMIN` |
| `can_reassign()` **(required, not in §15.1)** | `MANAGER`, `OWNER` — see H-05 |
| `owns_opportunity_on_account(uuid)` | Work-context read grant |
| `owns_opportunity_on_project(uuid)` | Work-context read grant |
| `can_see_account/project/opportunity/activity(uuid)` **(required, not in §15.1)** | Visibility predicates the §15.5 and §15.6 policies describe in prose — see H-12 |

All are `stable`, `security definer`, `set search_path = public`. **Revoke `execute` from `anon`;
grant to `authenticated`.**

Because `user_role()` returns null for a deactivated user, every policy denies them — the practical
effect of deactivation is immediate, though an already-issued JWT is not revoked
(`/docs/SPEC_AUDIT.md` M-25).

**Performance:** wrap each helper call as `(select public.fn(...))` inside policies so PostgreSQL
evaluates it once as an InitPlan rather than per row. This is the main threat to the §12.8 latency
budget (`/docs/SPEC_AUDIT.md` M-19).

---

## 5. Policy pattern (§15.2)

For every table: `SELECT`, `INSERT`, `UPDATE`.

> **No `DELETE` policy on any business table for any role.**

⚠ §15.3's `users_admin_all … for all` includes DELETE and must be enumerated as three separate
policies instead (`/docs/SPEC_AUDIT.md` **H-06**).

### `users` (§15.3)

- SELECT: self, or manager+.
- UPDATE self: `with check (id = auth.uid() and role = public.user_role())` — **this clause is what
  prevents self-escalation.** A salesperson editing their own profile cannot change their role.
- OWNER/ADMIN: full management (SELECT/INSERT/UPDATE, **not** DELETE).

### `accounts` — the pattern all business tables follow (§15.4)

- SELECT: `is_manager_or_above() or owner_id = auth.uid() or owns_opportunity_on_account(id)`
- INSERT: `with check (owner_id = auth.uid() or is_manager_or_above())`
- UPDATE: `using (is_manager_or_above() or owner_id = auth.uid())`
  `with check (is_manager_or_above() or owner_id = auth.uid())`

Reassignment is therefore impossible for a salesperson: changing `owner_id` to another user fails
the `with check`.

### Remaining tables (§15.5)

| Table | SELECT | INSERT | UPDATE |
|---|---|---|---|
| `contacts` | manager+ · own · contact of an account the caller can see | owner = self, or manager+ | manager+ or own |
| `projects` | manager+ · own · `owns_opportunity_on_project(id)` | owner = self, or manager+ | manager+ or own |
| `project_stakeholders` | caller can see the parent project | caller can update the parent project | same |
| `opportunities` | manager+ · `owner_id = auth.uid()` | `owner_id = auth.uid()` or manager+ | manager+ (any field) · own (any field **except** `owner_id`) |
| `activities` | caller can see the parent account | `performed_by = auth.uid()`, and caller can see the account | **author only, and `created_at > now() - 24h`** |
| `opportunity_events` | caller can see the parent opportunity | service-role and triggers only | **none** |
| `system_settings` | all authenticated (read) | owner/admin | owner/admin |
| `import_batches` / `import_rows` | owner/admin | owner/admin | owner/admin |

### `opportunities.owner_id` — use the RPC

§15.5 offers a `with check` expression to express "any field except `owner_id`". **That expression
is invalid SQL and recursive** — unqualified `id` binds to the inner alias, the subquery returns
every row, and reading `opportunities` inside an `opportunities` policy recurses
(`/docs/SPEC_AUDIT.md` **B-02**).

§15.5 itself gives the answer: *"implement reassignment exclusively through a `SECURITY DEFINER`
RPC (`reassign_opportunity`) that checks the role itself, and deny `owner_id` changes in the table
policy entirely. **Prefer the RPC — it is easier to test and audit.**"* The RPC must check
`can_reassign()`, not `is_manager_or_above()` (H-05).

---

## 6. Storage (§15.6)

Bucket `crm-files`, **private**. Path convention
`{entity_type}/{entity_id}/{uuid}-{filename}`.

- Authenticated users may `INSERT`.
- `SELECT` requires **visibility of the parent entity**, checked by a policy function that parses
  the path prefix — which needs the `can_see_*` helpers from H-12.
- **No public URLs.** Serve via signed URLs with a **60-second expiry**.
- Validation: **max 10 MB**, MIME allow-list (`image/jpeg`, `image/png`, `image/webp`,
  `application/pdf`), **verified by magic bytes server-side, not by extension**.

---

## 7. Additional controls (§15.8)

Passwords via Supabase Auth (**no custom hashing**) · sessions in **httpOnly cookies** via
`@supabase/ssr` · rate-limit login attempts · **all mutations validated server-side with Zod
regardless of client validation** · no raw SQL string interpolation · security headers (CSP, HSTS,
`X-Frame-Options: DENY`, `nosniff`) · **never log tokens, keys or full request bodies containing
personal data**.

---

## 8. How permissions are tested (§19.2, §19.4, §23)

> **Never verify a permission as OWNER — OWNER passes everything, which is exactly why it proves
> nothing** (§23).

Every capability row needs a passing **positive** test and a passing **negative** test, written as
the restricted role, attacking the API rather than the UI:

- Salesperson A cannot SELECT, UPDATE, or INSERT-on-behalf-of salesperson B's records.
- Salesperson **can** read an account they do not own when they own an opportunity on it.
- Salesperson cannot change `owner_id` by any route — table UPDATE, PostgREST, or the RPC.
- ADMIN cannot reassign; MANAGER and OWNER can.
- **No role can DELETE from any business table.**
- A salesperson cannot escalate their own role via a profile update.
- Direct PostgREST calls with salesperson credentials fail for cross-user reads.
- Storage objects are unreadable without visibility of the parent entity.
- The service-role key is absent from the built client bundle (verified by grepping the build).
- E2E scenario 13: a salesperson cannot reach another's opportunity by direct URL **or via a
  direct Supabase query from the browser console**.
