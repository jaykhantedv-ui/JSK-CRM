import Link from 'next/link'
import type { ReactNode } from 'react'

import { Card, CardBody } from '@/components/ui/card'
import { formatDate } from '@/lib/dates'
import type { Period } from '@/lib/period'
import { toRoute } from '@/lib/routes'

/**
 * The frame every report shares (§16).
 *
 * One place decides how a report states its own scope, so a manager reading two
 * reports side by side can see at a glance that both cover the same period and
 * the same branch. A report that does not say what it covers is a report that
 * will eventually be quoted out of context.
 */

export const REPORTS = [
  { href: '/reports/pipeline', label: 'Pipeline', description: 'Open value by stage, weighted' },
  { href: '/reports/won-lost', label: 'Won and lost', description: 'Outcomes and win rate for the period' },
  { href: '/reports/salespeople', label: 'Salesperson performance', description: 'Workload, outcomes and conversion' },
  { href: '/reports/lost-reasons', label: 'Lost reasons', description: 'Where the losses are going' },
  { href: '/reports/site-visits', label: 'Site visits', description: 'Visits by person, branch and project' },
  { href: '/reports/conversion', label: 'Quote to order', description: 'Conversion and quotation turnaround' },
  { href: '/reports/at-risk', label: 'Stalled and at risk', description: 'Everything slipping, and why' },
  { href: '/reports/customers', label: 'Customer sales', description: 'Won Value and open pipeline per customer' },
  { href: '/reports/projects', label: 'Project sales', description: 'Won and open, per project' },
  { href: '/reports/outlets', label: 'Branch comparison', description: 'Every branch, side by side' },
  { href: '/reports/targets', label: 'Sales targets', description: 'Set the monthly figures' },
] as const

export function ReportShell({
  title,
  description,
  period,
  filters,
  children,
}: {
  title: string
  description: string
  /** Omitted by reports that describe a live state rather than a period. */
  period?: Period
  filters?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={toRoute('/reports')} className="text-sm text-muted-foreground hover:underline">
          ← Reports
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {description}
          {period ? ` · ${period.label}: ${formatDate(period.fromDate)} to ${formatDate(period.toDate)}` : ''}
        </p>
      </div>

      {filters}
      {children}
    </div>
  )
}

/**
 * The note under a report that explains how its numbers are defined.
 *
 * Not decoration. A manager who cannot see how Win Rate was calculated will
 * eventually assume it is wrong, and a metric nobody trusts is a metric nobody
 * uses — which is the failure this whole phase exists to avoid.
 */
export function MetricNote({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardBody className="pt-3">
        <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
      </CardBody>
    </Card>
  )
}
