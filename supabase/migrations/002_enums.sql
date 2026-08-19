-- 002 — enum types (§5.1)
--
-- Enums carry values the code branches on. Values the business may extend without
-- a deploy — cities, areas, material types — live in `system_settings` (§7.3).
-- Stage values are lowercase exactly as specified; do not "tidy" them (M-23).

create type public.user_role as enum ('SALESPERSON','MANAGER','OWNER','ADMIN');

create type public.account_type as enum (
  'HOMEOWNER','CONTRACTOR','BUILDER','ARCHITECT','INTERIOR_DESIGNER',
  'DEALER','COMMERCIAL','MASON','OTHER');

create type public.account_status as enum ('PROSPECT','ACTIVE','DORMANT','DO_NOT_CONTACT');

create type public.stakeholder_role as enum (
  'OWNER_BUYER','SPOUSE_FAMILY','ARCHITECT','INTERIOR_DESIGNER','CONTRACTOR',
  'BUILDER','SITE_ENGINEER','MASON','PURCHASE_MANAGER','DEALER','OTHER');

create type public.influence_level as enum (
  'DECISION_MAKER','STRONG_INFLUENCER','INFLUENCER','EXECUTOR','INFORMATION_ONLY');

create type public.contact_channel as enum ('CALL','WHATSAPP','IN_PERSON','EMAIL');

create type public.project_type as enum (
  'INDIVIDUAL_HOUSE','VILLA','APARTMENT_UNIT','APARTMENT_PROJECT',
  'COMMERCIAL','HOSPITALITY','INSTITUTIONAL','RENOVATION','OTHER');

create type public.construction_stage as enum (
  'PLANNING','FOUNDATION','STRUCTURE','BRICKWORK','PLASTERING',
  'FLOORING_STAGE','FINISHING','COMPLETED','RENOVATION','UNKNOWN');

create type public.project_status as enum ('ACTIVE','ON_HOLD','COMPLETED','ABANDONED');

create type public.opportunity_stage as enum (
  'new','qualified','selection','quoted','negotiation',
  'verbal_confirmation','won','lost','nurture');

create type public.product_category as enum (
  'TILES','MARBLE','GRANITE','SANITARYWARE','CP_FITTINGS','ALLIED','MIXED');

create type public.quantity_unit as enum ('SQFT','SQM','NOS','SET','BOX');

create type public.quotation_status as enum (
  'NONE','PREPARING','SENT','UNDER_DISCUSSION','REVISED','ACCEPTED','REJECTED','EXPIRED');

create type public.lost_reason as enum (
  'PRICE','STOCK_UNAVAILABLE','DELIVERY_TIME','DESIGN_NOT_AVAILABLE',
  'COMPETITOR_RELATIONSHIP','PROJECT_POSTPONED','PROJECT_CANCELLED','BUDGET_CUT',
  'SPECIFIED_OTHER_BRAND','CREDIT_TERMS','SERVICE_RESPONSE','NOT_GENUINE',
  'NO_RESPONSE','UNKNOWN');

create type public.activity_type as enum (
  'CALL','WHATSAPP','SHOWROOM_VISIT','SITE_VISIT','MEETING','EMAIL','NOTE');

create type public.activity_purpose as enum (
  'ENQUIRY','FOLLOW_UP','PRODUCT_DISCUSSION','SITE_MEASUREMENT','SAMPLE_HANDOVER',
  'QUOTATION_DISCUSSION','PRICE_NEGOTIATION','ORDER_CONFIRMATION','RELATIONSHIP','OTHER');

create type public.activity_outcome as enum (
  'POSITIVE','NEUTRAL','NEGATIVE','NO_RESPONSE','RESCHEDULED');

create type public.next_action_type as enum (
  'CALL','SHOWROOM_VISIT','SITE_VISIT','SEND_QUOTATION','SHARE_SAMPLES',
  'QUOTATION_FOLLOWUP','PRICE_DISCUSSION','AWAIT_CUSTOMER','OTHER');

create type public.lead_source as enum (
  'WALK_IN','PHONE_ENQUIRY','CUSTOMER_REFERRAL','ARCHITECT_REFERRAL',
  'CONTRACTOR_REFERRAL','SIGNAGE','SOCIAL_MEDIA','EXHIBITION','EXISTING_CUSTOMER','OTHER');

create type public.opportunity_event_type as enum (
  'CREATED','STAGE_CHANGED','OWNER_CHANGED','WON','LOST','REOPENED','ARCHIVED','RESTORED');

create type public.import_status as enum (
  'UPLOADED','VALIDATING','REVIEW','IMPORTING','COMPLETED','FAILED','ROLLED_BACK');

create type public.import_row_status as enum (
  'VALID','WARNING','ERROR','DUPLICATE_EXACT','DUPLICATE_POSSIBLE','IMPORTED','SKIPPED');
