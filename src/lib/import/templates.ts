/**
 * Import templates (§20.2).
 *
 * **The historical books are still on paper.** These templates exist so the
 * business can produce a file when it is ready; nothing here assumes a file
 * already exists (§20).
 *
 * V1 imports accounts and contacts only (TODO-BD-10). `import_batches.entity`
 * already accepts `projects` and `opportunities`, and `import_rows.raw` is jsonb,
 * so adding those later needs no schema change — but no part of this module
 * pretends they are available today.
 */

export const IMPORT_ENTITIES = ['accounts', 'contacts'] as const
export type ImportEntity = (typeof IMPORT_ENTITIES)[number]

export type TemplateColumn = {
  name: string
  required: boolean
  description: string
}

/**
 * §20.2's accounts template, plus two optional columns the schema requires that
 * §20.2 predates.
 *
 * `outlet_code` — `accounts.outlet_id` is `not null`, and ADR-016 replaced §5.3's
 * free-text `branch` with a real outlet reference after §20.2 was written. Left
 * blank, the row inherits the owner's current outlet, which is the answer for
 * almost every historical record; supplying it covers a record that belongs
 * somewhere else. Recorded in `/docs/DECISIONS.md`.
 */
export const ACCOUNT_TEMPLATE_COLUMNS: readonly TemplateColumn[] = [
  { name: 'name', required: true, description: 'Customer or company name.' },
  {
    name: 'account_type',
    required: true,
    description: 'HOMEOWNER, CONTRACTOR, BUILDER, ARCHITECT, INTERIOR_DESIGNER, DEALER, COMMERCIAL, MASON or OTHER.',
  },
  { name: 'phone', required: false, description: 'Ten-digit mobile. Required if there is no email.' },
  { name: 'email', required: false, description: 'Required if there is no phone.' },
  { name: 'address', required: false, description: 'Street address.' },
  { name: 'city', required: false, description: 'One of the configured taluks. Anything else imports with a warning.' },
  { name: 'area', required: false, description: 'Locality within the taluk.' },
  { name: 'source', required: false, description: 'How the customer arrived. Defaults to OTHER for historical records.' },
  { name: 'owner_email', required: true, description: 'The salesperson who owns this customer. Must be an active user.' },
  { name: 'status', required: false, description: 'PROSPECT, ACTIVE, DORMANT or DO_NOT_CONTACT. Defaults to PROSPECT.' },
  { name: 'notes', required: false, description: 'Free text.' },
  { name: 'legacy_ref', required: false, description: 'The register or page number this came from.' },
  { name: 'outlet_code', required: false, description: "Outlet code. Defaults to the owner's outlet." },
]

/**
 * §20.2's contacts template, plus `owner_email` as an optional column.
 *
 * `contacts.owner_id` is `not null` and §20.2's contact template has no owner
 * column. Left blank the contact inherits the owner of the account it links to,
 * and failing that the person running the import — never an invented user.
 */
export const CONTACT_TEMPLATE_COLUMNS: readonly TemplateColumn[] = [
  { name: 'full_name', required: true, description: "The person's name." },
  { name: 'phone', required: false, description: 'Ten-digit mobile. Required if there is no email.' },
  { name: 'email', required: false, description: 'Required if there is no phone.' },
  {
    name: 'account_phone',
    required: false,
    description: 'Phone of the customer this person belongs to. Must match an existing customer.',
  },
  { name: 'role', required: false, description: 'ARCHITECT, CONTRACTOR, SPOUSE_FAMILY, … Defaults to OTHER.' },
  { name: 'influence', required: false, description: 'DECISION_MAKER, INFLUENCER, … Defaults to INFLUENCER.' },
  { name: 'is_referral_source', required: false, description: 'yes / no.' },
  { name: 'notes', required: false, description: 'Free text.' },
  { name: 'legacy_ref', required: false, description: 'The register or page number this came from.' },
  { name: 'owner_email', required: false, description: "Defaults to the linked customer's owner." },
]

export function templateColumnsFor(entity: ImportEntity): readonly TemplateColumn[] {
  return entity === 'accounts' ? ACCOUNT_TEMPLATE_COLUMNS : CONTACT_TEMPLATE_COLUMNS
}

/**
 * A downloadable template: the header row and nothing else.
 *
 * **No sample row.** A fixture that ships looks like data, and a business
 * importing its customer list must not find "Ravi Kumar" in it (CLAUDE.md §15).
 */
export function templateCsv(entity: ImportEntity): string {
  return `${templateColumnsFor(entity)
    .map((column) => column.name)
    .join(',')}\r\n`
}
