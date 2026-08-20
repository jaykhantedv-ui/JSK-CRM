-- Data-quality report (§28).
--
-- Read-only, always. §28 is explicit: do not silently mutate data to make a check
-- pass. Every query below REPORTS; none of them repairs. A row that shows up here
-- is a conversation with the business owner, not a row to quietly UPDATE.
--
-- Run:  psql "$DATABASE_URL" -f scripts/data-quality.sql
\pset pager off

\echo '=============================================='
\echo ' JSK CRM — data quality report'
\echo '=============================================='
\echo ''

\echo '-- 1. Orphaned records ------------------------'
select 'opportunity → missing account' as issue, count(*) as rows from opportunities o
  left join accounts a on a.id = o.account_id where a.id is null
union all
select 'opportunity → missing project', count(*) from opportunities o
  left join projects p on p.id = o.project_id where o.project_id is not null and p.id is null
union all
select 'contact → missing account', count(*) from contacts c
  left join accounts a on a.id = c.account_id where a.id is null
union all
select 'activity → missing account', count(*) from activities ac
  left join accounts a on a.id = ac.account_id where a.id is null
union all
select 'event → missing opportunity', count(*) from opportunity_events e
  left join opportunities o on o.id = e.opportunity_id where o.id is null
union all
select 'stakeholder → missing project', count(*) from project_stakeholders s
  left join projects p on p.id = s.project_id where p.id is null;

\echo ''
\echo '-- 2. Invalid owner references ----------------'
select 'opportunity.owner_id not a user' as issue, count(*) as rows from opportunities o
  left join users u on u.id = o.owner_id where o.owner_id is not null and u.id is null
union all
select 'opportunity owned by an INACTIVE user', count(*) from opportunities o
  join users u on u.id = o.owner_id
  where not u.is_active and o.archived_at is null and o.closed_at is null
union all
select 'activity.performed_by not a user', count(*) from activities a
  left join users u on u.id = a.performed_by where a.performed_by is not null and u.id is null;

\echo ''
\echo '-- 3. Invalid outlet references ---------------'
select 'user_outlets → missing outlet' as issue, count(*) as rows from user_outlets uo
  left join outlets o on o.id = uo.outlet_id where o.id is null
union all
select 'user_outlets → missing user', count(*) from user_outlets uo
  left join users u on u.id = uo.user_id where u.id is null
union all
select 'account.outlet_id not an outlet', count(*) from accounts a
  left join outlets o on o.id = a.outlet_id where a.outlet_id is not null and o.id is null
union all
select 'MANAGER with no outlet scope (sees only own records)', count(*) from users u
  where u.role = 'MANAGER' and u.is_active
    and not exists (select 1 from user_outlets uo
                    where uo.user_id = u.id and uo.revoked_at is null);

\echo ''
\echo '-- 4. Duplicate primary stakeholders ----------'
-- The partial unique index makes this impossible; the check exists so that if the
-- index is ever dropped by a bad migration, the damage is visible immediately.
select project_id, count(*) as primary_stakeholders
from project_stakeholders where is_primary group by project_id having count(*) > 1;

\echo ''
\echo '-- 5. Malformed settings ----------------------'
select key,
       case
         -- Named first, BEFORE the '%_days' pattern below: `stage_stall_days` is
         -- keyed by stage rather than being a single number, and the suffix rule
         -- would otherwise claim it and report a correct value as malformed.
         when key in ('stage_probabilities','stage_stall_days','owner_summary_schedule')
           then case when jsonb_typeof(value) = 'object' then 'ok' else 'EXPECTED A JSON OBJECT' end
         when key in ('cities','material_types')
           then case when jsonb_typeof(value) = 'array' then 'ok' else 'EXPECTED A JSON ARRAY' end
         when key like '%_days' or key like '%_hours' or key like '%_paise'
           then case when jsonb_typeof(value) = 'number' then 'ok' else 'EXPECTED A NUMBER' end
         else 'ok'
       end as verdict
from system_settings
where key not in (
  -- Operational state written by the maintenance cron, not business config.
  'maintenance_consecutive_failures','maintenance_last_failure_at')
