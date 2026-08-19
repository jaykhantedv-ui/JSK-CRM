import type { Database } from '@/types/database.types'

/**
 * Human labels for every enum the CRM renders (§12.1).
 *
 * **The UI never prints a raw enum value.** `VERBAL_CONFIRMATION` is a database
 * value; "Verbal confirmation" is what a salesperson reads. Keeping the mapping
 * in one file is what stops two screens calling the same stage different things.
 *
 * §2.4 — terminology discipline. The word **"Revenue" must never appear**. Value
 * is Pipeline Value, Won Value or Weighted Pipeline, and nothing here says
 * otherwise.
 */

type Enums = Database['public']['Enums']

export const STAGE_LABELS: Record<Enums['opportunity_stage'], string> = {
  new: 'New',
  qualified: 'Qualified',
  selection: 'Selection',
  quoted: 'Quoted',
  negotiation: 'Negotiation',
  verbal_confirmation: 'Verbal confirmation',
  nurture: 'Nurture',
  won: 'Won',
  lost: 'Lost',
}

/**
 * Stage tone for the badge. §12.1 allows semantic colour for state only, and
 * never colour alone — the badge always shows the label as well.
 */
export const STAGE_TONES: Record<Enums['opportunity_stage'], 'active' | 'won' | 'overdue' | 'muted'> = {
  new: 'active',
  qualified: 'active',
  selection: 'active',
  quoted: 'active',
  negotiation: 'active',
  verbal_confirmation: 'active',
  nurture: 'muted',
  won: 'won',
  lost: 'overdue',
}

export const ACCOUNT_TYPE_LABELS: Record<Enums['account_type'], string> = {
  HOMEOWNER: 'Homeowner',
  CONTRACTOR: 'Contractor',
  BUILDER: 'Builder',
  ARCHITECT: 'Architect',
  INTERIOR_DESIGNER: 'Interior designer',
  DEALER: 'Dealer',
  COMMERCIAL: 'Commercial',
  MASON: 'Mason',
  OTHER: 'Other',
}

export const ACCOUNT_STATUS_LABELS: Record<Enums['account_status'], string> = {
  PROSPECT: 'Prospect',
  ACTIVE: 'Active',
  DORMANT: 'Dormant',
  DO_NOT_CONTACT: 'Do not contact',
}

export const LEAD_SOURCE_LABELS: Record<Enums['lead_source'], string> = {
  WALK_IN: 'Walk-in',
  PHONE_ENQUIRY: 'Phone enquiry',
  CUSTOMER_REFERRAL: 'Customer referral',
  ARCHITECT_REFERRAL: 'Architect referral',
  CONTRACTOR_REFERRAL: 'Contractor referral',
  SIGNAGE: 'Signage',
  SOCIAL_MEDIA: 'Social media',
  EXHIBITION: 'Exhibition',
  EXISTING_CUSTOMER: 'Existing customer',
  OTHER: 'Other',
}

export const PROJECT_TYPE_LABELS: Record<Enums['project_type'], string> = {
  INDIVIDUAL_HOUSE: 'Individual house',
  VILLA: 'Villa',
  APARTMENT_UNIT: 'Apartment unit',
  APARTMENT_PROJECT: 'Apartment project',
  COMMERCIAL: 'Commercial',
  HOSPITALITY: 'Hospitality',
  INSTITUTIONAL: 'Institutional',
  RENOVATION: 'Renovation',
  OTHER: 'Other',
}

export const CONSTRUCTION_STAGE_LABELS: Record<Enums['construction_stage'], string> = {
  PLANNING: 'Planning',
  FOUNDATION: 'Foundation',
  STRUCTURE: 'Structure',
  BRICKWORK: 'Brickwork',
  PLASTERING: 'Plastering',
  FLOORING_STAGE: 'Flooring',
  FINISHING: 'Finishing',
  COMPLETED: 'Completed',
  RENOVATION: 'Renovation',
  UNKNOWN: 'Not known',
}

export const PROJECT_STATUS_LABELS: Record<Enums['project_status'], string> = {
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  ABANDONED: 'Abandoned',
}

