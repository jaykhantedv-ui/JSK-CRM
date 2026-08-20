-- 005 — import batches and rows (§5.11)
-- Defined before the business tables because they carry an `import_batch_id` FK.

create table public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  entity        text not null check (entity in ('accounts','contacts','projects','opportunities')),
  file_name     text not null,
  status        public.import_status not null default 'UPLOADED',
  total_rows    integer not null default 0,
  valid_rows    integer not null default 0,
  warning_rows  integer not null default 0,
  error_rows    integer not null default 0,
  imported_rows integer not null default 0,
  uploaded_by   uuid not null references public.users(id),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger import_batches_touch_updated_at
  before update on public.import_batches
  for each row execute function public.touch_updated_at();

create table public.import_rows (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.import_batches(id) on delete cascade,
  row_number        integer not null,
  raw               jsonb not null,
  normalized        jsonb,
  status            public.import_row_status not null default 'VALID',
  messages          jsonb not null default '[]',
  -- Deliberately NOT a foreign key: the target entity varies by batch (M-22).
  duplicate_of      uuid,
  decision          text check (decision in ('IMPORT','SKIP','LINK_EXISTING')),
  created_entity_id uuid,
  created_at        timestamptz not null default now()
);

create index import_rows_batch_status_idx on public.import_rows (batch_id, status);
create unique index import_rows_batch_row_unique on public.import_rows (batch_id, row_number);

-- RLS on, from the moment the table exists (SPEC_AUDIT H-04). The policies
-- themselves arrive in 016, where the whole authorization model can be read at
-- once; until then this table denies everything to every role but its owner, so
-- no intermediate state of the migration sequence is readable.
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
