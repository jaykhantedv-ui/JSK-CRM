-- 007 — contacts (§5.4)
--
-- A simple homeowner does NOT need a contact row; the account carries the phone.
-- Contacts exist for the additional people on a project. The UI must never force
-- contact creation for a one-person account.

create table public.contacts (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text not null,
  account_id         uuid references public.accounts(id) on delete set null,
  linked_account_id  uuid references public.accounts(id) on delete set null,
  phone              text,
  phone_normalized   text generated always as (public.normalize_phone(phone)) stored,
  alt_phone          text,
  email              text,
  role               public.stakeholder_role not null default 'OTHER',
  influence          public.influence_level not null default 'INFLUENCER',
  preferred_channel  public.contact_channel not null default 'CALL',
  is_referral_source boolean not null default false,
  notes              text,
  owner_id           uuid not null references public.users(id),
  archived_at        timestamptz,
  archived_by        uuid references public.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.users(id),

  constraint contact_reachable check (phone is not null or email is not null)
);

create index contacts_account_idx  on public.contacts (account_id) where archived_at is null;
create index contacts_linked_idx   on public.contacts (linked_account_id);
create index contacts_phone_idx    on public.contacts (phone_normalized);
create index contacts_owner_idx    on public.contacts (owner_id);
create index contacts_referral_idx on public.contacts (is_referral_source) where is_referral_source;
create index contacts_name_trgm    on public.contacts using gin (full_name extensions.gin_trgm_ops);

create trigger contacts_touch_updated_at
  before update on public.contacts
  for each row execute function public.touch_updated_at();

-- RLS on, from the moment the table exists (SPEC_AUDIT H-04). The policies
-- themselves arrive in 016, where the whole authorization model can be read at
-- once; until then this table denies everything to every role but its owner, so
-- no intermediate state of the migration sequence is readable.
alter table public.contacts enable row level security;
