-- 004 — outlets and outlet scope (ADR-016)
--
-- Replaces the `branch text` column the specification carried on `users`,
-- `accounts`, `projects` and `opportunities`. An outlet is a row with an
-- identity, so it can be renamed, assigned to people and deactivated without
-- losing history. Outlet names are DATA — never a constant, never an enum value,
-- and never part of a role name.

create table public.outlets (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique
             check (code = upper(trim(code)) and length(trim(code)) between 2 and 16),
  name       text not null check (length(trim(name)) >= 2),
  city       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

create index outlets_active_idx on public.outlets (is_active);

create trigger outlets_touch_updated_at
  before update on public.outlets
  for each row execute function public.touch_updated_at();

-- A user's outlet scope. Zero, one or many rows per user:
--   SALESPERSON  their posting — used for record creation, not for widening reads
--   MANAGER      the outlets they manage; an empty scope means own records only
--   OWNER        company-wide by role, deliberately NOT modelled as membership,
--                so adding an outlet can never silently narrow the owner's access
--   ADMIN        no business-data scope at all (ADR-017)
--
-- There is no DELETE policy here, as on every table but `project_stakeholders`
-- (ADR-004). Moving a user between outlets sets `revoked_at`, which both honours
-- the no-hard-delete rule (§8.8) and leaves an auditable record of the move.
create table public.user_outlets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete restrict,
  outlet_id   uuid not null references public.outlets(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.users(id)
);

-- A user may hold an outlet once at a time, and may be re-assigned to an outlet
-- they previously left.
create unique index user_outlets_current_unique
  on public.user_outlets (user_id, outlet_id) where revoked_at is null;
create index user_outlets_user_idx   on public.user_outlets (user_id)   where revoked_at is null;
create index user_outlets_outlet_idx on public.user_outlets (outlet_id) where revoked_at is null;

-- RLS on, from the moment the table exists (SPEC_AUDIT H-04). The policies
-- themselves arrive in 016, where the whole authorization model can be read at
-- once; until then this table denies everything to every role but its owner, so
-- no intermediate state of the migration sequence is readable.
alter table public.outlets enable row level security;
alter table public.user_outlets enable row level security;
