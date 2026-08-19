-- 001 — extensions and shared helpers (§5.0, §5.12)

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "pg_trgm"  with schema extensions;

-- Normalise an Indian phone number to its trailing ten digits (§5.3).
-- Strips every non-digit, which removes spaces, dashes and brackets, and drops a
-- leading +91 / 91 / 0 as a side effect of taking the last ten digits. Returns
-- null when fewer than ten digits remain, so a partial number never masquerades
-- as a match in duplicate detection (§8.9).
--
-- IMMUTABLE is a hard requirement: `accounts.phone_normalized` and
-- `contacts.phone_normalized` are generated stored columns and PostgreSQL will
-- not accept a volatile or stable function there.
create or replace function public.normalize_phone(raw text) returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select case
           when length(regexp_replace(raw, '\D', '', 'g')) < 10 then null
           else right(regexp_replace(raw, '\D', '', 'g'), 10)
         end
$$;

comment on function public.normalize_phone(text) is
  'Trailing ten digits of an Indian phone number, or null if fewer than ten digits remain (§5.3).';

-- `updated_at` is maintained by a trigger, never by the application (§5.0).
create or replace function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;
