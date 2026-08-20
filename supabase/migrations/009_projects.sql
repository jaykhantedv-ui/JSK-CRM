-- 009 — projects (§5.5)
--
-- Required: name, account_id, project_type. Everything else optional. No derived
-- and no future fields — do not add fields not listed (§5.5).
-- `outlet_id` replaces `branch text` (ADR-016).
--
-- ONE PROJECT HAS MANY OPPORTUNITIES. Never write code that assumes otherwise.

create table public.projects (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  account_id             uuid not null references public.accounts(id) on delete restrict,
  project_type           public.project_type not null,
  construction_stage     public.construction_stage not null default 'UNKNOWN',
  status                 public.project_status not null default 'ACTIVE',
  site_address           text,
  city                   text,
  area                   text,
  builtup_area_sqft      integer  check (builtup_area_sqft is null or builtup_area_sqft between 1 and 1000000),
  floors                 smallint check (floors is null or floors between 0 and 200),
  bathrooms              smallint check (bathrooms is null or bathrooms between 0 and 500),
  expected_flooring_date date,
  estimated_value        bigint   check (estimated_value is null or estimated_value >= 0),
  notes                  text,
  owner_id               uuid not null references public.users(id),
  outlet_id              uuid not null references public.outlets(id),
  is_imported            boolean not null default false,
  legacy_ref             text,
  import_batch_id        uuid references public.import_batches(id),
  archived_at            timestamptz,
  archived_by            uuid references public.users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references public.users(id)
);

create index projects_account_idx on public.projects (account_id) where archived_at is null;
create index projects_owner_idx   on public.projects (owner_id)   where archived_at is null;
create index projects_outlet_idx  on public.projects (outlet_id)  where archived_at is null;
create index projects_status_idx  on public.projects (status, construction_stage) where archived_at is null;
create index projects_city_idx    on public.projects (city)       where archived_at is null;
create index projects_name_trgm   on public.projects using gin (name extensions.gin_trgm_ops);

create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- RLS on, from the moment the table exists (SPEC_AUDIT H-04). The policies
-- themselves arrive in 016, where the whole authorization model can be read at
-- once; until then this table denies everything to every role but its owner, so
-- no intermediate state of the migration sequence is readable.
alter table public.projects enable row level security;
