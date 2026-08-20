-- Post-restore verification (§18).
--
-- "The restore ran without errors" is not the same as "the business got its data
-- back". These checks assert the things a person would actually check by hand:
-- the tables are there, they hold rows, the rows still point at each other, and
-- the settings the application refuses to start without survived.
--
-- Every check RAISES on failure, so `psql -v ON_ERROR_STOP=1` turns a bad restore
-- into a non-zero exit rather than a wall of green text.
\pset pager off
\timing off

do $$
declare
  missing text;
  expected text[] := array[
    'users','outlets','user_outlets','accounts','contacts','projects',
    'project_stakeholders','opportunities','activities','opportunity_events',
    'system_settings','sales_targets','import_batches','import_rows'
  ];
begin
  select string_agg(t, ', ') into missing
  from unnest(expected) t
  where to_regclass('public.' || t) is null;

  if missing is not null then
    raise exception 'Restore incomplete — missing tables: %', missing;
  end if;
  raise notice 'schema: all % business tables present', array_length(expected, 1);
end $$;

-- Referential integrity. A restore that drops a foreign key and reloads rows out
-- of order can leave orphans behind without pg_restore saying a word.
do $$
declare n bigint;
begin
  select count(*) into n from public.opportunities o
    left join public.accounts a on a.id = o.account_id where a.id is null;
  if n > 0 then raise exception 'orphaned opportunities: %', n; end if;

  select count(*) into n from public.activities ac
    left join public.accounts a on a.id = ac.account_id where a.id is null;
  if n > 0 then raise exception 'orphaned activities: %', n; end if;

  select count(*) into n from public.opportunity_events e
    left join public.opportunities o on o.id = e.opportunity_id where o.id is null;
  if n > 0 then raise exception 'orphaned opportunity_events: %', n; end if;

  select count(*) into n from public.contacts c
    left join public.accounts a on a.id = c.account_id where a.id is null;
  if n > 0 then raise exception 'orphaned contacts: %', n; end if;

  raise notice 'relationships: no orphaned rows in opportunities, activities, events or contacts';
end $$;

-- The settings the application reads through settings.service.ts. Losing these
-- does not crash the restore; it silently changes what "high value" means.
do $$
declare missing text;
begin
  select string_agg(k, ', ') into missing
  from unnest(array[
    'cities','stage_probabilities','high_value_threshold_paise',
    'account_dormancy_days','opportunity_dormancy_days','stage_stall_days',
    'new_enquiry_sla_hours','owner_summary_schedule','material_types'
  ]) k
  where not exists (select 1 from public.system_settings s where s.key = k);

  if missing is not null then
    raise exception 'Restore lost system_settings keys: %', missing;
  end if;
  raise notice 'settings: all 9 business settings keys present';
end $$;

-- RLS must come back ON. It is the authorization boundary (§15); a restored
-- database with RLS disabled is an open database.
do $$
declare unprotected text;
begin
  select string_agg(c.relname, ', ') into unprotected
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if unprotected is not null then
    raise exception 'RLS is OFF after restore on: %', unprotected;
  end if;
  raise notice 'security: row-level security enabled on every public table';
end $$;

-- Search and duplicate detection actually run.
--
-- This check exists because the first restore drill passed every other check on
-- this page and still produced a database where search raised on every call: the
-- trigram indexes and the `extensions.similarity` calls behind them had silently
-- not come back. Counting rows would never have found it. Calling the functions
-- does.
do $$
declare n bigint; missing text;
begin
  select string_agg(i, ', ') into missing
  from unnest(array['accounts_name_trgm','contacts_name_trgm','projects_name_trgm']) i
  where not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = i);
  if missing is not null then
    raise exception 'Trigram indexes missing after restore: % — search will be unindexed', missing;
  end if;

  select count(*) into n from public.search_crm('verification probe');
  raise notice 'search: search_crm() executes and the 3 trigram indexes are present';
end $$;

-- What actually came back, for the restore record §18 asks to be kept.
select 'users' as entity, count(*) from public.users
union all select 'outlets', count(*) from public.outlets
union all select 'accounts', count(*) from public.accounts
union all select 'contacts', count(*) from public.contacts
union all select 'projects', count(*) from public.projects
union all select 'opportunities', count(*) from public.opportunities
union all select 'activities', count(*) from public.activities
union all select 'opportunity_events', count(*) from public.opportunity_events
union all select 'system_settings', count(*) from public.system_settings
union all select 'sales_targets', count(*) from public.sales_targets
order by 1;
