-- 008 — close the accounts ↔ contacts cycle (§5.12)

alter table public.accounts
  add column referred_by_contact_id uuid references public.contacts(id) on delete set null;

create index accounts_referred_by_idx on public.accounts (referred_by_contact_id);
