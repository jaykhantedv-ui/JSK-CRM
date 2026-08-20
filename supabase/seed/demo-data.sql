-- =============================================================================
-- DEMO / TRAINING DATA — NEVER RUN AGAINST PRODUCTION.
-- =============================================================================
--
-- Synthetic data for demonstration and staff training. Every person, customer,
-- project, phone number and rupee figure below is invented. No real customer
-- data appears here and none may ever be added to this file (CLAUDE.md §15).
--
-- How it is kept unmistakable:
--   * every id begins `dd……` — `dd` for demo data, so one grep separates demo
--     rows from real ones, and no id can collide with the `00000000-…` test
--     fixtures or with production rows;
--   * every login is `@demo.jsk.local`, a reserved-by-convention domain that
--     cannot receive mail;
--   * every phone number is `99……`, a fixed synthetic sequence;
--   * the two outlets are named "Showroom A (DEMO)" and "Showroom B (DEMO)";
--   * the application shows a permanent DEMO / TRAINING DATA banner whenever
--     NEXT_PUBLIC_DEMO_MODE=1, which is the only mode this data is loaded in.
--
-- This file NEVER deletes anything. It is loaded onto a freshly reset database
-- by `scripts/demo.sh`, so a re-seed is a rebuild, not a mutation — which keeps
-- the no-hard-delete rule (CLAUDE.md §11) intact rather than carving an
-- exception into it.
--
-- Shape of the dataset (§6):
--   20 users — 1 OWNER · 1 ADMIN · 2 MANAGERs · 16 SALESPEOPLE
--    2 outlets, 8 salespeople each, 1 manager scoped to each
--   40 customers · 20 projects · 60 opportunities across all nine stages
--  ~240 activities, and sales targets for every salesperson and manager
--
-- Deliberately included so the follow-up surfaces have something to show, which
-- is the whole point of the product (§1): overdue · due today · missing next
-- action · stalled · high-value · recently won · recently lost · dormant.

-- -----------------------------------------------------------------------------
-- Guard. Loading this by hand against the wrong database must fail closed.
-- -----------------------------------------------------------------------------
do $guard$
begin
  if coalesce(current_setting('demo.i_understand', true), '') <> 'yes' then
    raise exception using
      message = 'Refusing to load DEMO / TRAINING data.',
      detail  = 'This file inserts synthetic customers and users. It must never '
                'run against production.',
      hint    = 'Load it with scripts/demo.sh, which resets the database first.';
  end if;
end
$guard$;

-- The demo password arrives from the environment via scripts/demo.sh so that no
-- credential is committed to source (§7). It is read back inside the DO blocks
-- below through current_setting().
select set_config('demo.password', coalesce(nullif(current_setting('demo.password', true), ''), 'demo'), false);

-- -----------------------------------------------------------------------------
-- Users (§15) — 1 OWNER, 1 ADMIN, 2 MANAGERs, 16 SALESPEOPLE.
-- -----------------------------------------------------------------------------
-- Inserting into auth.users fires handle_new_auth_user(), which mirrors each row
-- into public.users as an active SALESPERSON. Roles are then set the way the
-- provisioning Server Action sets them — server-side, after the row exists
-- (§3.2, ADR-009) — never by writing public.users directly first.
do $users$
declare
  v_pw       text := current_setting('demo.password', true);
  v_names    text[] := array[
    'Arun Prakash','Divya Ramesh','Karthik Subramanian','Meena Lakshmi',
    'Naveen Raj','Priyanka Devi','Suresh Babu','Vijaya Kumari',
    'Anand Krishnan','Bhavani Shankar','Gokul Nathan','Hema Malini',
    'Jagan Mohan','Kavitha Selvam','Manoj Pandian','Nithya Sree'];
  v_id       uuid;
  i          int;
