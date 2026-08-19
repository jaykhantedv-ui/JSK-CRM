-- 014 — system settings (§5.10)
--
-- THE ONLY PLACE ANY OF THESE VALUES MAY APPEAR. Every one of them is read
-- through `services/settings.service.ts` and never hard-coded in application
-- code — not as a constant, not as a default parameter, not as a component
-- fallback, not as a test fixture the application reads. Resolution of the twelve
-- TODO-BD decisions fixed the values; it did not licence a constant (CLAUDE.md §3).
--
-- Changing any of these is an edit at /settings. It must never require a deploy.

create table public.system_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users(id)
);

create trigger system_settings_touch_updated_at
  before update on public.system_settings
  for each row execute function public.touch_updated_at();

insert into public.system_settings (key, value, description) values

  -- TODO-BD-06, FINAL. Erode District, Tamil Nadu — the ten official REVENUE
  -- TALUKS. The key is named `cities` because §5.10 names it so; it holds taluks.
  -- Chennimalai is a development block and firka within Perundurai taluk and
  -- belongs in `area`, never here. Lower-level units are free text in V1 — do not
  -- invent geographic units.
  ('cities',
   '["Erode","Perundurai","Modakkurichi","Kodumudi","Gobichettipalayam","Sathyamangalam","Bhavani","Anthiyur","Thalavadi","Nambiyur"]',
   'Controlled list for account and project city. Erode District revenue taluks (TODO-BD-06).'),

  ('stage_probabilities',
   '{"new":10,"qualified":25,"selection":40,"quoted":60,"negotiation":75,"verbal_confirmation":90,"nurture":5,"won":100,"lost":0}',
   'Stage to percentage, for Weighted Pipeline (§7.2).'),

  -- TODO-BD-02: Rs 3,00,000. Money is bigint paise everywhere (§8.11).
  ('high_value_threshold_paise', '30000000',
   'Manager escalation threshold in paise (TODO-BD-02).'),

  -- ADR-010 split the specification's single `dormancy_days` into two, because one
  -- value was serving two business meanings that will not stay equal.
  -- `dormancy_days` is RETIRED and must never be seeded.
  ('account_dormancy_days', '30',
   'Days without activity before an account is flagged DORMANT (§14.6, ADR-010).'),
  ('opportunity_dormancy_days', '30',
   'Days without activity before an opportunity is flagged dormant (§13.1, ADR-010).'),

  ('stage_stall_days',
   '{"new":3,"qualified":14,"selection":21,"quoted":10,"negotiation":14,"verbal_confirmation":10}',
   'Days in one stage before the opportunity is flagged stalled (TODO-BD-03).'),

  ('new_enquiry_sla_hours', '48',
   'Hours before an untouched new opportunity is flagged (§14.2).'),

  -- TODO-BD-05 / ADR-011. Vercel cron schedules are static in vercel.json, so the
  -- route fires hourly and gates on this value — changing the hour never needs a
  -- deployment, which is the rule §24 exists to protect.
  ('owner_summary_schedule', '{"cadence":"daily","hour":19}',
   'Owner summary cadence and Asia/Kolkata hour (TODO-BD-05, ADR-011).'),

  ('material_types', '[]',
   'Marble/granite material list backing the material_notes autocomplete (TODO-BD-04).'),

  -- ADR-014. Operational state, not configuration, and deliberately not editable
  -- at /settings. Written only by the nightly maintenance cron route.
  ('maintenance_consecutive_failures', '0',
   'Consecutive failed maintenance runs. Written only by the maintenance cron (ADR-014).'),
  ('maintenance_last_failure_at', 'null',
   'When the most recent maintenance failure occurred, ISO 8601 or null (ADR-014).');

-- RLS on, from the moment the table exists (SPEC_AUDIT H-04). The policies
-- themselves arrive in 016, where the whole authorization model can be read at
-- once; until then this table denies everything to every role but its owner, so
-- no intermediate state of the migration sequence is readable.
alter table public.system_settings enable row level security;
