-- 020 — global search (§11.10) and advisory duplicate detection (§8.9)
--
-- Both are SECURITY INVOKER, which is the whole security story: they read the
-- business tables as the caller, so every policy in 016 applies and a record the
-- caller may not see is simply not in the result. There is no "search index" to
-- keep in sync with the permission model, and therefore no way for the two to
-- drift apart. **Never expose an inaccessible record** is not a filter written
-- here — it is a consequence of not bypassing RLS.
--
-- Injection: every value arrives as a bound parameter, so a query string is data
-- and can never become SQL. The one place a user string reaches an operator is
-- the `ilike` pattern, and `%`, `_` and `\` are escaped before it is built, so a
-- query of `%` matches the literal character rather than everything. §19.4
-- requires a test for this and there is one.
--
-- Both functions are bounded by an explicit limit. §12.8: no unbounded list
-- query anywhere.

-- Escape a user string for use inside a `like`/`ilike` pattern.
create or replace function public.like_escape(raw text) returns text
language sql immutable strict parallel safe
set search_path = ''
as $$ select replace(replace(replace(raw, '\', '\\'), '%', '\%'), '_', '\_') $$;

comment on function public.like_escape(text) is
  'Escapes \, %% and _ so a user search string cannot act as a pattern (§19.4).';

-- ------------------------------------------------------------------ search ----
-- §11.10 order, expressed as `rank`:
--   1  exact phone on accounts and contacts
--   2  account name
--   3  project name
--   4  opportunity title
--   5  contact name
--
-- A numeric query of four or more digits is treated as a phone fragment, which
-- is how a salesperson actually searches — they remember the last few digits.
-- `score` is trigram similarity, so within a rank the closest name comes first.
create or replace function public.search_crm(
  p_query text,
  p_limit integer default 20
) returns table (
  entity   text,
  id       uuid,
  title    text,
  subtitle text,
  rank     integer,
  score    real
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_q      text    := trim(coalesce(p_query, ''));
  v_digits text    := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  v_like   text;
  v_phone  text;
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  -- §11.10 — minimum three characters. Below that every query matches half the
  -- database and the result is noise, not a search.
  if length(v_q) < 3 then
    return;
  end if;

  v_like  := '%' || public.like_escape(v_q) || '%';
  v_phone := case when length(v_digits) >= 4 then '%' || v_digits || '%' else null end;

  return query
  with matches as (
    -- 1 — phone, on accounts and on contacts
    select 'account'::text as entity, a.id, a.name as title,
           concat_ws(' · ', a.account_type::text, a.city, a.phone) as subtitle,
           1 as rank, 1.0::real as score
      from public.accounts a
     where v_phone is not null and a.archived_at is null
       and a.phone_normalized like v_phone

    union all
    select 'contact', c.id, c.full_name,
           concat_ws(' · ', c.role::text, c.phone),
           1, 1.0::real
      from public.contacts c
     where v_phone is not null and c.archived_at is null
       and c.phone_normalized like v_phone

    -- 2 — account name
    union all
    select 'account', a.id, a.name,
           concat_ws(' · ', a.account_type::text, a.city, a.phone),
           2, extensions.similarity(a.name, v_q)
      from public.accounts a
     where a.archived_at is null
       and (a.name ilike v_like or extensions.similarity(a.name, v_q) >= 0.3)

    -- 3 — project name
    union all
    select 'project', p.id, p.name,
           concat_ws(' · ', p.project_type::text, p.city, p.construction_stage::text),
           3, extensions.similarity(p.name, v_q)
      from public.projects p
     where p.archived_at is null
       and (p.name ilike v_like or extensions.similarity(p.name, v_q) >= 0.3)

    -- 4 — opportunity title
    union all
    select 'opportunity', o.id, o.title,
           concat_ws(' · ', o.stage::text, o.category::text),
           4, extensions.similarity(o.title, v_q)
      from public.opportunities o
     where o.archived_at is null
       and (o.title ilike v_like or extensions.similarity(o.title, v_q) >= 0.3)

    -- 5 — contact name
    union all
    select 'contact', c.id, c.full_name,
           concat_ws(' · ', c.role::text, c.phone),
           5, extensions.similarity(c.full_name, v_q)
      from public.contacts c
     where c.archived_at is null
       and (c.full_name ilike v_like or extensions.similarity(c.full_name, v_q) >= 0.3)
  ),
  -- One row per record: an account matching on both phone and name is one
  -- result, at its strongest rank.
  best as (
    select distinct on (m.entity, m.id) m.*
      from matches m
     order by m.entity, m.id, m.rank, m.score desc
  )
  select b.entity, b.id, b.title, b.subtitle, b.rank, b.score
    from best b
   order by b.rank, b.score desc nulls last, b.title
   limit v_limit;
end
$$;

-- -------------------------------------------------------------- duplicates ----
-- §8.9. **Advisory. Never merges. Never blocks.** The service turns `signal`
-- into a confidence level and the UI turns confidence into a warning the user
-- may click past.
--
-- The similarity thresholds are PARAMETERS, not literals in this file. §8.9
-- states them once and `lib/duplicates.ts` holds them once; passing them in is
-- what keeps that true — a threshold defined here as well would be the same
-- number in two places, free to drift.
create or replace function public.find_account_duplicates(
  p_name_city_threshold real,
  p_name_only_threshold real,
  p_phone      text default null,
  p_email      text default null,
  p_name       text default null,
  p_city       text default null,
  p_exclude_id uuid default null,
  p_limit      integer default 10
) returns table (
  id              uuid,
  name            text,
  account_type    public.account_type,
  phone           text,
  email           text,
  city            text,
  status          public.account_status,
  owner_id        uuid,
  signal          text,
  name_similarity real
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_phone text    := public.normalize_phone(coalesce(p_phone, ''));
  v_email text    := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_name  text    := nullif(trim(coalesce(p_name, '')), '');
  v_city  text    := nullif(lower(trim(coalesce(p_city, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  return query
  with candidates as (
    select a.*,
           case
             when v_phone is not null and a.phone_normalized = v_phone then 'PHONE'
             when v_email is not null and a.email_normalized = v_email then 'EMAIL'
             when v_name is not null and v_city is not null
                  and lower(trim(coalesce(a.city, ''))) = v_city
                  and extensions.similarity(a.name, v_name) >= p_name_city_threshold then 'NAME_CITY'
             when v_name is not null
                  and extensions.similarity(a.name, v_name) >= p_name_only_threshold then 'NAME'
           end as signal,
           case when v_name is not null then extensions.similarity(a.name, v_name) else null end as sim
      from public.accounts a
     where a.archived_at is null
       and (p_exclude_id is null or a.id <> p_exclude_id)
  )
  select c.id, c.name, c.account_type, c.phone, c.email, c.city, c.status, c.owner_id,
         c.signal, c.sim
    from candidates c
   where c.signal is not null
   -- Strongest signal first, then closest name: the exact phone match belongs at
   -- the top of the warning card.
   order by array_position(array['PHONE','EMAIL','NAME_CITY','NAME'], c.signal),
            c.sim desc nulls last, c.name
   limit v_limit;
end
$$;

-- §15.1 — revoke from anon, grant to authenticated.
revoke execute on function
  public.like_escape(text),
  public.search_crm(text, integer),
  public.find_account_duplicates(real, real, text, text, text, text, uuid, integer)
from public, anon;

grant execute on function
  public.like_escape(text),
  public.search_crm(text, integer),
  public.find_account_duplicates(real, real, text, text, text, text, uuid, integer)
to authenticated, service_role;