export const STAKEHOLDER_ROLE_LABELS: Record<Enums['stakeholder_role'], string> = {
  OWNER_BUYER: 'Owner / buyer',
  SPOUSE_FAMILY: 'Spouse / family',
  ARCHITECT: 'Architect',
  INTERIOR_DESIGNER: 'Interior designer',
  CONTRACTOR: 'Contractor',
  BUILDER: 'Builder',
  SITE_ENGINEER: 'Site engineer',
  MASON: 'Mason',
  PURCHASE_MANAGER: 'Purchase manager',
  DEALER: 'Dealer',
  OTHER: 'Other',
}

export const INFLUENCE_LABELS: Record<Enums['influence_level'], string> = {
  DECISION_MAKER: 'Decision maker',
  STRONG_INFLUENCER: 'Strong influencer',
  INFLUENCER: 'Influencer',
  EXECUTOR: 'Executor',
  INFORMATION_ONLY: 'Information only',
}

export const CONTACT_CHANNEL_LABELS: Record<Enums['contact_channel'], string> = {
  CALL: 'Call',
  WHATSAPP: 'WhatsApp',
  IN_PERSON: 'In person',
  EMAIL: 'Email',
}

export const ACTIVITY_TYPE_LABELS: Record<Enums['activity_type'], string> = {
  CALL: 'Call',
  WHATSAPP: 'WhatsApp',
  SHOWROOM_VISIT: 'Showroom visit',
  SITE_VISIT: 'Site visit',
  MEETING: 'Meeting',
  EMAIL: 'Email',
  NOTE: 'Note',
}

export const ACTIVITY_PURPOSE_LABELS: Record<Enums['activity_purpose'], string> = {
  ENQUIRY: 'Enquiry',
  FOLLOW_UP: 'Follow-up',
  PRODUCT_DISCUSSION: 'Product discussion',
  SITE_MEASUREMENT: 'Site measurement',
  SAMPLE_HANDOVER: 'Sample handover',
  QUOTATION_DISCUSSION: 'Quotation discussion',
  PRICE_NEGOTIATION: 'Price negotiation',
  ORDER_CONFIRMATION: 'Order confirmation',
  RELATIONSHIP: 'Relationship',
  OTHER: 'Other',
}

export const ACTIVITY_OUTCOME_LABELS: Record<Enums['activity_outcome'], string> = {
  POSITIVE: 'Positive',
  NEUTRAL: 'Neutral',
  NEGATIVE: 'Negative',
  NO_RESPONSE: 'No response',
  RESCHEDULED: 'Rescheduled',
}

export const LOST_REASON_LABELS: Record<Enums['lost_reason'], string> = {
  PRICE: 'Price',
  STOCK_UNAVAILABLE: 'Stock unavailable',
  DELIVERY_TIME: 'Delivery time',
  DESIGN_NOT_AVAILABLE: 'Design not available',
  COMPETITOR_RELATIONSHIP: 'Competitor relationship',
  PROJECT_POSTPONED: 'Project postponed',
  PROJECT_CANCELLED: 'Project cancelled',
  BUDGET_CUT: 'Budget cut',
  SPECIFIED_OTHER_BRAND: 'Specified another brand',
  CREDIT_TERMS: 'Credit terms',
  SERVICE_RESPONSE: 'Service response',
  NOT_GENUINE: 'Not a genuine enquiry',
  NO_RESPONSE: 'No response',
  UNKNOWN: 'Not known',
}

export const QUOTATION_STATUS_LABELS: Record<Enums['quotation_status'], string> = {
  NONE: 'None',
  PREPARING: 'Preparing',
  SENT: 'Sent',
  UNDER_DISCUSSION: 'Under discussion',
  REVISED: 'Revised',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
}

export const QUANTITY_UNIT_LABELS: Record<Enums['quantity_unit'], string> = {
  SQFT: 'sq ft',
  SQM: 'sq m',
  NOS: 'nos',
  SET: 'set',
  BOX: 'box',
}

/**
 * The `{ value, label }` shape every `<select>` in the application consumes, so
 * no form rebuilds an option list by hand.
 */
export function optionsFrom<T extends string>(labels: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }))
}
