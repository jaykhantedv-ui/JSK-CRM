import { BUSINESS_TIME_ZONE, businessHour, businessToday, formatDate } from '@/lib/dates'
import { formatPaise } from '@/lib/money'
import { createAdminClient } from '@/lib/supabase/admin'

import {
  emailSection,
  emailShell,
  escapeHtml,
  isEmailConfigured,
  notificationService,
} from './integrations/notification'
import {
  getSettingWith,
  setSettingWith,
  type SettingsWriter,
} from './settings.service'

/**
 * The five scheduled automations (§14).
 *
 * **Seven automations exist in §14 and only these five are jobs.** The other two
 * are computed exception views rendered on page load — that is deliberate, and
 * nothing here should grow into a general scheduler. §14.8 is equally binding on
 * what must NOT happen: no auto-assignment, no auto-closing, no auto-merging, no
 * auto-reassignment, **no message to a customer**, and no per-event
 * create/edit notifications.
 *
 * This is a service and not five route handlers because CLAUDE.md §8 puts every
 * business rule in `src/services/*`; a route authenticates, calls one function
 * and maps the result. It is one of the permitted callers of the service-role
 * client (§15.7, ADR-009 — "cron routes", meaning the cron execution path), and
 * it needs to be: a job that emails sixteen salespeople has to read across every
 * salesperson's records, which no user session may do.
 *
 * **Two failure rules run through all of it.** One user's failure never stops the
 * loop (§14.3), and every job returns `{ processed, sent, failed }` so a silent
 * failure is impossible to have.
 */

export type JobSummary = { processed: number; sent: number; failed: number }

type Admin = ReturnType<typeof createAdminClient>

/**
 * Send one email, and never let a failure escape the loop.
 *
 * §14.3: "Log per-user failure, continue with remaining users, report count in
 * the cron response." A digest job that threw on the first bad address would
 * leave fifteen salespeople without their morning list and nobody would know why.
 */
async function trySend(to: string, subject: string, html: string): Promise<boolean> {
  try {
    await notificationService.sendEmail(to, subject, html)
    return true
  } catch (error) {
    // The recipient and the reason. Never the body — it is a customer follow-up
    // list, and §15.8 forbids logging personal data (or tokens) wholesale.
    console.error(`[automation] email to ${to} failed:`, (error as Error).message)
    return false
  }
}

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''

function link(path: string, label: string): string {
  const base = appUrl()
  const text = escapeHtml(label)
  return base ? `<a href="${base}${path}" style="color:#0369a1">${text}</a>` : text
}

type OpportunityLine = {
  id: string
  title: string
  next_action_date: string | null
  estimated_value: number
  stage: string
}

function opportunityItem(row: OpportunityLine, suffix?: string): string {
  const value = formatPaise(row.estimated_value)
  const tail = suffix ? ` — ${escapeHtml(suffix)}` : ''
  return `${link(`/opportunities/${row.id}`, row.title)} · ${escapeHtml(value)}${tail}`
}

// ---------------------------------------------------------------------------
// §14.2 — new opportunity reminder
// ---------------------------------------------------------------------------

/**
 * Notify about opportunities that have sat in `new` past the SLA.
 *
 * **Once per opportunity, ever** (ADR-002). `sla_notified_at` is stamped whether
 * or not the email succeeded, and that is deliberate: §14.2's failure rule is
 * "log and retry next hour", but re-sending the same reminder every hour to a
 * salesperson who is on leave is the alert-fatigue failure §25 says permanently
 * destroys trust in every alert the system sends. One reminder, then the
 * opportunity is the manager's problem through the dashboard, which surfaces it
 * continuously anyway.
 *
 * **Imported records are excluded** (ADR-025). A customer copied out of a 2019
 * paper register is not a new enquiry somebody failed to answer within 48 hours.
 * This is the notification suppression §20.5 requires, and it lives in the query
 * rather than in a transaction-local flag precisely so it survives the cron path.
 *
 * Closed opportunities are excluded by `stage = 'new'`, and archived ones
 * explicitly.
 */