begin
  -- OWNER, ADMIN and the two MANAGERs.
  insert into auth.users (id, email, aud, role, encrypted_password, email_confirmed_at, raw_user_meta_data)
  values
    ('dd000000-0000-4000-8000-000000001000','owner@demo.jsk.local','authenticated','authenticated',
     extensions.crypt(v_pw, extensions.gen_salt('bf')), now(), '{"full_name":"Jayaraman Krishnamoorthy"}'),
    ('dd000000-0000-4000-8000-000000001099','admin@demo.jsk.local','authenticated','authenticated',
     extensions.crypt(v_pw, extensions.gen_salt('bf')), now(), '{"full_name":"Deepa Anand"}'),
    ('dd000000-0000-4000-8000-000000001901','manager.a@demo.jsk.local','authenticated','authenticated',
     extensions.crypt(v_pw, extensions.gen_salt('bf')), now(), '{"full_name":"Ramesh Chandran"}'),
    ('dd000000-0000-4000-8000-000000001902','manager.b@demo.jsk.local','authenticated','authenticated',
     extensions.crypt(v_pw, extensions.gen_salt('bf')), now(), '{"full_name":"Saravanan Muthu"}');

  -- Sixteen salespeople: sales01 … sales16.
  for i in 1..16 loop
    v_id := ('dd000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid;
    insert into auth.users (id, email, aud, role, encrypted_password, email_confirmed_at, raw_user_meta_data)
    values (v_id,
            'sales' || lpad(i::text, 2, '0') || '@demo.jsk.local',
            'authenticated','authenticated',
            extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
            jsonb_build_object('full_name', v_names[i]));
  end loop;

  update public.users set role = 'OWNER'   where email = 'owner@demo.jsk.local';
  update public.users set role = 'ADMIN'   where email = 'admin@demo.jsk.local';
  update public.users set role = 'MANAGER' where email in ('manager.a@demo.jsk.local','manager.b@demo.jsk.local');

  -- Synthetic staff phone numbers, obviously a sequence: 9800000001 upward, in
  -- creation order, so no demo number can resemble a real one.
  update public.users u
     set phone = '98' || lpad(n.rn::text, 8, '0')
    from (select id, row_number() over (order by created_at, email) as rn
            from public.users) n
   where n.id = u.id;
end
$users$;

-- -----------------------------------------------------------------------------
-- Outlets and outlet scope (§15).
-- -----------------------------------------------------------------------------
-- Two outlets, matching the business today. The names are deliberately generic
-- placeholders — the OWNER renames them to the real showroom names at /settings
-- on the live server, which is a configuration edit and never a code change.
insert into public.outlets (id, code, name, city) values
  ('dd000000-0000-4000-8000-000000002001','SHA','Showroom A (DEMO)','Erode'),
  ('dd000000-0000-4000-8000-000000002002','SHB','Showroom B (DEMO)','Perundurai');

do $scope$
declare
  i int;
begin
  -- Salespeople 1–8 work Showroom A, 9–16 Showroom B.
  for i in 1..16 loop
    insert into public.user_outlets (user_id, outlet_id)
    values (('dd000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid,
            case when i <= 8 then 'dd000000-0000-4000-8000-000000002001'::uuid
                 else              'dd000000-0000-4000-8000-000000002002'::uuid end);
  end loop;

  -- Each manager is scoped to one outlet. NEITHER manager is left without a
  -- scope: a manager with no outlet rows can see no business data at all, which
  -- looks like a broken login rather than a permission decision (§15).
  insert into public.user_outlets (user_id, outlet_id) values
    ('dd000000-0000-4000-8000-000000001901','dd000000-0000-4000-8000-000000002001'),
    ('dd000000-0000-4000-8000-000000001902','dd000000-0000-4000-8000-000000002002');

  -- OWNER and ADMIN get no rows on purpose: company-wide access is a property of
  -- the role, not of outlet membership, and ADMIN carries no business-data
  -- access at all.
end
$scope$;

-- -----------------------------------------------------------------------------
-- Customers (§6) — 40 accounts across the real customer mix.
-- -----------------------------------------------------------------------------
do $accounts$
declare
  v_name    text[] := array[
    'Senthil Kumar','Lakshmi Narayanan','Bala Construction','Sri Venkateswara Builders',
    'Ravi Shankar','Anitha Rajan','Chola Interiors','Kongu Nadu Developers',
    'Murugan Textiles','Prabhu Devarajan','Vetri Architects','Amman Constructions',
    'Ganesh Moorthy','Sudha Ramakrishnan','Sakthi Promoters','Devi Interiors',
    'Rajendran Pillai','Malathi Sundaram','Annai Builders','Green Field Homes',
    'Vignesh Palanisamy','Uma Maheswari','Sri Sai Constructions','Modern Space Architects',
    'Thangavel Gounder','Revathi Krishnan','Kaveri Promoters','Elite Interiors',
    'Pandiyan Raja','Saroja Devi','Vasantham Builders','Design Studio Erode',
    'Muthukumar Swamy','Jayanthi Mohan','Sri Balaji Constructions','Urban Nest Interiors',
    'Ashok Kannan','Geetha Ravi','Cauvery Homes','Skyline Architects'];
  v_type    public.account_type[] := array[
    'HOMEOWNER','HOMEOWNER','CONTRACTOR','BUILDER',
    'HOMEOWNER','HOMEOWNER','INTERIOR_DESIGNER','BUILDER',
    'COMMERCIAL','HOMEOWNER','ARCHITECT','CONTRACTOR',
    'HOMEOWNER','HOMEOWNER','BUILDER','INTERIOR_DESIGNER',
    'HOMEOWNER','HOMEOWNER','BUILDER','BUILDER',
    'HOMEOWNER','HOMEOWNER','CONTRACTOR','ARCHITECT',
    'HOMEOWNER','HOMEOWNER','BUILDER','INTERIOR_DESIGNER',
    'HOMEOWNER','HOMEOWNER','CONTRACTOR','ARCHITECT',
    'HOMEOWNER','HOMEOWNER','BUILDER','INTERIOR_DESIGNER',
    'HOMEOWNER','HOMEOWNER','BUILDER','ARCHITECT'];
  v_city    text[] := array['Erode','Perundurai','Modakkurichi','Kodumudi','Gobichettipalayam',
                            'Sathyamangalam','Bhavani','Anthiyur','Thalavadi','Nambiyur'];
  v_area    text[] := array['Periyar Nagar','Surampatti','R.N. Pudur','Veerappanchatram','Thindal',
                            'Kasipalayam','Solar','Chithode','Nasiyanur','Karungalpalayam'];
  v_source  public.lead_source[] := array['WALK_IN','PHONE_ENQUIRY','CUSTOMER_REFERRAL','ARCHITECT_REFERRAL',
                                          'CONTRACTOR_REFERRAL','SIGNAGE','SOCIAL_MEDIA','EXISTING_CUSTOMER'];
  v_sp      int;
  v_outlet  uuid;
  v_status  public.account_status;
  v_last    timestamptz;
  i         int;
begin
  for i in 1..40 loop
    -- Round-robin across the sixteen salespeople; the account's outlet must be
    -- the owning salesperson's outlet or the manager scope would not line up.
    v_sp     := ((i - 1) % 16) + 1;
    v_outlet := case when v_sp <= 8 then 'dd000000-0000-4000-8000-000000002001'::uuid
                     else                'dd000000-0000-4000-8000-000000002002'::uuid end;

    -- A realistic spread of engagement, including genuinely dormant customers so
    -- the dormancy flag has something to find.
    v_status := case when i % 9 = 0 then 'DORMANT'
                     when i % 3 = 0 then 'PROSPECT'
                     else 'ACTIVE' end::public.account_status;
    v_last   := case when v_status = 'DORMANT' then now() - ((45 + i) || ' days')::interval
                     else now() - ((i % 21) || ' days')::interval end;

    insert into public.accounts
      (id, name, account_type, phone, whatsapp_phone, email, address, city, area,
       source, owner_id, status, notes, outlet_id, last_activity_at, created_at, created_by)
    values (
      ('dd000000-0000-4000-8000-' || lpad((3000000000 + i)::text, 12, '0'))::uuid,
      v_name[i],
      v_type[i],
      '99' || lpad(i::text, 8, '0'),
      '99' || lpad(i::text, 8, '0'),
      'customer' || lpad(i::text, 2, '0') || '@demo.jsk.local',
      v_area[((i - 1) % 10) + 1] || ', ' || v_city[((i - 1) % 10) + 1],
      v_city[((i - 1) % 10) + 1],
      v_area[((i - 1) % 10) + 1],
      v_source[((i - 1) % 8) + 1],
      ('dd000000-0000-4000-8000-' || lpad((1000 + v_sp)::text, 12, '0'))::uuid,
      v_status,
      'DEMO customer record — synthetic data for training only.',
      v_outlet,
      v_last,
      now() - ((60 + i) || ' days')::interval,
      ('dd000000-0000-4000-8000-' || lpad((1000 + v_sp)::text, 12, '0'))::uuid);
  end loop;
end
$accounts$;

-- -----------------------------------------------------------------------------
-- Contacts — the people at each account.
-- -----------------------------------------------------------------------------
-- One primary contact per account, plus a second decision-influencing contact on
-- every third account, so the influence model has something to show.
do $contacts$
declare
  v_first text[] := array['Ramesh','Sundar','Kavya','Arjun','Deepa','Mohan','Latha','Vimal',
                          'Shanthi','Ravi','Nandhini','Prakash','Yamuna','Karthi','Sneha','Ilango'];
  v_acct  record;
  v_n     int := 0;
begin
  for v_acct in
    select id, name, owner_id, account_type from public.accounts
     where id::text like 'dd%' order by id
  loop
    v_n := v_n + 1;

    insert into public.contacts
      (id, full_name, account_id, phone, email, role, influence, preferred_channel,
       notes, owner_id, created_at, created_by)
    values (
      ('dd000000-0000-4000-8000-' || lpad((7000000000 + v_n)::text, 12, '0'))::uuid,
      v_first[((v_n - 1) % 16) + 1] || ' ' || split_part(v_acct.name, ' ', 1),
      v_acct.id,
      '99' || lpad((100 + v_n)::text, 8, '0'),
      'contact' || lpad(v_n::text, 2, '0') || '@demo.jsk.local',
      case v_acct.account_type
        when 'ARCHITECT'         then 'ARCHITECT'
        when 'INTERIOR_DESIGNER' then 'INTERIOR_DESIGNER'
        when 'CONTRACTOR'        then 'CONTRACTOR'
        when 'BUILDER'           then 'BUILDER'
        else 'OWNER_BUYER' end::public.stakeholder_role,
      'DECISION_MAKER',
      case when v_n % 3 = 0 then 'WHATSAPP' else 'CALL' end::public.contact_channel,
      'DEMO contact — synthetic.',
      v_acct.owner_id,
      now() - ((55 + v_n) || ' days')::interval,
      v_acct.owner_id);

    -- A spouse or site engineer who also shapes the decision.
    if v_n % 3 = 0 then
      insert into public.contacts
        (id, full_name, account_id, phone, role, influence, preferred_channel,
         notes, owner_id, created_at, created_by)
      values (
        ('dd000000-0000-4000-8000-' || lpad((7500000000 + v_n)::text, 12, '0'))::uuid,
        v_first[((v_n + 5) % 16) + 1] || ' ' || split_part(v_acct.name, ' ', 1),
        v_acct.id,
        '99' || lpad((500 + v_n)::text, 8, '0'),
        case when v_n % 6 = 0 then 'SITE_ENGINEER' else 'SPOUSE_FAMILY' end::public.stakeholder_role,
        'STRONG_INFLUENCER',
        'CALL',
        'DEMO contact — synthetic.',
        v_acct.owner_id,
        now() - ((50 + v_n) || ' days')::interval,
        v_acct.owner_id);
    end if;
  end loop;
end
$contacts$;

-- -----------------------------------------------------------------------------
-- Projects (§6) — 20 sites across the real project mix.
-- -----------------------------------------------------------------------------
do $projects$
declare
  v_pname  text[] := array[
    'Individual House — Periyar Nagar','Villa — Thindal','Apartment Block — Surampatti',
    'Showroom Renovation — Erode Main Road','Farmhouse — Chithode','Duplex House — R.N. Pudur',
    'Hospital Wing — Perundurai','Row Houses — Nasiyanur','Bungalow — Solar',
    'Office Fit-out — Karungalpalayam','Bathroom Renovation — Veerappanchatram',
    'Apartment Project — Kasipalayam','Wedding Hall — Bhavani','School Block — Gobichettipalayam',
    'Independent House — Modakkurichi','Villa Project — Sathyamangalam',
    'Retail Store — Erode Bus Stand','Guest House — Anthiyur','Home Extension — Kodumudi',
    'Textile Unit Office — Nambiyur'];
  v_ptype  public.project_type[] := array[
    'INDIVIDUAL_HOUSE','VILLA','APARTMENT_PROJECT','RENOVATION','INDIVIDUAL_HOUSE',
    'INDIVIDUAL_HOUSE','INSTITUTIONAL','APARTMENT_PROJECT','VILLA','COMMERCIAL',
    'RENOVATION','APARTMENT_PROJECT','HOSPITALITY','INSTITUTIONAL','INDIVIDUAL_HOUSE',
    'VILLA','COMMERCIAL','HOSPITALITY','RENOVATION','COMMERCIAL'];
  v_stage  public.construction_stage[] := array[
    'FLOORING_STAGE','FINISHING','STRUCTURE','RENOVATION','BRICKWORK',
    'PLASTERING','STRUCTURE','FOUNDATION','FINISHING','RENOVATION',
    'RENOVATION','STRUCTURE','FINISHING','BRICKWORK','FLOORING_STAGE',
    'PLANNING','RENOVATION','FINISHING','RENOVATION','PLASTERING'];
  v_acct   record;
  i        int;
begin
  for i in 1..20 loop
    -- Every second account carries a project, which is how it looks in practice:
    -- plenty of walk-in enquiries never become a tracked site.
    select id, owner_id, outlet_id, city, area
      into v_acct
      from public.accounts
     where id = ('dd000000-0000-4000-8000-' || lpad((3000000000 + (i * 2 - 1))::text, 12, '0'))::uuid;

    insert into public.projects
      (id, name, account_id, project_type, construction_stage, status, site_address, city, area,
       builtup_area_sqft, floors, bathrooms, expected_flooring_date, estimated_value,
       notes, owner_id, outlet_id, created_at, created_by)
    values (
      ('dd000000-0000-4000-8000-' || lpad((4000000000 + i)::text, 12, '0'))::uuid,
      v_pname[i], v_acct.id, v_ptype[i], v_stage[i],
      case when i % 11 = 0 then 'ON_HOLD' else 'ACTIVE' end::public.project_status,
      v_acct.area || ', ' || v_acct.city, v_acct.city, v_acct.area,
      (900 + (i * 340) % 4200)::int,
      (1 + i % 3)::smallint,
      (1 + i % 4)::smallint,
      ((now() at time zone 'Asia/Kolkata')::date + ((i * 11) % 90)),
      -- Site value in paise. A modest house runs a few lakh; commercial and
      -- apartment work runs considerably more.
      (case when v_ptype[i] in ('APARTMENT_PROJECT','COMMERCIAL','INSTITUTIONAL','HOSPITALITY')
            then 150000000 + (i * 37000000) % 900000000
            else 25000000 + (i * 13000000) % 200000000 end)::bigint,
      'DEMO project — synthetic.',
      v_acct.owner_id, v_acct.outlet_id,
      now() - ((40 + i) || ' days')::interval,
      v_acct.owner_id);

    -- The primary stakeholder link (one per project — the partial unique index).
    insert into public.project_stakeholders (project_id, contact_id, role, influence, is_primary, notes, created_by)
    select ('dd000000-0000-4000-8000-' || lpad((4000000000 + i)::text, 12, '0'))::uuid,
           c.id, c.role, c.influence, true, 'DEMO stakeholder — synthetic.', v_acct.owner_id
      from public.contacts c
     where c.account_id = v_acct.id
     order by c.id
     limit 1;
  end loop;
end
$projects$;

-- -----------------------------------------------------------------------------
-- Opportunities (§6) — 60 across all nine stages.
-- -----------------------------------------------------------------------------
-- The distribution is chosen so that every follow-up surface the product exists
-- for (§1) has something real to show on the day the demo is opened:
--
--   overdue · due today · upcoming · missing next action · stalled ·
--   high-value · recently won · recently lost · dormant
--
-- Ownership is deliberately uneven. Salespeople 1 and 9 close more than
-- salespeople 4 and 12, so /team, the salesperson report and the outlet
-- comparison show a real spread instead of a flat line.
do $opps$
declare
  v_stage public.opportunity_stage[] := array[
    'new','new','new','new','new','new','new','new',
    'qualified','qualified','qualified','qualified','qualified','qualified','qualified',
    'selection','selection','selection','selection','selection','selection',
    'quoted','quoted','quoted','quoted','quoted','quoted','quoted',
    'negotiation','negotiation','negotiation','negotiation','negotiation',
    'verbal_confirmation','verbal_confirmation','verbal_confirmation',
    'nurture','nurture','nurture','nurture',
    'won','won','won','won','won','won','won','won','won','won','won','won',
    'lost','lost','lost','lost','lost','lost','lost','lost'];
  v_owner int[] := array[
    3,4,5,6,11,12,13,14,
    2,7,8,10,15,16,1,
    1,3,9,11,5,13,
    1,2,9,10,4,12,6,
    1,9,2,10,15,
    1,9,3,
    7,8,15,16,
    1,1,2,2,3,9,9,10,10,11,1,9,
    4,5,12,13,4,12,6,14];
  v_cat public.product_category[] := array['TILES','MARBLE','GRANITE','SANITARYWARE','CP_FITTINGS','MIXED','ALLIED'];
  v_lost public.lost_reason[] := array['PRICE','COMPETITOR_RELATIONSHIP','PROJECT_POSTPONED','DELIVERY_TIME',
                                       'PRICE','BUDGET_CUT','STOCK_UNAVAILABLE','SPECIFIED_OTHER_BRAND'];
  v_na  public.next_action_type[] := array['CALL','SHOWROOM_VISIT','SITE_VISIT','SEND_QUOTATION',
                                           'SHARE_SAMPLES','QUOTATION_FOLLOWUP','PRICE_DISCUSSION'];
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_acct  record;
  v_proj  uuid;
  v_o     int;    v_ai   int;    v_val bigint;  v_quoted bigint;
  v_st    public.opportunity_stage;
  v_open  boolean;
  v_nad   date;   v_nat  public.next_action_type;
  v_sc    timestamptz;   v_closed timestamptz;   v_lostn int;
  n       int;
begin
  for n in 1..60 loop
    v_st  := v_stage[n];
    v_o   := v_owner[n];
    v_open := v_st not in ('won','lost');

    -- Keep the opportunity inside its owner's outlet: pick one of the accounts
    -- that same salesperson owns (accounts round-robin over the sixteen, so each
    -- owns indices o, o+16 and o+32).
    v_ai := v_o + 16 * (n % 3);
    if v_ai > 40 then v_ai := v_o; end if;

    select a.id, a.name, a.owner_id, a.outlet_id, a.city
      into v_acct
      from public.accounts a
     where a.id = ('dd000000-0000-4000-8000-' || lpad((3000000000 + v_ai)::text, 12, '0'))::uuid;

    select p.id into v_proj from public.projects p where p.account_id = v_acct.id order by p.id limit 1;

    -- Enquiry size in paise. Anything above the configured high-value threshold
    -- (₹3,00,000) trips the high-value flag — that threshold is read from
    -- system_settings by the application and is never restated here.
    -- Skewed, the way real enquiries are: most are a room or a floor, and a
    -- minority are whole villas or commercial jobs. That keeps the high-value
    -- flag meaningful — if half the board were high-value it would mean nothing.
    v_val    := case when n % 7 = 0 then ((60 + (n * 13) % 90) * 1000000)::bigint
                     else                ((5  + (n * 7)  % 26) * 1000000)::bigint end;
    v_quoted := (v_val * 97 / 100)::bigint;

    -- Follow-up state, cycling so every case appears many times over.
    v_nat := v_na[((n - 1) % 7) + 1];
    v_nad := case (n % 5)
               when 1 then v_today - (2 + (n % 7))     -- overdue
               when 2 then v_today                     -- due today
               when 3 then v_today + (1 + (n % 6))     -- upcoming
               when 4 then null                        -- missing next action
               else        v_today + (7 + (n % 14))    -- upcoming, further out
             end;
    -- `nurture` may not sit without a date, and the pairing constraint means the
    -- action and the date are set together or not at all.
    if v_st = 'nurture' and v_nad is null then v_nad := v_today + 21; end if;
    if v_nad is null then v_nat := null; end if;

    -- A handful sit far longer in one stage than the configured stall threshold.
    v_sc := case when n % 7 = 0 then now() - ((30 + n) || ' days')::interval
                 else now() - ((n % 9) || ' days')::interval end;

    v_closed := case
                  when not v_open and n % 4 = 0 then now() - ((1 + n % 12) || ' days')::interval  -- recently closed
                  when not v_open              then now() - ((20 + n % 40) || ' days')::interval
                  else null end;

    v_lostn := ((n - 53) % 8) + 1;

    insert into public.opportunities
      (id, title, account_id, project_id, owner_id, stage, category, material_notes,
       estimated_quantity, quantity_unit, estimated_value, quoted_value, final_order_value,
       order_reference, expected_close_date, next_action, next_action_date, next_action_note,
       quotation_ref, quotation_date, quotation_status, quotation_valid_until,
       competitor, lost_reason, lost_detail, closed_at, stage_changed_at, last_activity_at,
       source, outlet_id, created_at, created_by)
    values (
      ('dd000000-0000-4000-8000-' || lpad((5000000000 + n)::text, 12, '0'))::uuid,
      initcap(replace(v_cat[((n - 1) % 7) + 1]::text, '_', ' ')) || ' — ' || v_acct.name,
      v_acct.id, v_proj,
      ('dd000000-0000-4000-8000-' || lpad((1000 + v_o)::text, 12, '0'))::uuid,
      v_st, v_cat[((n - 1) % 7) + 1],
      'DEMO enquiry — synthetic. Customer looking at ' ||
        lower(replace(v_cat[((n - 1) % 7) + 1]::text, '_', ' ')) || ' options.',
      (120 + (n * 37) % 1800)::numeric,
      case when v_cat[((n - 1) % 7) + 1] in ('SANITARYWARE','CP_FITTINGS') then 'NOS' else 'SQFT' end::public.quantity_unit,
      v_val,
      -- Everything from `quoted` onward carries a quotation, which is what makes
      -- quote-to-order conversion measurable.
      case when v_st in ('quoted','negotiation','verbal_confirmation','won') then v_quoted
           when v_st = 'lost' and n % 2 = 0 then v_quoted else null end,
      case when v_st = 'won' then (v_quoted * 96 / 100)::bigint else null end,
      case when v_st = 'won' then 'DEMO-SO-' || lpad(n::text, 4, '0') else null end,
      case when v_open then v_today + (10 + (n % 45)) else null end,
      -- A closed opportunity carries no next action, and the pairing constraint
      -- means the action and its date are cleared together.
      case when v_open then v_nat else null end,
      case when v_open then v_nad else null end,
      case when v_open and v_nad is not null then 'DEMO — follow up as agreed.' else null end,
      case when v_st in ('quoted','negotiation','verbal_confirmation','won')
             or (v_st = 'lost' and n % 2 = 0) then 'DEMO-QT-' || lpad(n::text, 4, '0') else null end,
      case when v_st in ('quoted','negotiation','verbal_confirmation','won')
             or (v_st = 'lost' and n % 2 = 0) then v_today - (5 + n % 20) else null end,
      case when v_st = 'won' then 'ACCEPTED'
           when v_st = 'lost' and n % 2 = 0 then 'REJECTED'
           when v_st = 'negotiation' then 'UNDER_DISCUSSION'
           when v_st in ('quoted','verbal_confirmation') then 'SENT'
           else 'NONE' end::public.quotation_status,
      case when v_st in ('quoted','negotiation','verbal_confirmation') then v_today + (15 - n % 10) else null end,
      case when n % 6 = 0 then 'DEMO Competitor Tiles' else null end,
      case when v_st = 'lost' then v_lost[greatest(v_lostn, 1)] else null end,
      case when v_st = 'lost' then 'DEMO — synthetic loss note.' else null end,
      v_closed,
      v_sc,
      -- Most were touched in the last fortnight; every eleventh has gone quiet
      -- for well over the configured dormancy window, which is exactly the
      -- forgotten follow-up the product exists to surface (§1).
      case when n % 11 = 0 then now() - ((40 + n) || ' days')::interval
           else                now() - ((n % 16) || ' days')::interval end,
      case when n % 4 = 0 then 'CUSTOMER_REFERRAL' when n % 5 = 0 then 'ARCHITECT_REFERRAL'
           when n % 3 = 0 then 'PHONE_ENQUIRY' else 'WALK_IN' end::public.lead_source,
      v_acct.outlet_id,
      now() - ((35 + n) || ' days')::interval,
      ('dd000000-0000-4000-8000-' || lpad((1000 + v_o)::text, 12, '0'))::uuid);
  end loop;
end
$opps$;

-- -----------------------------------------------------------------------------
-- Activities — the follow-up history behind the pipeline.
-- -----------------------------------------------------------------------------
-- Four per opportunity, walking backwards from the most recent contact, mixing
-- every channel the business actually uses. `account_id` is always populated,
-- even though the activity hangs off an opportunity, so the Customer 360 timeline
-- stays a single indexed query (CLAUDE.md §12).
do $acts$
declare
  v_type    public.activity_type[] := array['CALL','WHATSAPP','SHOWROOM_VISIT','SITE_VISIT','MEETING','EMAIL','NOTE'];
  v_purpose public.activity_purpose[] := array['ENQUIRY','FOLLOW_UP','PRODUCT_DISCUSSION','SITE_MEASUREMENT',
                                               'SAMPLE_HANDOVER','QUOTATION_DISCUSSION','PRICE_NEGOTIATION',
                                               'ORDER_CONFIRMATION','RELATIONSHIP'];
  v_summary text[] := array[
    'Customer called about tile options for the hall. Shared catalogue on WhatsApp.',
    'Sent product photos and current offer over WhatsApp. Customer reviewing with family.',
    'Customer visited the showroom and shortlisted three designs.',
    'Site visit done. Took floor measurements and discussed skirting.',
    'Met the architect along with the customer to agree the finish.',
    'Emailed the revised quotation with the updated discount.',
    'Note: customer wants delivery only after the plastering is finished.',
    'Follow-up call — customer asked for a small price revision.',
    'Handed over marble samples for approval at site.',
    'Discussed payment terms and expected delivery window.'];
  v_out     public.activity_outcome[] := array['POSITIVE','NEUTRAL','POSITIVE','NO_RESPONSE','NEUTRAL','NEGATIVE','RESCHEDULED'];
  o         record;
  v_contact uuid;
  k         int;
  seq       int := 0;
begin
  for o in
    select id, account_id, project_id, owner_id, stage, created_at, last_activity_at
      from public.opportunities where id::text like 'dd%' order by id
  loop
    select c.id into v_contact from public.contacts c
      where c.account_id = o.account_id order by c.id limit 1;

    for k in 0..3 loop
      seq := seq + 1;
      insert into public.activities
        (id, account_id, opportunity_id, project_id, contact_id, type, purpose, outcome,
         summary, occurred_at, duration_minutes, location_note, performed_by, created_at, created_by)
      values (
        ('dd000000-0000-4000-8000-' || lpad((6000000000 + seq)::text, 12, '0'))::uuid,
        o.account_id, o.id, o.project_id, v_contact,
        v_type[((seq - 1) % 7) + 1],
        v_purpose[((seq - 1) % 9) + 1],
        v_out[((seq - 1) % 7) + 1],
        'DEMO — ' || v_summary[((seq - 1) % 10) + 1],
        -- Walk backwards from the opportunity's own last-contact date, so the
        -- timeline and the dormancy flag tell the same story — but never before
        -- the opportunity itself existed.
        greatest(o.last_activity_at - ((k * 9 + (seq % 5)) || ' days')::interval,
                 o.created_at + interval '1 hour'),
        (10 + (seq * 7) % 50)::smallint,
        case when v_type[((seq - 1) % 7) + 1] = 'SITE_VISIT' then 'DEMO site, Erode District' else null end,
        o.owner_id,
        greatest(o.last_activity_at - ((k * 9) || ' days')::interval,
                 o.created_at + interval '1 hour'),
        o.owner_id);
    end loop;
  end loop;
end
$acts$;

-- -----------------------------------------------------------------------------
-- Sales targets — so target-vs-actual has a denominator.
-- -----------------------------------------------------------------------------
-- One outlet target and one per-salesperson target for the current month and the
-- two before it. A per-user target must always carry its outlet, which the check
-- constraint enforces.
do $targets$
declare
  v_month date;
  m       int;
  i       int;
  v_outlet uuid;
begin
  for m in 0..2 loop
    v_month := date_trunc('month', ((now() at time zone 'Asia/Kolkata')::date - (m * 30))::timestamptz)::date;

    insert into public.sales_targets (id, period_month, outlet_id, user_id, target_paise, note, created_by)
    values
      (('dd000000-0000-4000-8000-' || lpad((8000000000 + m * 100)::text, 12, '0'))::uuid,
       v_month, 'dd000000-0000-4000-8000-000000002001', null, 80000000, 'DEMO outlet target.',
       'dd000000-0000-4000-8000-000000001000'),
      (('dd000000-0000-4000-8000-' || lpad((8000000000 + m * 100 + 1)::text, 12, '0'))::uuid,
       v_month, 'dd000000-0000-4000-8000-000000002002', null, 65000000, 'DEMO outlet target.',
       'dd000000-0000-4000-8000-000000001000');

    for i in 1..16 loop
      v_outlet := case when i <= 8 then 'dd000000-0000-4000-8000-000000002001'::uuid
                       else              'dd000000-0000-4000-8000-000000002002'::uuid end;
      insert into public.sales_targets (id, period_month, outlet_id, user_id, target_paise, note, created_by)
      values (('dd000000-0000-4000-8000-' || lpad((8000000000 + m * 100 + 10 + i)::text, 12, '0'))::uuid,
              v_month, v_outlet,
              ('dd000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid,
              (15000000 + (i % 5) * 5000000)::bigint,
              'DEMO salesperson target.',
              'dd000000-0000-4000-8000-000000001000');
    end loop;
  end loop;
end
$targets$;

-- -----------------------------------------------------------------------------
-- What was loaded.
-- -----------------------------------------------------------------------------
do $report$
declare r record;
begin
  raise notice '--- DEMO / TRAINING DATA loaded ---';
  for r in
    select 'users' as t, count(*) from public.users where id::text like 'dd%'
    union all select 'outlets',       count(*) from public.outlets       where id::text like 'dd%'
    union all select 'accounts',      count(*) from public.accounts      where id::text like 'dd%'
    union all select 'contacts',      count(*) from public.contacts      where id::text like 'dd%'
    union all select 'projects',      count(*) from public.projects      where id::text like 'dd%'
    union all select 'opportunities', count(*) from public.opportunities where id::text like 'dd%'
    union all select 'activities',    count(*) from public.activities    where id::text like 'dd%'
    union all select 'sales_targets', count(*) from public.sales_targets where id::text like 'dd%'
  loop
    raise notice '  % : %', rpad(r.t, 14), r.count;
  end loop;
end
$report$;
