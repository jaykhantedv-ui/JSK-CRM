-- 011 — opportunities (§5.7), the central table
--
-- THE DATABASE ENFORCES THE BUSINESS RULES. The check constraints below are the
-- backbone of data quality: a bug in the service layer cannot produce a won
-- opportunity with no value, or a quoted opportunity with no quotation reference.
-- If one of them blocks a legitimate flow, the FLOW is wrong.
--
-- Deviations from §5.7, both approved:
--   * `outlet_id` replaces `branch text` (ADR-016)
--   * `sla_notified_at` — per-opportunity SLA notification state, so §14.2's
--     reminder fires once instead of every hour forever (ADR-002)

create table public.opportunities (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  account_id            uuid not null references public.accounts(id) on delete restrict,
  project_id            uuid references public.projects(id) on delete set null,
  -- Nullable: 'unassigned' is a genuine state the manager dashboard surfaces (§13.3).
  owner_id              uuid references public.users(id),
  stage                 public.opportunity_stage not null default 'new',
  category              public.product_category not null,
  material_notes        text,
  estimated_quantity    numeric(12,2) check (estimated_quantity is null or estimated_quantity >= 0),
  quantity_unit         public.quantity_unit,
  estimated_value       bigint not null check (estimated_value >= 0),
  quoted_value          bigint check (quoted_value is null or quoted_value >= 0),
  final_order_value     bigint check (final_order_value is null or final_order_value >= 0),
  order_reference       text,
  expected_close_date   date,
  next_action           public.next_action_type,
  next_action_date      date,
  next_action_note      text,
  quotation_ref         text,
  quotation_date        date,
  quotation_status      public.quotation_status not null default 'NONE',
  quotation_valid_until date,
  competitor            text,
  lost_reason           public.lost_reason,
  lost_detail           text,
  closed_at             timestamptz,
  stage_changed_at      timestamptz not null default now(),
  last_activity_at      timestamptz,
  sla_notified_at       timestamptz,
  source                public.lead_source not null default 'WALK_IN',
  outlet_id             uuid not null references public.outlets(id),
  is_imported           boolean not null default false,
  legacy_ref            text,
  import_batch_id       uuid references public.import_batches(id),
  archived_at           timestamptz,
  archived_by           uuid references public.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.users(id),

  constraint won_requires_value   check (stage <> 'won'  or final_order_value is not null),
  constraint won_requires_closed  check (stage <> 'won'  or closed_at is not null),
  constraint lost_requires_reason check (stage <> 'lost' or lost_reason is not null),
  constraint lost_requires_closed check (stage <> 'lost' or closed_at is not null),
  -- ADR-006: binding on `quoted` ONLY. `selection → negotiation` is a legal
  -- transition (§9.2) and §9.1 states no entry requirement for `negotiation`, so
  -- salespeople must not be forced to invent quotation data to enter it.
  constraint quoted_requires_quotation check (
    stage <> 'quoted'
    or (quotation_ref is not null and quoted_value is not null and quotation_date is not null)),
  constraint next_action_pairing check (
    (next_action is null and next_action_date is null)
    or (next_action is not null and next_action_date is not null)),
  constraint nurture_needs_date check (stage <> 'nurture' or next_action_date is not null)
);

create index opportunities_owner_stage_idx on public.opportunities (owner_id, stage) where archived_at is null;
create index opportunities_account_idx     on public.opportunities (account_id)  where archived_at is null;
create index opportunities_project_idx     on public.opportunities (project_id)  where archived_at is null;
create index opportunities_outlet_idx      on public.opportunities (outlet_id)   where archived_at is null;
create index opportunities_next_action_idx on public.opportunities (next_action_date) where archived_at is null;
create index opportunities_stage_idx       on public.opportunities (stage, stage_changed_at) where archived_at is null;
create index opportunities_close_idx       on public.opportunities (expected_close_date) where archived_at is null;
create index opp_unassigned on public.opportunities (created_at)
  where owner_id is null and archived_at is null;
create index opp_missing_next_action on public.opportunities (owner_id)
  where next_action_date is null and archived_at is null and stage not in ('won','lost');

create trigger opportunities_touch_updated_at
  before update on public.opportunities
  for each row execute function public.touch_updated_at();

-- RLS on, from the moment the table exists (SPEC_AUDIT H-04). The policies
-- themselves arrive in 016, where the whole authorization model can be read at
-- once; until then this table denies everything to every role but its owner, so
-- no intermediate state of the migration sequence is readable.
alter table public.opportunities enable row level security;
