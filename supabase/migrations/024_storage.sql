-- 024 — private file storage (§15.6, §17.5, ADR-005)
--
-- Bucket `crm-files`, PRIVATE. There are no public URLs anywhere in this system:
-- a customer's site photographs and quotation PDFs are business records, and a
-- public object URL is a permanent unauthenticated link to one.
--
-- Path convention, exactly:
--     {account|project|opportunity|activity}/{entity_id}/{uuid}-{filename}
--
-- THE PATH IS THE AUTHORIZATION KEY. A file is readable by exactly the people who
-- can read the entity it hangs off, and that is decided here — in a policy on
-- `storage.objects` — rather than in the service that issues signed URLs. The
-- service checks visibility too (ADR-005 requires the check BEFORE the upload URL
-- is issued), but a service check is a convenience; this is the control. A signed
-- URL obtained by any other route still hits these policies.
--
-- No DELETE policy, consistent with the rest of the schema (CLAUDE.md §11). A
-- file that should no longer be shown is removed from the row that references it;
-- the object itself is not destroyed by a user action.

-- ------------------------------------------------------------- the bucket ----
-- `on conflict do nothing` because a Supabase project may already have the bucket
-- created through the dashboard; the migration must be applyable either way.
--
-- The size limit is declared here as well as validated in the service. 10 MB is
-- §15.6's number and this is a platform-enforced backstop for it: a caller that
-- somehow reaches Storage without passing through the service still cannot store
-- a 40 MB file. MIME types are deliberately NOT constrained here — the allow-list
-- is enforced by the magic-byte check in `lib/files.ts`, because the MIME type
-- Storage sees is the one the client claimed, and trusting it is precisely the
-- mistake §15.6 forbids.
insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-files', 'crm-files', false, 10485760)
on conflict (id) do nothing;

-- ------------------------------------------------------- path authorization ----
-- A path segment that is not a uuid must answer "no", not raise. An object name
-- is attacker-controlled input: `account/not-a-uuid/x.pdf` reaching a bare cast
-- would abort the statement with a database error instead of refusing the read.
create or replace function public.safe_uuid(p_text text) returns uuid
language plpgsql immutable parallel safe
set search_path = ''
as $$
begin
  return p_text::uuid;
exception
  when invalid_text_representation then
    return null;
end
$$;

comment on function public.safe_uuid(text) is
  'Cast to uuid or null. For parsing attacker-controlled storage paths without raising (§15.6).';

-- The activity read rule, matching `activities_select` in 016: an activity is
-- visible to whoever can read its parent account.
create or replace function public.can_read_activity(p_activity uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.activities a
    where a.id = p_activity and public.can_read_account(a.account_id)
  )
$$;

comment on function public.can_read_activity(uuid) is
  'Mirrors activities_select: an activity is visible to whoever can read its account (§15.5).';

-- Read authorization for one object path.
--
-- Unknown entity type, malformed uuid, missing entity — all false. There is no
-- default-allow branch, so a path shape nobody anticipated is refused rather than
-- served.
create or replace function public.can_read_storage_path(p_name text) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_kind text := split_part(p_name, '/', 1);
  v_id   uuid := public.safe_uuid(split_part(p_name, '/', 2));
begin
  if v_id is null then
    return false;
  end if;

  return case v_kind
    when 'account'     then public.can_read_account(v_id)
    when 'project'     then public.can_read_project(v_id)
    when 'opportunity' then public.can_read_opportunity(v_id)
    when 'activity'    then public.can_read_activity(v_id)
    else false
  end;
end
$$;

comment on function public.can_read_storage_path(text) is
  'Storage read rule: a file is visible to exactly whoever can see the entity in its path (§15.6).';

-- Write authorization.
--
-- Deliberately the same rule as reading rather than a looser "any authenticated
-- user may INSERT" (§15.6's literal wording). A user who cannot see an
-- opportunity has no business putting a file into its folder: that would let any
-- salesperson write into any manager's record, and the object would then be
-- readable by everyone entitled to that record. Visibility of the parent is the
-- narrower rule and the one ADR-005 already requires the service to apply before
-- issuing an upload URL; applying it here too means the two cannot drift apart.
create or replace function public.can_write_storage_path(p_name text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.can_read_storage_path(p_name)
$$;

comment on function public.can_write_storage_path(text) is
  'Storage write rule: identical to the read rule — you may only write into a folder you can see (ADR-005).';

-- ------------------------------------------------------------- the policies ----
-- Scoped to `crm-files` by `bucket_id`, so a bucket added later for an unrelated
-- purpose does not silently inherit the CRM's rules.
drop policy if exists crm_files_select on storage.objects;
create policy crm_files_select on storage.objects for select to authenticated
  using (bucket_id = 'crm-files' and public.can_read_storage_path(name));

drop policy if exists crm_files_insert on storage.objects;
create policy crm_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-files' and public.can_write_storage_path(name));

-- UPDATE covers the overwrite half of an upsert. Same rule; no widening.
drop policy if exists crm_files_update on storage.objects;
create policy crm_files_update on storage.objects for update to authenticated
  using (bucket_id = 'crm-files' and public.can_write_storage_path(name))
  with check (bucket_id = 'crm-files' and public.can_write_storage_path(name));

-- NO DELETE POLICY. Not an omission (CLAUDE.md §11).

-- --------------------------------------------------------- quotation files ----
-- §8.6: quotation fields on the opportunity "plus a PDF in Storage". §4.2 rejects
-- an attachments metadata table, so the path list lives on the row that owns it —
-- exactly as `activities.attachment_paths` already does for site-visit photos.
--
-- No quotation table, no version table, no line items (§8.6, §21 of the phase
-- brief). An array of object paths is the whole feature.
alter table public.opportunities
  add column if not exists quotation_file_paths text[] not null default '{}';

comment on column public.opportunities.quotation_file_paths is
  'Storage object paths for quotation PDFs (§8.6). No metadata table in V1 (§4.2).';

-- `v_opportunity_flags` is defined as `select o.*, …`, and PostgreSQL EXPANDS that
-- star at creation time. A column added to `opportunities` afterwards does not
-- appear in the view — silently, with no error anywhere — so every screen reading
-- the opportunity through the flags view would be missing its quotation files.
--
-- Recreated here, in the same migration that adds the column, so the schema is
-- coherent at every step of the sequence. The definition is otherwise unchanged
-- from 017, `security_invoker = true` very much included: a view without it runs
-- with the definer's rights and publishes every salesperson's pipeline to every
-- other salesperson (§25).
drop view if exists public.v_opportunity_flags;

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

revoke execute on function
  public.safe_uuid(text),
  public.can_read_activity(uuid),
  public.can_read_storage_path(text),
  public.can_write_storage_path(text)
from public, anon;

grant execute on function
  public.safe_uuid(text),
  public.can_read_activity(uuid),
  public.can_read_storage_path(text),
  public.can_write_storage_path(text)
to authenticated, service_role;
