import { CSV_CONTENT_TYPE, csvFilename, toCsv, type CsvColumn } from '@/lib/csv'
import { businessToday, formatDate, formatDateTime } from '@/lib/dates'
import { AppError, forbidden } from '@/lib/errors'
import { RISK_REASON_LABELS, formatPercent } from '@/lib/metrics'
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPE_LABELS,
  CONSTRUCTION_STAGE_LABELS,
  LOST_REASON_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  STAGE_LABELS,
} from '@/lib/labels'
import { CATEGORY_LABELS } from '@/lib/opportunity/title'
import { canExportCsv } from '@/lib/permissions'
import { parsePeriod, type Period } from '@/lib/period'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireUser } from '@/services/auth.service'
import {
  getAtRiskOpportunities,
  getCustomerSales,
  getLostReasonAnalysis,
  getOutletComparison,
  getPipelineSummary,
  getProjectSales,
  getSiteVisits,
  type ManagementScope,
} from '@/services/analytics.service'
import { listAccounts, parseAccountFilters } from '@/services/account.service'
import { listOpportunities, parseOpportunityFilters } from '@/services/opportunity.service'
import { listProjects, parseProjectFilters } from '@/services/project.service'
import { getTeamOverview } from '@/services/team.service'
import type { AccountRow, LostReason, OpportunityFlagsRow, ProjectRow } from '@/types/domain'

/**
 * CSV export (§3.1, decision C-2, Master Phase 3 §17).
 *
 * **Export is enforced here, server-side, and nowhere else that matters.**
 * §3.1 grants it to MANAGER and OWNER; SALESPERSON and ADMIN are refused. A
 * hidden button is not a control (CLAUDE.md §6) — hitting the export route
 * directly with an admin's session gets a refusal, not a file.
 *
 * **Every export is the caller's current filtered view, read through the caller's
 * own session.** There is no separate export path, no service-role read and no
 * "export everything" mode: an export and the screen it came from run the same
 * query against the same policies, so they cannot disagree about what a manager
 * is allowed to see.
 *
 * Money leaves as rupees and every cell is neutralised against spreadsheet
 * formula injection — both in `lib/csv.ts`, which is the only place either
 * conversion happens.
 */

export const EXPORT_DATASETS = [
  'opportunities',
  'accounts',
  'projects',
  'team',
  'at-risk',
  'lost-reasons',
  'site-visits',
  'customer-sales',
  'project-sales',
  'outlets',
  'pipeline',
] as const

export type ExportDataset = (typeof EXPORT_DATASETS)[number]

export function isExportDataset(value: string): value is ExportDataset {
  return (EXPORT_DATASETS as readonly string[]).includes(value)
}

/**
 * The largest export the application will produce.
 *
 * **A silently truncated export is worse than a refused one**: a manager who
 * exports 1,000 of 3,000 rows and totals them in a spreadsheet gets a wrong
 * number with no indication anything is missing. Over the limit, the export is
 * refused and the message says which filter to narrow.
 *
 * **1000 is `max_rows` in `supabase/config.toml`**, the point at which PostgREST
 * truncates a response without saying so. Asking for more would not produce more;
 * it would produce the same 1000 rows and a false belief. The `p_limit` ceiling
 * in migration 022 is the same number for the same reason, and if `max_rows`
 * changes, both change with it.
 */
export const EXPORT_ROW_LIMIT = 1000

export type ExportResult = {
  filename: string
  contentType: string
  csv: string
  rowCount: number
}

function assertWithinLimit(total: number, returned: number, what: string): void {
  if (total > EXPORT_ROW_LIMIT) {
    throw new AppError(
      'VALIDATION_FAILED',
      `That export covers ${total} ${what}, which is more than the ${EXPORT_ROW_LIMIT} this ` +
        'download allows. Narrow the filters — by branch, by salesperson or by a shorter period — and try again.',
    )
  }

  // The belt to the limit's braces. If the transport ever returns fewer rows than
  // it counted — a lowered `max_rows`, a proxy with its own cap — the export is
  // refused rather than written short. A file that is quietly missing rows is the
  // one failure mode this whole function exists to prevent.
  if (returned < total) {
    throw new AppError(
      'INTERNAL',
      `The export came back with ${returned} of ${total} ${what}. Nothing has been downloaded, ` +
        'because a partial export would look complete. Narrow the filters and try again.',
    )
  }
}

/** One page big enough for a whole export, bounded by the ceiling above. */
const EXPORT_PAGE = { page: 1, pageSize: EXPORT_ROW_LIMIT }