export async function runNewOpportunitySla(admin: Admin = createAdminClient()): Promise<JobSummary> {
  const slaHours = await getSettingWith(admin, 'new_enquiry_sla_hours')
  const cutoff = new Date(Date.now() - slaHours * 60 * 60 * 1000).toISOString()

  const { data, error } = await admin
    .from('opportunities')
    .select('id, title, estimated_value, created_at, owner_id, outlet_id, stage, next_action_date')
    .eq('stage', 'new')
    .is('archived_at', null)
    .is('sla_notified_at', null)
    .eq('is_imported', false)
    .lt('created_at', cutoff)
    .limit(500)

  if (error) throw new Error(`SLA query failed: ${error.message}`)

  const rows = data ?? []
  if (rows.length === 0) return { processed: 0, sent: 0, failed: 0 }

  // §14.2: "Email the owner; if unassigned, email the manager."
  const ownerIds = [...new Set(rows.map((row) => row.owner_id).filter(Boolean))] as string[]
  const unassignedOutlets = [
    ...new Set(rows.filter((row) => !row.owner_id).map((row) => row.outlet_id)),
  ]

  const [owners, managers] = await Promise.all([
    fetchUsers(admin, ownerIds),
    fetchOutletManagers(admin, unassignedOutlets),
  ])

  let sent = 0
  let failed = 0

  for (const row of rows) {
    const recipients = row.owner_id
      ? [owners.get(row.owner_id)].filter(Boolean)
      : (managers.get(row.outlet_id) ?? [])

    if (recipients.length === 0) {
      // Nobody to tell. Still stamped below, so the job does not re-scan it every
      // hour for ever; the manager dashboard shows it as unassigned regardless.
      failed += 1
    }

    const html = emailShell(
      'An enquiry has had no response',
      [
        `<p style="font-size:14px;line-height:1.6">This enquiry has been open for more than ${slaHours} hours with no stage change.</p>`,
        emailSection('Enquiry', [opportunityItem(row as OpportunityLine)]),
      ].join(''),
    )

    for (const recipient of recipients) {
      if (!recipient) continue
      const ok = await trySend(recipient.email, `No response yet — ${row.title}`, html)
      if (ok) sent += 1
      else failed += 1
    }
  }

  // Stamped after the attempt, in one statement, so a crash mid-loop cannot leave
  // half the batch permanently un-notifiable.
  const { error: stampError } = await admin
    .from('opportunities')
    .update({ sla_notified_at: new Date().toISOString() })
    .in(
      'id',
      rows.map((row) => row.id),
    )

  if (stampError) throw new Error(`SLA stamp failed: ${stampError.message}`)

  return { processed: rows.length, sent, failed }
}

type UserRow = { id: string; email: string; full_name: string; role: string }

async function fetchUsers(admin: Admin, ids: readonly string[]): Promise<Map<string, UserRow>> {
  if (ids.length === 0) return new Map()
  const { data } = await admin
    .from('users')
    .select('id, email, full_name, role')
    .in('id', ids as string[])
    .eq('is_active', true)

  return new Map((data ?? []).map((user) => [user.id, user as UserRow]))
}

/** Active managers for each outlet, via `user_outlets` (ADR-016). */
async function fetchOutletManagers(
  admin: Admin,
  outletIds: readonly string[],
): Promise<Map<string, UserRow[]>> {
  if (outletIds.length === 0) return new Map()

  const { data } = await admin
    .from('user_outlets')
    .select('outlet_id, users!user_outlets_user_id_fkey(id, email, full_name, role, is_active)')
    .in('outlet_id', outletIds as string[])
    .is('revoked_at', null)

  const map = new Map<string, UserRow[]>()
  for (const row of data ?? []) {
    const user = row.users as unknown as UserRow & { is_active: boolean }
    if (!user?.is_active || user.role !== 'MANAGER') continue
    map.set(row.outlet_id, [...(map.get(row.outlet_id) ?? []), user])
  }
  return map
}

// ---------------------------------------------------------------------------
// §14.3 — daily salesperson digest
// ---------------------------------------------------------------------------

/**
 * One email per salesperson, listing what they are about to miss.
 *
 * **Never a group email** (§14.3). The `NotificationService` interface takes one
 * recipient, and this loops — an interface that cannot express a group cannot
 * send one by accident.
 *
 * **Skipped entirely when the three specified lists are empty** (§14.3). The
 * upcoming list is included in the body when there is a reason to send, because
 * the phase brief asks for it, but it deliberately does NOT make an otherwise
 * empty digest send: a daily email that always arrives is one that stops being
 * read, and the whole point is that its arrival means something.
 */
