-- 010 — project stakeholders (§5.6)
--
-- The multi-stakeholder case is the reason this table exists: a house has an
-- owner, a spouse, an architect, a contractor and a mason, and the salesperson
-- must be able to see all of them against one site.
--
-- This is the ONLY table in the schema with a DELETE policy (ADR-004): the row is
-- a relationship link carrying no history, no ownership and no money, so removing
-- a wrongly-added person is a correction rather than the destruction of a record.

create table public.project_stakeholders (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  role       public.stakeholder_role not null,
  influence  public.influence_level not null default 'INFLUENCER',
  is_primary boolean not null default false,
  notes      text,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),

  constraint stakeholder_target check (contact_id is not null or account_id is not null)
);

create unique index project_stakeholders_contact_unique
  on public.project_stakeholders (project_id, contact_id) where contact_id is not null;
create unique index project_stakeholders_account_unique
  on public.project_stakeholders (project_id, account_id) where account_id is not null and contact_id is null;
-- At most one primary stakeholder per project, enforced by the database.
create unique index one_primary_per_project
  on public.project_stakeholders (project_id) where is_primary;

create index project_stakeholders_contact_idx on public.project_stakeholders (contact_id);
create index project_stakeholders_account_idx on public.project_stakeholders (account_id);

-- RLS on, from the moment the table exists (SPEC_AUDIT H-04). The policies
-- themselves arrive in 016, where the whole authorization model can be read at
-- once; until then this table denies everything to every role but its owner, so
-- no intermediate state of the migration sequence is readable.
alter table public.project_stakeholders enable row level security;