order by 1;

\echo ''
\echo '-- 5b. Settings still awaiting business input --'
-- Not a defect: a legitimately empty list the owner has not filled in yet. It is
-- reported because an empty `material_types` silently removes a field's options
-- from every enquiry form, which looks like a bug to a salesperson.
select key, 'EMPTY — needs configuring before launch' as note
from system_settings
where jsonb_typeof(value) = 'array' and jsonb_array_length(value) = 0;

\echo ''
\echo '-- 6. Impossible won/lost states --------------'
-- The check constraints forbid all of these. Zero rows is the expected result;
-- a non-zero row means a constraint was dropped or bypassed.
select 'WON without final_order_value' as issue, count(*) as rows from opportunities
  where stage = 'won' and final_order_value is null
union all
select 'WON without closed_at', count(*) from opportunities
  where stage = 'won' and closed_at is null
union all
select 'LOST without lost_reason', count(*) from opportunities
  where stage = 'lost' and lost_reason is null
union all
select 'LOST without closed_at', count(*) from opportunities
  where stage = 'lost' and closed_at is null
union all
select 'open opportunity that has closed_at', count(*) from opportunities
  where stage not in ('won','lost') and closed_at is not null
union all
-- ADR-006: the binding trio is ref + value + date. The uploaded PDF is optional,
-- so its absence is not a defect and is deliberately not checked here.
select 'quoted without a quotation ref/value/date', count(*) from opportunities
  where stage = 'quoted'
    and (quotation_ref is null or quoted_value is null or quotation_date is null);

\echo ''
\echo '-- 7. Missing required values -----------------'
select 'account unreachable (no phone and no contact)' as issue, count(*) as rows
  from accounts a where a.archived_at is null
    and coalesce(a.phone,'') = ''
    and not exists (select 1 from contacts c
                    where c.account_id = a.id and c.archived_at is null)
union all
select 'opportunity with no next action and not closed', count(*) from opportunities
  where archived_at is null and closed_at is null
    and next_action_date is null and stage not in ('won','lost')
union all
select 'contact with neither phone nor email', count(*) from contacts
  where archived_at is null and coalesce(phone,'') = '' and coalesce(email,'') = '';

\echo ''
\echo '-- 8. Archived records leaking into live data --'
-- An archived parent with live children is the shape that makes an archived
-- account keep contributing to pipeline value (§11).
select 'live opportunity under an ARCHIVED account' as issue, count(*) as rows
  from opportunities o join accounts a on a.id = o.account_id
  where a.archived_at is not null and o.archived_at is null
union all
select 'live project under an ARCHIVED account', count(*)
  from projects p join accounts a on a.id = p.account_id
  where a.archived_at is not null and p.archived_at is null
union all
select 'live contact under an ARCHIVED account', count(*)
  from contacts c join accounts a on a.id = c.account_id
  where a.archived_at is not null and c.archived_at is null
union all
select 'archived_at set but archived_by null', count(*)
  from accounts where archived_at is not null and archived_by is null;

\echo ''
\echo '-- 9. Imported records -----------------------'
select 'import row → missing batch' as issue, count(*) as rows from import_rows r
  left join import_batches b on b.id = r.batch_id where b.id is null
union all
select 'account marked imported with no batch', count(*) from accounts
  where import_batch_id is not null
    and not exists (select 1 from import_batches b where b.id = accounts.import_batch_id)
union all
select 'account flagged is_imported with no batch id', count(*) from accounts
  where is_imported and import_batch_id is null;

\echo ''
\echo '-- 10. Audit trail completeness ---------------'
select 'opportunity with NO events at all' as issue, count(*) as rows from opportunities o
  where not exists (select 1 from opportunity_events e where e.opportunity_id = o.id)
union all
select 'event with no actor recorded', count(*) from opportunity_events
  where actor_id is null;

\echo ''
\echo '=============================================='
\echo ' End of report. Any non-zero row above is a'
\echo ' finding to raise, never a row to quietly fix.'
\echo '=============================================='
