-- DEVELOPMENT AND TEST FIXTURES — NEVER RUN AGAINST STAGING OR PRODUCTION.
--
-- This is the fixture set the integration and RLS suites assert against. It is
-- shaped to make the outlet permission model falsifiable (ADR-016, ADR-017):
--
--   THREE outlets, so "a manager assigned to A and C" is distinguishable from
--   "a manager who can see everything".
--   A manager with ONE outlet, a manager with TWO, and a manager with NONE.
--   An OWNER with no outlet rows at all, to prove company-wide access is a
--   property of the role and not of membership.
--   An ADMIN, to prove system administration carries no business-data access.
--   A work-context case: an account owned by one salesperson carrying an
--   opportunity owned by another (§3.2).
--   A deactivated user, to prove `is_active = false` closes the database boundary
--   and not merely the login screen.
--
-- The password below is a DEVELOPMENT credential for a throwaway local database.
-- It is not a secret, and no environment that matters ever loads this file.

-- Deterministic ids so tests can reference rows without a lookup round-trip.
-- 1xxx users · 2xxx outlets · 3xxx accounts · 4xxx projects · 5xxx opportunities

insert into auth.users (id, email, aud, role, encrypted_password, email_confirmed_at, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-000000001001','owner@jsk.test',       'authenticated','authenticated', extensions.crypt('devpassword', extensions.gen_salt('bf')), now(), '{"full_name":"Owner"}'),
  ('00000000-0000-4000-8000-000000001002','admin@jsk.test',       'authenticated','authenticated', extensions.crypt('devpassword', extensions.gen_salt('bf')), now(), '{"full_name":"Admin"}'),
  ('00000000-0000-4000-8000-000000001003','manager.a@jsk.test',   'authenticated','authenticated', extensions.crypt('devpassword', extensions.gen_salt('bf')), now(), '{"full_name":"Manager A"}'),
  ('00000000-0000-4000-8000-000000001004','manager.ac@jsk.test',  'authenticated','authenticated', extensions.crypt('devpassword', extensions.gen_salt('bf')), now(), '{"full_name":"Manager AC"}'),
  ('00000000-0000-4000-8000-000000001005','manager.none@jsk.test','authenticated','authenticated', extensions.crypt('devpassword', extensions.gen_salt('bf')), now(), '{"full_name":"Manager None"}'),
  ('00000000-0000-4000-8000-000000001006','sales.a1@jsk.test',    'authenticated','authenticated', extensions.crypt('devpassword', extensions.gen_salt('bf')), now(), '{"full_name":"Sales A One"}'),
  ('00000000-0000-4000-8000-000000001007','sales.a2@jsk.test',    'authenticated','authenticated', extensions.crypt('devpassword', extensions.gen_salt('bf')), now(), '{"full_name":"Sales A Two"}'),
  ('00000000-0000-4000-8000-000000001008','sales.b1@jsk.test',    'authenticated','authenticated', extensions.crypt('devpassword', extensions.gen_salt('bf')), now(), '{"full_name":"Sales B One"}'),
  ('00000000-0000-4000-8000-000000001009','sales.gone@jsk.test',  'authenticated','authenticated', extensions.crypt('devpassword', extensions.gen_salt('bf')), now(), '{"full_name":"Sales Deactivated"}');

-- `handle_new_auth_user()` has already mirrored each row into public.users as an
-- active SALESPERSON. Roles are set the way the provisioning Server Action sets
-- them: server-side, after the row exists.
update public.users set role = 'OWNER'   where email = 'owner@jsk.test';
update public.users set role = 'ADMIN'   where email = 'admin@jsk.test';
update public.users set role = 'MANAGER' where email in ('manager.a@jsk.test','manager.ac@jsk.test','manager.none@jsk.test');
update public.users set is_active = false where email = 'sales.gone@jsk.test';

insert into public.outlets (id, code, name, city) values
  ('00000000-0000-4000-8000-000000002001','ERD','Erode Main','Erode'),
  ('00000000-0000-4000-8000-000000002002','PRN','Perundurai','Perundurai'),
  ('00000000-0000-4000-8000-000000002003','GOB','Gobichettipalayam','Gobichettipalayam');

-- Outlet scope. OWNER and ADMIN get no rows on purpose.
insert into public.user_outlets (user_id, outlet_id)
values
  ('00000000-0000-4000-8000-000000001003','00000000-0000-4000-8000-000000002001'), -- manager.a  → A
  ('00000000-0000-4000-8000-000000001004','00000000-0000-4000-8000-000000002001'), -- manager.ac → A
  ('00000000-0000-4000-8000-000000001004','00000000-0000-4000-8000-000000002003'), -- manager.ac → C
  ('00000000-0000-4000-8000-000000001006','00000000-0000-4000-8000-000000002001'),
  ('00000000-0000-4000-8000-000000001007','00000000-0000-4000-8000-000000002001'),
  ('00000000-0000-4000-8000-000000001008','00000000-0000-4000-8000-000000002002');
-- manager.none deliberately has none.

insert into public.accounts (id, name, account_type, phone, owner_id, outlet_id, city) values
  ('00000000-0000-4000-8000-000000003001','Ravi Kumar','HOMEOWNER','+91 98430 11111','00000000-0000-4000-8000-000000001006','00000000-0000-4000-8000-000000002001','Erode'),
  ('00000000-0000-4000-8000-000000003002','Lakshmi Constructions','CONTRACTOR','9843022222','00000000-0000-4000-8000-000000001007','00000000-0000-4000-8000-000000002001','Erode'),
  ('00000000-0000-4000-8000-000000003003','Bhavani Builders','BUILDER','9843033333','00000000-0000-4000-8000-000000001008','00000000-0000-4000-8000-000000002002','Perundurai'),
  ('00000000-0000-4000-8000-000000003004','Gobi Residency','COMMERCIAL','9843044444','00000000-0000-4000-8000-000000001006','00000000-0000-4000-8000-000000002003','Gobichettipalayam');

insert into public.projects (id, name, account_id, project_type, owner_id, outlet_id) values
  ('00000000-0000-4000-8000-000000004001','Ravi House Flooring','00000000-0000-4000-8000-000000003001','INDIVIDUAL_HOUSE','00000000-0000-4000-8000-000000001006','00000000-0000-4000-8000-000000002001'),
  ('00000000-0000-4000-8000-000000004002','Lakshmi Site 4','00000000-0000-4000-8000-000000003002','APARTMENT_PROJECT','00000000-0000-4000-8000-000000001007','00000000-0000-4000-8000-000000002001'),
  ('00000000-0000-4000-8000-000000004003','Bhavani Tower B','00000000-0000-4000-8000-000000003003','APARTMENT_PROJECT','00000000-0000-4000-8000-000000001008','00000000-0000-4000-8000-000000002002');

insert into public.opportunities (id, title, account_id, project_id, owner_id, outlet_id, category, estimated_value) values
  ('00000000-0000-4000-8000-000000005001','Ravi house — tiles','00000000-0000-4000-8000-000000003001','00000000-0000-4000-8000-000000004001','00000000-0000-4000-8000-000000001006','00000000-0000-4000-8000-000000002001','TILES',45000000),
  ('00000000-0000-4000-8000-000000005002','Lakshmi site 4 — granite','00000000-0000-4000-8000-000000003002','00000000-0000-4000-8000-000000004002','00000000-0000-4000-8000-000000001007','00000000-0000-4000-8000-000000002001','GRANITE',120000000),
  ('00000000-0000-4000-8000-000000005003','Bhavani tower B — sanitaryware','00000000-0000-4000-8000-000000003003','00000000-0000-4000-8000-000000004003','00000000-0000-4000-8000-000000001008','00000000-0000-4000-8000-000000002002','SANITARYWARE',80000000),
  -- WORK CONTEXT: account and project belong to sales.a2, this opportunity to
  -- sales.a1. sales.a1 must be able to read the parent account and project
  -- without owning either (§3.2, §15.4).
  ('00000000-0000-4000-8000-000000005004','Lakshmi site 4 — allied','00000000-0000-4000-8000-000000003002','00000000-0000-4000-8000-000000004002','00000000-0000-4000-8000-000000001006','00000000-0000-4000-8000-000000002001','ALLIED',15000000),
  -- Outlet C, owned by a salesperson posted to outlet A: proves record scope is
  -- the record's outlet, not the owner's posting.
  ('00000000-0000-4000-8000-000000005005','Gobi residency — mixed','00000000-0000-4000-8000-000000003004',null,'00000000-0000-4000-8000-000000001006','00000000-0000-4000-8000-000000002003','MIXED',60000000);

insert into public.contacts (id, full_name, account_id, phone, role, owner_id) values
  ('00000000-0000-4000-8000-000000006001','Meena Ravi','00000000-0000-4000-8000-000000003001','9843055555','SPOUSE_FAMILY','00000000-0000-4000-8000-000000001006'),
  ('00000000-0000-4000-8000-000000006002','Arun Architect','00000000-0000-4000-8000-000000003003','9843066666','ARCHITECT','00000000-0000-4000-8000-000000001008');

insert into public.activities (id, account_id, opportunity_id, type, summary, performed_by) values
  ('00000000-0000-4000-8000-000000007001','00000000-0000-4000-8000-000000003001','00000000-0000-4000-8000-000000005001','CALL','Discussed tile selection for the hall.','00000000-0000-4000-8000-000000001006'),
  ('00000000-0000-4000-8000-000000007002','00000000-0000-4000-8000-000000003003','00000000-0000-4000-8000-000000005003','SITE_VISIT','Measured bathrooms on floors 3 and 4.','00000000-0000-4000-8000-000000001008');
