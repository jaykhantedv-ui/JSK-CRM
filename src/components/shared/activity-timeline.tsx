import {
  FileText, Mail, MapPin, MessageCircle, Phone, Store, Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { formatDateTime, relativeDays } from '@/lib/dates'
import { ACTIVITY_OUTCOME_LABELS, ACTIVITY_PURPOSE_LABELS, ACTIVITY_TYPE_LABELS } from '@/lib/labels'
import type { ActivityRow, ActivityType } from '@/types/domain'

/**
 * The activity timeline (§12.5) — what happened, newest first.
 *
 * Append-only history (§10.1). Nothing here offers a delete, because no role has
 * one: `activities` has no DELETE policy for anybody, ever (§8.10). An entry more
 * than 24 hours old is corrected by appending a NOTE, not by editing.
 *
 * Times render in Asia/Kolkata with a relative label beside them: "3 days ago"
 * is what a salesperson actually needs, and the exact stamp is there for when it
 * matters (§8.11).
 */
const ICONS: Record<ActivityType, typeof Phone> = {
  CALL: Phone,
  WHATSAPP: MessageCircle,
  SHOWROOM_VISIT: Store,
  SITE_VISIT: MapPin,
  MEETING: Users,
  EMAIL: Mail,
  NOTE: FileText,
}

const OUTCOME_TONE = {
  POSITIVE: 'won',
  NEUTRAL: 'muted',
  NEGATIVE: 'overdue',
  NO_RESPONSE: 'at-risk',
  RESCHEDULED: 'at-risk',
} as const

export function ActivityTimeline({
  activities,
  performerNames,
  emptyMessage = 'Nothing logged yet.',
}: {
  activities: ActivityRow[]
  performerNames?: Record<string, string>
  emptyMessage?: string
}) {
  if (activities.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
  }

  return (
    <ol className="flex flex-col gap-3">
      {activities.map((activity) => {
        const Icon = ICONS[activity.type]
        return (
          <li key={activity.id} className="flex gap-3">
            <span
              className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary"
              aria-hidden
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{ACTIVITY_TYPE_LABELS[activity.type]}</span>
                <Badge tone={OUTCOME_TONE[activity.outcome]}>
                  {ACTIVITY_OUTCOME_LABELS[activity.outcome]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {ACTIVITY_PURPOSE_LABELS[activity.purpose]}
                </span>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{activity.summary}</p>
              {activity.measurements ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-medium">Measurements:</span> {activity.measurements}
                </p>
              ) : null}
              {activity.location_note ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-medium">Location:</span> {activity.location_note}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                <time dateTime={activity.occurred_at} title={formatDateTime(activity.occurred_at)}>
                  {relativeDays(activity.occurred_at)}
                </time>
                {/* Reassignment never rewrites history: this stays the person who
                    actually made the call (§8.1). */}
                {performerNames?.[activity.performed_by]
                  ? ` · ${performerNames[activity.performed_by]}`
                  : null}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
