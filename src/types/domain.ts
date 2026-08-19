import type { Database } from './database.types'

/**
 * Domain aliases over the generated database types (§18).
 *
 * `database.types.ts` is generated from the real database and never hand-edited.
 * This file gives the rest of the application readable names for what is in it,
 * and is the only place a table's row shape is renamed.
 */

type Public = Database['public']
type TableRow<T extends keyof Public['Tables']> = Public['Tables'][T]['Row']

export type Enums = Public['Enums']

export type UserRole = Enums['user_role']
export type AccountType = Enums['account_type']
export type AccountStatus = Enums['account_status']
export type OpportunityStage = Enums['opportunity_stage']
export type ProductCategory = Enums['product_category']
export type ActivityType = Enums['activity_type']
export type NextActionType = Enums['next_action_type']
export type LeadSource = Enums['lead_source']
export type LostReason = Enums['lost_reason']
export type OpportunityEventType = Enums['opportunity_event_type']
export type StakeholderRole = Enums['stakeholder_role']
export type InfluenceLevel = Enums['influence_level']
export type ProjectType = Enums['project_type']
export type ProjectStatus = Enums['project_status']
export type ConstructionStage = Enums['construction_stage']
export type ActivityPurpose = Enums['activity_purpose']
export type ActivityOutcome = Enums['activity_outcome']
export type QuotationStatus = Enums['quotation_status']
export type QuantityUnit = Enums['quantity_unit']
export type ContactChannel = Enums['contact_channel']

export type UserRow = TableRow<'users'>
export type OutletRow = TableRow<'outlets'>
export type UserOutletRow = TableRow<'user_outlets'>
export type AccountRow = TableRow<'accounts'>
export type ContactRow = TableRow<'contacts'>
export type ProjectRow = TableRow<'projects'>
export type ProjectStakeholderRow = TableRow<'project_stakeholders'>
export type OpportunityRow = TableRow<'opportunities'>
export type ActivityRow = TableRow<'activities'>
export type OpportunityEventRow = TableRow<'opportunity_events'>
export type SystemSettingRow = TableRow<'system_settings'>
export type ImportBatchRow = TableRow<'import_batches'>
export type ImportRowRow = TableRow<'import_rows'>

/** `v_opportunity_flags` (§10.3) — the derived accountability states. */
export type OpportunityFlagsRow = Public['Views']['v_opportunity_flags']['Row']

/**
 * A stakeholder row with the person or company it points at, resolved.
 *
 * Lives here rather than beside the service that builds it because the panel
 * that renders it is a Client Component. A type-only import is erased at build
 * time and leaks nothing, but keeping the type here means no client module has a
 * reason to name a service module at all (CLAUDE.md §7).
 */
export type StakeholderWithTarget = ProjectStakeholderRow & {
  contact: Pick<ContactRow, 'id' | 'full_name' | 'phone' | 'email'> | null
  account: { id: string; name: string; phone: string | null } | null
}

/**
 * A user with their outlet scope resolved. This is what services and Server
 * Components receive, and what `lib/permissions.ts` reasons about.
 */
export type SessionUser = {
  id: string
  email: string
  fullName: string
  role: UserRole
  isActive: boolean
  outletIds: string[]
}
