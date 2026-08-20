-- 017 — derived accountability states (§10.3)
--
-- Derived values are COMPUTED IN QUERIES, NEVER STORED (§5.7). This view is the
-- single definition of them, so `is_overdue` cannot come to mean two things in
-- two screens.
--
-- `security_invoker = true` IS NOT OPTIONAL. A view created without it runs with
-- the definer's rights and silently bypasses row-level security, which would
-- publish every salesperson's pipeline to every other salesperson (§25).
--
-- THE BUSINESS DAY IS Asia/Kolkata, NOT THE DATABASE SESSION TIMEZONE. Supabase
-- sessions run in UTC, so a bare `current_date` is wrong for five and a half hours
-- of every day — between 18:30 and 24:00 IST it still reads as yesterday, and the
-- overdue list is silently wrong every single evening (SPEC_AUDIT B-10).
--
-- Dormancy and stall thresholds are NOT baked in here: they come from
-- `system_settings` and are applied in the query layer (§10.3).
create view public.v_opportunity_flags
with (security_invoker = true) as
select
  o.*,
  (o.stage not in ('won','lost'))           as is_active,
  (o.stage not in ('won','lost','nurture')) as in_pipeline,
  coalesce(o.stage not in ('won','lost')
           and o.next_action_date < (now() at time zone 'Asia/Kolkata')::date, false) as is_overdue,
  coalesce(o.stage not in ('won','lost')
           and o.next_action_date = (now() at time zone 'Asia/Kolkata')::date, false) as is_due_today,
  coalesce(o.stage not in ('won','lost')
           and o.next_action_date is null, false)                                     as is_missing_next_action,
  coalesce(o.owner_id is null
           and o.stage not in ('won','lost'), false)                                  as is_unassigned,
  ((now() at time zone 'Asia/Kolkata')::date
     - (o.stage_changed_at at time zone 'Asia/Kolkata')::date)                        as days_in_stage,
  ((now() at time zone 'Asia/Kolkata')::date
     - (coalesce(o.last_activity_at, o.created_at) at time zone 'Asia/Kolkata')::date) as days_since_activity
from public.opportunities o
where o.archived_at is null;

grant select on public.v_opportunity_flags to authenticated, service_role;