/**
 * Build an export.
 *
 * `raw` is the query string of the screen the manager pressed Export on, so the
 * file matches what they were looking at — including the period, the branch
 * filter and the search term.
 */
export async function buildExport(
  dataset: ExportDataset,
  raw: Record<string, string | undefined>,
): Promise<ExportResult> {
  const user = await requireUser()

  // §3.1: MANAGER ✔ OWNER ✔ SALESPERSON ✘ ADMIN ✘. The ADMIN refusal is
  // deliberate and is tested against the route, not the button (C-2, ADR-017).
  if (!canExportCsv(user)) {
    throw forbidden('Exporting is available to managers and the owner only.')
  }

  const period = parsePeriod(raw)
  const scope: ManagementScope = {
    outletId: raw.outlet?.trim() || null,
    ownerId: raw.owner?.trim() || null,
  }

  const built = await buildRows(dataset, raw, period, scope)

  return {
    filename: csvFilename(dataset, businessToday()),
    contentType: CSV_CONTENT_TYPE,
    csv: built.csv,
    rowCount: built.rowCount,
  }
}

async function buildRows(
  dataset: ExportDataset,
  raw: Record<string, string | undefined>,
  period: Period,
  scope: ManagementScope,
): Promise<{ csv: string; rowCount: number }> {
  switch (dataset) {
    case 'opportunities': {
      const page = await listOpportunities(parseOpportunityFilters(raw), EXPORT_PAGE)
      assertWithinLimit(page.total, page.rows.length, 'enquiries')
      const names = await resolveNames(page.rows)
      return {
        csv: toCsv(opportunityColumns(names), page.rows),
        rowCount: page.rows.length,
      }
    }

    case 'accounts': {
      const page = await listAccounts(parseAccountFilters(raw), EXPORT_PAGE)
      assertWithinLimit(page.total, page.rows.length, 'customers')
      return { csv: toCsv(ACCOUNT_COLUMNS, page.rows), rowCount: page.rows.length }
    }

    case 'projects': {
      const page = await listProjects(parseProjectFilters(raw), EXPORT_PAGE)
      assertWithinLimit(page.total, page.rows.length, 'projects')
      return { csv: toCsv(PROJECT_COLUMNS, page.rows), rowCount: page.rows.length }
    }

    case 'team': {
      const overview = await getTeamOverview(period, { outletId: scope.outletId })
      return { csv: toCsv(TEAM_COLUMNS, overview.members), rowCount: overview.members.length }
    }

    case 'at-risk': {
      const page = await getAtRiskOpportunities(scope, EXPORT_PAGE)
      assertWithinLimit(page.total, page.rows.length, 'at-risk enquiries')
      return { csv: toCsv(AT_RISK_COLUMNS, page.rows), rowCount: page.rows.length }
    }

    case 'lost-reasons': {
      const analysis = await getLostReasonAnalysis(period, scope)
      return { csv: toCsv(LOST_REASON_COLUMNS, analysis.rows), rowCount: analysis.rows.length }
    }

    case 'site-visits': {
      const page = await getSiteVisits(
        period,
        { ...scope, projectId: raw.project?.trim() || null },
        EXPORT_PAGE,
      )
      assertWithinLimit(page.total, page.rows.length, 'site visits')
      return { csv: toCsv(SITE_VISIT_COLUMNS, page.rows), rowCount: page.rows.length }
    }

    case 'customer-sales': {
      const page = await getCustomerSales(period, scope, EXPORT_PAGE)
      assertWithinLimit(page.total, page.rows.length, 'customers')
      return { csv: toCsv(CUSTOMER_SALES_COLUMNS, page.rows), rowCount: page.rows.length }
    }

    case 'project-sales': {
      const page = await getProjectSales(period, scope, EXPORT_PAGE)
      assertWithinLimit(page.total, page.rows.length, 'projects')
      return { csv: toCsv(PROJECT_SALES_COLUMNS, page.rows), rowCount: page.rows.length }
    }

    case 'outlets': {
      const rows = await getOutletComparison(period)
      return { csv: toCsv(OUTLET_COLUMNS, rows), rowCount: rows.length }
    }

    case 'pipeline': {
      const summary = await getPipelineSummary(scope)
      return { csv: toCsv(PIPELINE_COLUMNS, summary.byStage), rowCount: summary.byStage.length }
    }
  }
}

/**
 * Customer and owner names for a page of opportunities, in two round trips.
 *
 * RLS still applies, so a name the caller cannot see comes back absent and the
 * cell is blank — the row is still theirs to export, the name simply is not.
 */