export async function runDailyDigest(admin: Admin = createAdminClient()): Promise<JobSummary> {
  const today = businessToday()

  const { data, error } = await admin
    .from('v_opportunity_flags')
    .select('id, title, estimated_value, stage, next_action_date, owner_id, is_overdue, is_due_today, is_missing_next_action')
    .not('owner_id', 'is', null)
    .in('is_active', [true])

  if (error) throw new Error(`Digest query failed: ${error.message}`)

  const byOwner = new Map<string, typeof data>()
  for (const row of data ?? []) {
    if (!row.owner_id) continue
    byOwner.set(row.owner_id, [...(byOwner.get(row.owner_id) ?? []), row])
  }

  const owners = await fetchUsers(admin, [...byOwner.keys()])

  let processed = 0
  let sent = 0
  let failed = 0

  for (const [ownerId, rows] of byOwner) {
    const user = owners.get(ownerId)
    if (!user) continue

    const overdue = (rows ?? []).filter((row) => row.is_overdue)
    const dueToday = (rows ?? []).filter((row) => row.is_due_today)
    const missing = (rows ?? []).filter((row) => row.is_missing_next_action)

    // §14.3's condition, exactly.
    if (overdue.length === 0 && dueToday.length === 0 && missing.length === 0) continue

    processed += 1

    const upcoming = (rows ?? [])
      .filter(
        (row) =>
          row.next_action_date &&
          row.next_action_date > today &&
          !row.is_overdue &&
          !row.is_due_today,
      )
      .sort((a, b) => (a.next_action_date ?? '').localeCompare(b.next_action_date ?? ''))
      .slice(0, 5)

    const html = emailShell(
      `Your follow-ups for ${formatDate(today)}`,
      [
        emailSection(
          `Overdue (${overdue.length})`,
          overdue.map((row) =>
            opportunityItem(
              row as OpportunityLine,
              row.next_action_date ? `due ${formatDate(row.next_action_date)}` : undefined,
            ),
          ),
        ),
        emailSection(
          `Due today (${dueToday.length})`,
          dueToday.map((row) => opportunityItem(row as OpportunityLine)),
        ),
        emailSection(
          `No next action set (${missing.length})`,
          missing.map((row) => opportunityItem(row as OpportunityLine)),
        ),
        emailSection(
          'Coming up',
          upcoming.map((row) =>
            opportunityItem(
              row as OpportunityLine,
              row.next_action_date ? formatDate(row.next_action_date) : undefined,
            ),
          ),
        ),
      ].join(''),
    )

    const ok = await trySend(
      user.email,
      `${overdue.length} overdue · ${dueToday.length} due today`,
      html,
    )
    if (ok) sent += 1
    else failed += 1
  }

  return { processed, sent, failed }
}

// ---------------------------------------------------------------------------
// §14.4 — manager exception digest
// ---------------------------------------------------------------------------

/**
 * One email per manager, covering their outlets and nothing else.
 *
 * **A manager must never receive data outside their outlet scope** (ADR-016).
 * This runs with the service-role client, so RLS is not doing that job here —
 * the scope filter below is, and it is the reason the integration suite asserts
 * this job's output per manager rather than trusting the query by eye.
 */
