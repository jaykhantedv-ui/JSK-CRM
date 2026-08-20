-- 026 — import provenance on `contacts` (§20.5)
--
-- DEFECT FOUND IN MASTER PHASE 4, FIXED FORWARD.
--
-- §20.5 requires every row an import creates to carry `is_imported`,
-- `import_batch_id` and `legacy_ref`. `accounts` has all three (migration 006).
-- `contacts` — which §20.2 makes one of the two V1 import entities, with
-- `legacy_ref` right there in its template — has none of them. Without these
-- columns an imported contact is indistinguishable from one a salesperson typed,
-- which means §20.6's rollback cannot find it and the seven-day undo silently
-- covers only half of what was imported.
--
-- A NEW MIGRATION, NOT AN EDIT TO 007. Migrations are append-only once applied to
-- any shared environment (§21.2), and H-03 says the same thing about the import
-- schema specifically: extend it with a new number, never by editing.
--
-- `is_imported` is more than provenance. It is what keeps a customer copied out
-- of a 2019 paper register from entering the new-enquiry SLA queue as though
-- somebody had failed to answer them within 48 hours (§20.5, ADR-025) — a
-- durable column rather than a transaction-local flag, because the cron that
-- would send the alert runs an hour after the import transaction has gone.

alter table public.contacts
  add column if not exists is_imported     boolean not null default false,
  add column if not exists legacy_ref      text,
  add column if not exists import_batch_id uuid references public.import_batches(id);

comment on column public.contacts.is_imported is
  'Created by a historical import (§20.5). Excluded from new-enquiry automation (ADR-025).';
comment on column public.contacts.legacy_ref is
  'The register, page or system reference this contact came from (§20.2).';
comment on column public.contacts.import_batch_id is
  'The batch that created this row. What makes §20.6 rollback able to find it.';

-- Rollback and the maintenance exclusion both scan by batch; without this they
-- are a sequential scan of every contact in the business.
create index if not exists contacts_import_batch_idx
  on public.contacts (import_batch_id) where import_batch_id is not null;

-- The same index on `accounts`, which 006 defined the columns without. Rollback
-- reads both tables by `import_batch_id` and only one of them was indexed for it.
create index if not exists accounts_import_batch_idx
  on public.accounts (import_batch_id) where import_batch_id is not null;