async function resolveNames(
  rows: readonly OpportunityFlagsRow[],
): Promise<{ accounts: Record<string, string>; users: Record<string, string> }> {
  const accountIds = [...new Set(rows.map((row) => row.account_id as string).filter(Boolean))]
  const ownerIds = [...new Set(rows.map((row) => row.owner_id as string).filter(Boolean))]

  const supabase = await createSupabaseServerClient()
  const [accounts, users] = await Promise.all([
    accountIds.length
      ? supabase.from('accounts').select('id, name').in('id', accountIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ownerIds.length
      ? supabase.from('users').select('id, full_name').in('id', ownerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ])

  return {
    accounts: Object.fromEntries((accounts.data ?? []).map((row) => [row.id, row.name])),
    users: Object.fromEntries((users.data ?? []).map((row) => [row.id, row.full_name])),
  }
}

// ----------------------------------------------------------- column sets ----
//
// Headers use the business's own words. §2.4 — the word "Revenue" appears in no
// header, no filename and no cell.

function opportunityColumns(names: {
  accounts: Record<string, string>
  users: Record<string, string>
}): CsvColumn<OpportunityFlagsRow>[] {
  return [
    { key: 'title', header: 'Enquiry', value: (row) => row.title },
    { key: 'customer', header: 'Customer', value: (row) => names.accounts[row.account_id as string] ?? '' },
    { key: 'owner', header: 'Salesperson', value: (row) => names.users[row.owner_id as string] ?? 'Unassigned' },
    { key: 'stage', header: 'Stage', value: (row) => STAGE_LABELS[row.stage as keyof typeof STAGE_LABELS] },
    {
      key: 'category',
      header: 'Category',
      value: (row) => CATEGORY_LABELS[row.category as keyof typeof CATEGORY_LABELS],
    },
    { key: 'estimated', header: 'Estimated Value', value: (row) => row.estimated_value, money: true },
    { key: 'quoted', header: 'Quoted Value', value: (row) => row.quoted_value, money: true },
    { key: 'won', header: 'Won Value', value: (row) => row.final_order_value, money: true },
    { key: 'quotation_ref', header: 'Quotation Ref', value: (row) => row.quotation_ref },
    { key: 'quotation_date', header: 'Quotation Date', value: (row) => asDate(row.quotation_date) },
    { key: 'next_action_date', header: 'Next Action Due', value: (row) => asDate(row.next_action_date) },
    { key: 'overdue', header: 'Overdue', value: (row) => yesNo(row.is_overdue) },
    { key: 'days_in_stage', header: 'Days In Stage', value: (row) => row.days_in_stage },
    { key: 'days_since_activity', header: 'Days Since Activity', value: (row) => row.days_since_activity },
    { key: 'expected_close', header: 'Expected Close', value: (row) => asDate(row.expected_close_date) },
    { key: 'closed_at', header: 'Closed On', value: (row) => asDateTime(row.closed_at) },
    {
      key: 'lost_reason',
      header: 'Lost Reason',
      value: (row) => (row.lost_reason ? LOST_REASON_LABELS[row.lost_reason as LostReason] : ''),
    },
    { key: 'created_at', header: 'Created', value: (row) => asDateTime(row.created_at) },
  ]
}

const ACCOUNT_COLUMNS: CsvColumn<AccountRow>[] = [
  { key: 'name', header: 'Customer', value: (row) => row.name },
  { key: 'type', header: 'Type', value: (row) => ACCOUNT_TYPE_LABELS[row.account_type] },
  { key: 'status', header: 'Status', value: (row) => ACCOUNT_STATUS_LABELS[row.status] },
  { key: 'phone', header: 'Phone', value: (row) => row.phone },
  { key: 'email', header: 'Email', value: (row) => row.email },
  { key: 'city', header: 'City', value: (row) => row.city },
  { key: 'area', header: 'Area', value: (row) => row.area },
  { key: 'last_activity', header: 'Last Activity', value: (row) => asDateTime(row.last_activity_at) },
  { key: 'created_at', header: 'Created', value: (row) => asDateTime(row.created_at) },
]

const PROJECT_COLUMNS: CsvColumn<ProjectRow>[] = [
  { key: 'name', header: 'Project', value: (row) => row.name },
  { key: 'type', header: 'Type', value: (row) => PROJECT_TYPE_LABELS[row.project_type] },
  { key: 'status', header: 'Status', value: (row) => PROJECT_STATUS_LABELS[row.status] },
  {
    key: 'construction_stage',
    header: 'Construction Stage',
    value: (row) => CONSTRUCTION_STAGE_LABELS[row.construction_stage],
  },
  { key: 'city', header: 'City', value: (row) => row.city },
  { key: 'created_at', header: 'Created', value: (row) => asDateTime(row.created_at) },
]

type TeamRow = Awaited<ReturnType<typeof getTeamOverview>>['members'][number]

const TEAM_COLUMNS: CsvColumn<TeamRow>[] = [
  { key: 'name', header: 'Salesperson', value: (row) => row.fullName },
  { key: 'active', header: 'Active Enquiries', value: (row) => row.activeCount },
  { key: 'pipeline', header: 'Pipeline Value', value: (row) => row.pipelineValuePaise, money: true },
  { key: 'won_count', header: 'Won', value: (row) => row.wonCount },
  { key: 'won_value', header: 'Won Value', value: (row) => row.wonValuePaise, money: true },
  { key: 'lost_count', header: 'Lost', value: (row) => row.lostCount },
  { key: 'win_rate', header: 'Win Rate', value: (row) => formatPercent(row.winRatePercent, 1) },
  {
    key: 'conversion',
    header: 'Quote To Order',
    value: (row) => formatPercent(row.quoteConversionPercent, 1),
  },
  { key: 'overdue', header: 'Overdue', value: (row) => row.overdueCount },
  { key: 'due_today', header: 'Due Today', value: (row) => row.dueTodayCount },
  { key: 'missing', header: 'Missing Next Action', value: (row) => row.missingNextActionCount },
  { key: 'stalled', header: 'Stalled', value: (row) => row.stalledCount },
  { key: 'activities', header: 'Activities Logged', value: (row) => row.activityCount },
  { key: 'site_visits', header: 'Site Visits', value: (row) => row.siteVisitCount },
  { key: 'last_activity', header: 'Last Activity', value: (row) => asDateTime(row.lastActivityAt) },
]

type AtRiskRow = Awaited<ReturnType<typeof getAtRiskOpportunities>>['rows'][number]

const AT_RISK_COLUMNS: CsvColumn<AtRiskRow>[] = [
  { key: 'title', header: 'Enquiry', value: (row) => row.title },
  { key: 'customer', header: 'Customer', value: (row) => row.accountName },
  { key: 'project', header: 'Project', value: (row) => row.projectName },
  { key: 'owner', header: 'Salesperson', value: (row) => row.ownerName ?? 'Unassigned' },
  { key: 'branch', header: 'Branch', value: (row) => row.outletName },
  { key: 'stage', header: 'Stage', value: (row) => STAGE_LABELS[row.stage] },
  { key: 'value', header: 'Estimated Value', value: (row) => row.estimatedValuePaise, money: true },
  { key: 'days_in_stage', header: 'Days In Stage', value: (row) => row.daysInStage },
  { key: 'days_since_activity', header: 'Days Since Activity', value: (row) => row.daysSinceActivity },
  { key: 'next_action_date', header: 'Next Action Due', value: (row) => asDate(row.nextActionDate) },
  // The reasons travel with the row. An at-risk export without them is a list of
  // records with no indication of what to do about any of them (§9).
  {
    key: 'reasons',
    header: 'Why At Risk',
    value: (row) => row.reasons.map((reason) => RISK_REASON_LABELS[reason]).join('; '),
  },
]

type LostReasonRow = Awaited<ReturnType<typeof getLostReasonAnalysis>>['rows'][number]

const LOST_REASON_COLUMNS: CsvColumn<LostReasonRow>[] = [
  { key: 'reason', header: 'Lost Reason', value: (row) => LOST_REASON_LABELS[row.reason] },
  { key: 'count', header: 'Count', value: (row) => row.count },
  { key: 'share', header: 'Share Of Losses', value: (row) => formatPercent(row.countSharePercent, 1) },
  { key: 'value', header: 'Lost Value', value: (row) => row.valuePaise, money: true },
  { key: 'value_share', header: 'Share Of Lost Value', value: (row) => formatPercent(row.valueSharePercent, 1) },
]

type SiteVisitRowType = Awaited<ReturnType<typeof getSiteVisits>>['rows'][number]

const SITE_VISIT_COLUMNS: CsvColumn<SiteVisitRowType>[] = [
  { key: 'date', header: 'Date', value: (row) => asDateTime(row.occurredAt) },
  { key: 'salesperson', header: 'Salesperson', value: (row) => row.performedByName },
  { key: 'branch', header: 'Branch', value: (row) => row.outletName },
  { key: 'customer', header: 'Customer', value: (row) => row.accountName },
  { key: 'project', header: 'Project', value: (row) => row.projectName },
  { key: 'outcome', header: 'Outcome', value: (row) => row.outcome },
  { key: 'summary', header: 'Summary', value: (row) => row.summary },
  { key: 'measurements', header: 'Measurements', value: (row) => row.measurements },
  { key: 'location', header: 'Location Note', value: (row) => row.locationNote },
]

type CustomerSalesRowType = Awaited<ReturnType<typeof getCustomerSales>>['rows'][number]

const CUSTOMER_SALES_COLUMNS: CsvColumn<CustomerSalesRowType>[] = [
  { key: 'customer', header: 'Customer', value: (row) => row.accountName },
  { key: 'won_count', header: 'Won Enquiries', value: (row) => row.wonCount },
  { key: 'won_value', header: 'Won Value', value: (row) => row.wonValuePaise, money: true },
  { key: 'open_count', header: 'Open Enquiries', value: (row) => row.openCount },
  { key: 'pipeline', header: 'Pipeline Value', value: (row) => row.pipelineValuePaise, money: true },
  { key: 'lost_count', header: 'Lost Enquiries', value: (row) => row.lostCount },
  { key: 'last_activity', header: 'Last Activity', value: (row) => asDateTime(row.lastActivityAt) },
]

type ProjectSalesRowType = Awaited<ReturnType<typeof getProjectSales>>['rows'][number]

const PROJECT_SALES_COLUMNS: CsvColumn<ProjectSalesRowType>[] = [
  { key: 'project', header: 'Project', value: (row) => row.projectName },
  { key: 'customer', header: 'Customer', value: (row) => row.accountName },
  // One project has many opportunities (§4.3). The count is on the row so the
  // file cannot be read as one project meaning one sale.
  { key: 'opportunities', header: 'Enquiries', value: (row) => row.opportunityCount },
  { key: 'won_count', header: 'Won Enquiries', value: (row) => row.wonCount },
  { key: 'won_value', header: 'Won Value', value: (row) => row.wonValuePaise, money: true },
  { key: 'open_count', header: 'Open Enquiries', value: (row) => row.openCount },
  { key: 'pipeline', header: 'Pipeline Value', value: (row) => row.pipelineValuePaise, money: true },
  { key: 'lost_count', header: 'Lost Enquiries', value: (row) => row.lostCount },
]

type OutletRowType = Awaited<ReturnType<typeof getOutletComparison>>[number]

const OUTLET_COLUMNS: CsvColumn<OutletRowType>[] = [
  { key: 'branch', header: 'Branch', value: (row) => row.name },
  { key: 'code', header: 'Code', value: (row) => row.code },
  { key: 'enquiries', header: 'New Enquiries', value: (row) => row.newEnquiryCount },
  { key: 'active', header: 'Active Enquiries', value: (row) => row.activeCount },
  { key: 'pipeline', header: 'Pipeline Value', value: (row) => row.pipelineValuePaise, money: true },
  { key: 'quoted', header: 'Quoted Value', value: (row) => row.quotedValuePaise, money: true },
  { key: 'won_count', header: 'Won', value: (row) => row.wonCount },
  { key: 'won_value', header: 'Won Value', value: (row) => row.wonValuePaise, money: true },
  { key: 'win_rate', header: 'Win Rate', value: (row) => formatPercent(row.winRatePercent, 1) },
  {
    key: 'conversion',
    header: 'Quote To Order',
    value: (row) => formatPercent(row.quoteConversionPercent, 1),
  },
  { key: 'overdue', header: 'Overdue Follow-ups', value: (row) => row.overdueCount },
  { key: 'site_visits', header: 'Site Visits', value: (row) => row.siteVisitCount },
]

type PipelineStageRow = Awaited<ReturnType<typeof getPipelineSummary>>['byStage'][number]

const PIPELINE_COLUMNS: CsvColumn<PipelineStageRow>[] = [
  { key: 'stage', header: 'Stage', value: (row) => STAGE_LABELS[row.stage] },
  { key: 'count', header: 'Enquiries', value: (row) => row.count },
  { key: 'value', header: 'Value', value: (row) => row.valuePaise, money: true },
  { key: 'weighted', header: 'Weighted Value', value: (row) => row.weightedPaise, money: true },
  {
    key: 'in_pipeline',
    header: 'Counts In Pipeline Value',
    value: (row) => yesNo(row.countsInPipeline),
  },
]

// Dates leave as `dd MMM yyyy` in Asia/Kolkata, the same format the screens show
// (§8.11). A UTC timestamp in an export is a different fact from the one on the
// screen it came from.
function asDate(value: string | null | undefined): string {
  return value ? formatDate(value) : ''
}

function asDateTime(value: string | null | undefined): string {
  return value ? formatDateTime(value) : ''
}

function yesNo(value: boolean | null | undefined): string {
  return value ? 'Yes' : 'No'
}