export async function runManagerDigest(admin: Admin = createAdminClient()): Promise<JobSummary> {
  const highValue = await getSettingWith(admin, 'high_value_threshold_paise')

  const { data: managerRows, error: managerError } = await admin
    .from('user_outlets')
    .select('outlet_id, users!user_outlets_user_id_fkey(id, email, full_name, role, is_active)')
    .is('revoked_at', null)

  if (managerError) throw new Error(`Manager lookup failed: ${managerError.message}`)

  const scopeByManager = new Map<string, { user: UserRow; outlets: string[] }>()
  for (const row of managerRows ?? []) {
    const user = row.users as unknown as UserRow & { is_active: boolean }
    if (!user?.is_active || user.role !== 'MANAGER') continue
    const existing = scopeByManager.get(user.id)
    scopeByManager.set(user.id, {
      user,
      outlets: [...(existing?.outlets ?? []), row.outlet_id],
    })
  }

  // §14.4: "MANAGER (and OWNER if no manager exists)." The owner is the fallback
  // recipient for a business that has not appointed a manager yet — not an extra
  // copy of every manager's mail.
  if (scopeByManager.size === 0) {
    const { data: owners } = await admin
      .from('users')
      .select('id, email, full_name, role')
      .eq('role', 'OWNER')
      .eq('is_active', true)

    const { data: outlets } = await admin.from('outlets').select('id').eq('is_active', true)

    for (const owner of owners ?? []) {
      scopeByManager.set(owner.id, {
        user: owner as UserRow,
        outlets: (outlets ?? []).map((outlet) => outlet.id),
      })
    }
  }

  let processed = 0
  let sent = 0
  let failed = 0

  for (const { user, outlets } of scopeByManager.values()) {
    if (outlets.length === 0) continue

    const { data, error } = await admin
      .from('v_opportunity_flags')
      // One literal, not a concatenation: the typed client infers the row shape
      // from the select string, and a `+` defeats that inference entirely.
      .select('id, title, estimated_value, stage, next_action_date, owner_id, outlet_id, days_in_stage, is_overdue, is_missing_next_action, is_unassigned, is_active')
      .in('outlet_id', outlets)
      .in('is_active', [true])

    if (error) throw new Error(`Manager digest query failed: ${error.message}`)

    const rows = data ?? []
    const unassigned = rows.filter((row) => row.is_unassigned)
    const overdue = rows.filter((row) => row.is_overdue)
    const missing = rows.filter((row) => row.is_missing_next_action)
    const atRisk = rows.filter(
      (row) =>
        (row.estimated_value ?? 0) >= highValue &&
        (row.is_overdue || row.is_missing_next_action),
    )
    const stalled = rows.filter((row) => (row.days_in_stage ?? 0) >= 14)

    // §14.4's condition: "Any Panel A tile is non-zero."
    if (
      unassigned.length === 0 &&
      overdue.length === 0 &&
      missing.length === 0 &&
      atRisk.length === 0
    ) {
      continue
    }

    processed += 1

    const owners = await fetchUsers(
      admin,
      [...new Set(rows.map((row) => row.owner_id).filter(Boolean))] as string[],
    )

    // §14.4: "One email grouped by salesperson."
    const byPerson = new Map<string, string[]>()
    for (const row of [...overdue, ...missing]) {
      const name = row.owner_id ? (owners.get(row.owner_id)?.full_name ?? 'Unknown') : 'Unassigned'
      byPerson.set(name, [
        ...(byPerson.get(name) ?? []),
        opportunityItem(
          row as OpportunityLine,
          row.is_overdue && row.next_action_date
            ? `overdue since ${formatDate(row.next_action_date)}`
            : 'no next action',
        ),
      ])
    }

    const html = emailShell(
      `Team exceptions for ${formatDate(businessToday())}`,
      [
        emailSection(
          `Unassigned (${unassigned.length})`,
          unassigned.map((row) => opportunityItem(row as OpportunityLine)),
        ),
        emailSection(
          `High-value at risk (${atRisk.length})`,
          atRisk.map((row) => opportunityItem(row as OpportunityLine)),
        ),
        emailSection(
          `Stalled 14 days or more (${stalled.length})`,
          stalled
            .slice(0, 10)
            .map((row) => opportunityItem(row as OpportunityLine, `${row.days_in_stage} days in stage`)),
        ),
        ...[...byPerson.entries()].map(([name, items]) => emailSection(name, items.slice(0, 10))),
      ].join(''),
    )

    const ok = await trySend(
      user.email,
      `${overdue.length} overdue · ${unassigned.length} unassigned`,
      html,
    )
    if (ok) sent += 1
    else failed += 1
  }

  return { processed, sent, failed }
}

// ---------------------------------------------------------------------------
// §14.5 — owner summary, hourly trigger with an in-route gate (ADR-011)
// ---------------------------------------------------------------------------

/**
 * Should the owner summary send in this hour?
 *
 * **Pure, and exported so it can be unit-tested for all 24 hours** (ADR-011).
 * Vercel Cron schedules are static in `vercel.json`, so the route fires every
 * hour and this decides — which means changing the send time is an edit at
 * `/settings` and never a deployment, the rule §24 exists to protect.
 *
 * The hour is the **Asia/Kolkata** hour (B-10). Comparing a UTC hour to a setting
 * the owner set in IST would send the summary at 13:30 local.
 */
