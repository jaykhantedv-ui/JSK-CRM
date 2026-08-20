-- 030 — populate `material_types` with the launch taxonomy (TODO-BD-04, amended).
--
-- TODO-BD-04 resolved on 2026-08-19 that V1 models no slab or lot entity, and
-- seeded `material_types` as `[]` on the reasoning that the `material_notes`
-- autocomplete accepts free text anyway. Launch QA found the practical cost of
-- that: an autocomplete backed by an empty list offers nothing, so every
-- salesperson types the category by hand and the free text fragments into
-- "vitrified", "Vitrified tiles", "vit. tile" — exactly the normalisation problem
-- the controlled list exists to prevent.
--
-- The Project Owner amended the decision on 2026-08-20 to seed a starter
-- taxonomy. The substance of TODO-BD-04 is unchanged: **no slab entity, no
-- product catalogue and no SKU system.** This is a list of strings backing an
-- autocomplete that still accepts free text. See /docs/DECISIONS.md TODO-BD-04.
--
-- Why a new migration rather than an edit to 014: 014 has been applied, and an
-- applied migration is never edited (CLAUDE.md §17, §21.2).
--
-- Why `where value = '[]'`: the list is editable at /settings by OWNER and ADMIN.
-- If an admin has already curated it, this migration must not overwrite their
-- work — it fills the gap and does nothing else. That also makes it idempotent,
-- so `db reset` twice and a re-run against a live database behave identically.
--
-- This is the settings seed, which is the ONE place such a value may appear. It
-- must never be mirrored into a constant, a default parameter, a component
-- fallback or a test fixture the application reads (CLAUDE.md §3).

update public.system_settings
   set value = '["Tiles","Marble","Granite","Sanitaryware","CP Fittings","Bathroom Accessories","Vitrified Tiles","Wall Tiles","Floor Tiles","Kitchen Sinks","Bathroom Fittings","Adhesives & Grouts"]'::jsonb
 where key = 'material_types'
   and value = '[]'::jsonb;

comment on table public.system_settings is
  'The only place a TODO-BD value may appear. Read through services/settings.service.ts (§5.10).';
