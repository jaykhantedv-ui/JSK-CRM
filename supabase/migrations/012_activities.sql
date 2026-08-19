-- 012 — activities (§5.8)
--
-- Append-only history: WHAT HAPPENED. Site visits are `type = 'SITE_VISIT'`, not
-- a separate table.
--
-- `account_id` is ALWAYS populated, even when logging from an opportunity, so the
-- Customer 360 timeline is one indexed query.
--
-- Editable by the author for 24 hours, enforced by the RLS UPDATE policy in 016
-- rather than by the UI. Immutable thereafter, deletable by nobody, ever —
-- corrections after 24 hours are appended as a new `NOTE` activity.

create table public.activities (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  opportunity_id   uuid references public.opportunities(id) on delete cascade,
  project_id       uuid references public.projects(id) on delete set null,
  contact_id       uuid references public.contacts(id) on delete set null,
  type             public.activity_type not null,
  purpose          public.activity_purpose not null default 'FOLLOW_UP',
  outcome          public.activity_outcome not null default 'NEUTRAL',
  summary          text not null check (length(trim(summary)) >= 3),
  occurred_at      timestamptz not null default now(),
  duration_minutes smallint,
  measurements     text,
  location_note    text,
  attachment_paths text[] not null default '{}',
  -- Reassignment never rewrites history: activities keep their original
  -- `performed_by` (§8.1).
  performed_by     uuid not null references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.users(id)
);

create index activities_account_idx     on public.activities (account_id, occurred_at desc);
create index activities_opportunity_idx on public.activities (opportunity_id, occurred_at desc);
create index activities_performer_idx   on public.activities (performed_by, occurred_at desc);
create index activities_project_idx     on public.activities (project_id);

create trigger activities_touch_updated_at
  before update on public.activities
  for each row execute function public.touch_updated_at();

-- RLS on, from the moment the table exists (SPEC_AUDIT H-04). The policies
-- themselves arrive in 016, where the whole authorization model can be read at
-- once; until then this table denies everything to every role but its owner, so
-- no intermediate state of the migration sequence is readable.
alter table public.activities enable row level security;