export function shouldSendOwnerSummary(
  schedule: { cadence: 'daily' | 'weekly'; hour: number },
  now: Date = new Date(),
): boolean {
  if (businessHour(now) !== schedule.hour) return false
  if (schedule.cadence === 'daily') return true

  // Weekly sends on Monday, in IST — the same instant can be a different weekday
  // in the two zones, so the date is read in the business timezone.
  const weekday = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: 'short',
  }).format(now)

  return weekday === 'Mon'
}

/**
 * The §13.4 summary, by email. **Max 10 lines — do not add tiles.**
 *
 * §14.5's failure rule is "log; no retry": a stale summary is worse than none.
 */
export async function runOwnerSummary(
  admin: Admin = createAdminClient(),
  now: Date = new Date(),
): Promise<JobSummary & { skipped: boolean }> {
  const schedule = await getSettingWith(admin, 'owner_summary_schedule')

  if (!shouldSendOwnerSummary(schedule, now)) {
    return { processed: 0, sent: 0, failed: 0, skipped: true }
  }

  const highValue = await getSettingWith(admin, 'high_value_threshold_paise')
  const probabilities = await getSettingWith(admin, 'stage_probabilities')

  const monthStart = `${businessToday(now).slice(0, 7)}-01`

  const [{ data: flags }, { data: closed }, { data: owners }] = await Promise.all([
    admin
      .from('v_opportunity_flags')
      .select('id, title, estimated_value, stage, owner_id, is_overdue, is_unassigned, in_pipeline'),
    admin
      .from('opportunities')
      .select('id, stage, final_order_value, lost_reason, closed_at')
      .in('stage', ['won', 'lost'])
      .gte('closed_at', `${monthStart}T00:00:00+05:30`)
      .is('archived_at', null),
    admin.from('users').select('id, email, full_name, role').eq('role', 'OWNER').eq('is_active', true),
  ])

  const active = (flags ?? []).filter((row) => row.in_pipeline)
  const won = (closed ?? []).filter((row) => row.stage === 'won')
  const lost = (closed ?? []).filter((row) => row.stage === 'lost')

  const pipelineValue = active.reduce((total, row) => total + (row.estimated_value ?? 0), 0)
  const weighted = active.reduce(
    (total, row) =>
      total +
      Math.round(((row.estimated_value ?? 0) * (probabilities[row.stage ?? ''] ?? 0)) / 100),
    0,
  )
  const wonValue = won.reduce((total, row) => total + (row.final_order_value ?? 0), 0)

  // §13.1: Win Rate with a zero denominator displays `—`, never `0%`.
  const decided = won.length + lost.length
  const winRate = decided === 0 ? '—' : `${Math.round((won.length / decided) * 100)}%`

  const unassigned = (flags ?? []).filter((row) => row.is_unassigned).length
  const atRisk = (flags ?? []).filter(
    (row) => row.in_pipeline && (row.estimated_value ?? 0) >= highValue && row.is_overdue,
  ).length

  const html = emailShell(`Summary for ${formatDate(businessToday(now))}`, [
    emailSection('This month', [
      `Won: ${won.length} · ${escapeHtml(formatPaise(wonValue))}`,
      `Lost: ${lost.length}`,
      `Win rate: ${winRate}`,
    ]),
    emailSection('Pipeline', [
      `Pipeline Value: ${escapeHtml(formatPaise(pipelineValue))}`,
      `Weighted Pipeline: ${escapeHtml(formatPaise(weighted))}`,
      `Active opportunities: ${active.length}`,
    ]),
    emailSection('Needs attention', [
      `Unassigned: ${unassigned}`,
      `High-value at risk: ${atRisk}`,
    ]),
  ].join(''))

  let sent = 0
  let failed = 0

  for (const owner of owners ?? []) {
    const ok = await trySend(owner.email, 'JSK CRM — daily summary', html)
    if (ok) sent += 1
    else failed += 1
  }

  return { processed: (owners ?? []).length, sent, failed, skipped: false }
}

