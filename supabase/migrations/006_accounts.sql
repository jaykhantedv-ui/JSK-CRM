-- 006 — accounts (§5.3)
--
-- `referred_by_contact_id` is added in 008: `accounts` and `contacts` are
-- mutually referential and 006 → 007 → 008 breaks the cycle (§5.12).
--
-- Deviations from §5.3, both approved:
--   * `outlet_id` replaces `branch text` (ADR-016)
--   * `account_reachable` check constraint (ADR-013)

create table public.accounts (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(trim(name)) >= 2),
  account_type       public.account_type not null,
  phone              text,
  phone_normalized   text generated always as (public.normalize_phone(phone)) stored,
  alt_phone          text,
  whatsapp_phone     text,
  email              text,
  email_normalized   text generated always as (lower(trim(email))) stored,
  address            text,
  city               text,
  area               text,
  source             public.lead_source not null default 'WALK_IN',
  owner_id           uuid not null references public.users(id),
  status             public.account_status not null default 'PROSPECT',
  gstin              text,
  notes              text,
  outlet_id          uuid not null references public.outlets(id),
  last_activity_at   timestamptz,
  is_imported        boolean not null default false,
  legacy_ref         text,
  import_batch_id    uuid references public.import_batches(id),
  archived_at        timestamptz,
  archived_by        uuid references public.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.users(id),

  -- ADR-013. An account with neither a phone nor an email answers none of §1.2's
  -- five questions. Service and UI validation give the friendly message; the
  -- database is what makes the rule true.
  constraint account_reachable check (phone is not null or email is not null)
);

create index accounts_owner_idx    on public.accounts (owner_id)         where archived_at is null;
create index accounts_outlet_idx   on public.accounts (outlet_id)        where archived_at is null;
create index accounts_phone_idx    on public.accounts (phone_normalized) where archived_at is null;
create index accounts_email_idx    on public.accounts (email_normalized) where archived_at is null;
create index accounts_status_idx   on public.accounts (status, account_type) where archived_at is null;
create index accounts_activity_idx on public.accounts (last_activity_at desc nulls last) where archived_at is null;
-- `phone_normalized` is deliberately NOT unique: duplicate detection is advisory
-- (§8.9) and two family members legitimately share a number.
create index accounts_name_trgm on public.accounts using gin (name extensions.gin_trgm_ops);

create trigger accounts_touch_updated_at
  before update on public.accounts
  for each row execute function public.touch_updated_at();

-- RLS on, from the moment the table exists (SPEC_AUDIT H-04). The policies
-- themselves arrive in 016, where the whole authorization model can be read at
-- once; until then this table denies everything to every role but its owner, so
-- no intermediate state of the migration sequence is readable.
alter table public.accounts enable row level security;