// ---------------------------------------------------------------------------
// §14.6 / ADR-014 — nightly maintenance and its failure state
// ---------------------------------------------------------------------------

/** ADR-014: the OWNER is alerted at exactly this many consecutive failures. */
export const MAINTENANCE_ALERT_THRESHOLD = 2

export type MaintenanceResult = JobSummary & {
  dormantAccounts: number
  expiredQuotations: number
  corrections: number
}

/**
 * The nightly job (§14.6).
 *
 * Three actions, one transaction, in `run_maintenance` (migration 027). The
 * corrections it reports are LOGGED HERE AND NOT SUPPRESSED — a non-zero count
 * means a write path is failing to maintain `last_activity_at`, and swallowing it
 * would hide a live bug behind a job that silently patches its symptom every
 * night.
 */
export async function runMaintenance(admin: Admin = createAdminClient()): Promise<MaintenanceResult> {
  const dormancyDays = await getSettingWith(admin, 'account_dormancy_days')

  const { data, error } = await admin
    .rpc('run_maintenance', { p_account_dormancy_days: dormancyDays })
    .single()

  if (error) throw new Error(`Maintenance failed: ${error.message}`)

  const corrections = data.corrected_accounts + data.corrected_opportunities

  if (corrections > 0) {
    // §14.6: "A non-zero correction count in step 3 indicates a bug in a write
    // path. Do not suppress that log."
    console.warn(
      `[cron:maintenance] corrected last_activity_at on ${corrections} row(s) — ` +
        `this indicates a bug in a write path. ids=${JSON.stringify(data.corrected_ids)}`,
    )
  }

  await resetMaintenanceFailures(admin)

  return {
    processed: data.dormant_accounts + data.expired_quotations + corrections,
    sent: 0,
    failed: 0,
    dormantAccounts: data.dormant_accounts,
    expiredQuotations: data.expired_quotations,
    corrections,
  }
}

/** ADR-014: a successful run resets the counter to 0. */
async function resetMaintenanceFailures(admin: Admin): Promise<void> {
  await setSettingWith(asWriter(admin), 'maintenance_consecutive_failures', 0)
}

/**
 * Narrow the client to the two methods `setSettingWith` needs.
 *
 * Passing the fully generated client makes the compiler unfold every table type
 * through the update builder's overloads and give up ("type instantiation is
 * excessively deep"). The structural type is what the function actually requires.
 */
function asWriter(admin: Admin): SettingsWriter {
  return admin as unknown as SettingsWriter
}

/**
 * ADR-014: record a failed run, and alert the OWNER at exactly the threshold.
 *
 * **The alert fires once, at 2, and not on every subsequent failure.** An
 * operator who has been told twice does not need to be told nightly; the
 * counter keeps climbing so the eventual investigation can see how long it ran.
 *
 * Called from the route's `finally`, because a run that throws before reaching
 * its counter update leaves the state stale — which is exactly the risk Phase 18
 * names.
 */
export async function recordMaintenanceFailure(
  admin: Admin = createAdminClient(),
): Promise<{ consecutiveFailures: number; alerted: boolean }> {
  const previous = await getSettingWith(admin, 'maintenance_consecutive_failures')
  const next = previous + 1

  await setSettingWith(asWriter(admin), 'maintenance_consecutive_failures', next)
  await setSettingWith(asWriter(admin), 'maintenance_last_failure_at', new Date().toISOString())

  if (next !== MAINTENANCE_ALERT_THRESHOLD) {
    return { consecutiveFailures: next, alerted: false }
  }

  const { data: owners } = await admin
    .from('users')
    .select('id, email, full_name, role')
    .eq('role', 'OWNER')
    .eq('is_active', true)

  const html = emailShell(
    'Nightly maintenance has failed twice',
    emailSection('What this means', [
      'The nightly job that flags dormant customers and expires old quotations has now failed twice in a row.',
      'Dormancy and quotation status may be out of date until it runs successfully.',
    ]),
  )

  let alerted = false
  for (const owner of owners ?? []) {
    if (await trySend(owner.email, 'JSK CRM — maintenance is failing', html)) alerted = true
  }

  return { consecutiveFailures: next, alerted }
}

/** Whether email can send at all. Surfaced by the routes so a misconfiguration is visible. */
export { isEmailConfigured }
