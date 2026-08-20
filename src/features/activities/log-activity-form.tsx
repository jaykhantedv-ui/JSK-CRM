'use client'

import {
  FileText, Mail, MapPin, MessageCircle, Phone, Store, Users,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'

import { FileUpload, type UploadRequest, type UploadTicket } from '@/components/shared/file-upload'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state'
import {
  ACTIVITY_OUTCOME_LABELS, ACTIVITY_PURPOSE_LABELS, ACTIVITY_TYPE_LABELS, optionsFrom,
} from '@/lib/labels'
import { NEXT_ACTION_LABELS, quickDates } from '@/lib/next-action'
import { cn } from '@/lib/utils'
import type { ActivityType } from '@/types/domain'

/**
 * Log an activity — **three taps** (§11.5).
 *
 *   1. type (icon row)
 *   2. outcome (chips)
 *   3. summary, then "What's next?" as quick-date buttons
 *
 * Purpose defaults from the type and stays collapsed, because asking for
 * something the type already implies costs a tap and buys nothing.
 *
 * The next-action row includes **"Can't say yet"**, which is a real answer that
 * clears the fields and puts the opportunity on the exception list. §8.3 is
 * explicit that the application must not hard-block here: blocking produces
 * fabricated dates, which is worse than a visible gap.
 *
 * For a site visit, measurements and a location note appear — and, once the
 * visit is saved, a photo upload.
 *
 * **The photo step is deliberately after the save, not part of it** (§11.5).
 * An upload failure must not block the activity: the visit is committed the
 * moment "Log it" succeeds, and the photographs are a second step that can be
 * retried or abandoned without costing the salesperson the measurements they
 * took standing on a building site.
 */
const TYPE_ICONS: Record<ActivityType, typeof Phone> = {
  CALL: Phone,
  WHATSAPP: MessageCircle,
  SHOWROOM_VISIT: Store,
  SITE_VISIT: MapPin,
  MEETING: Users,
  EMAIL: Mail,
  NOTE: FileText,
}

const DEFAULT_PURPOSE: Record<ActivityType, string> = {
  CALL: 'FOLLOW_UP',
  WHATSAPP: 'FOLLOW_UP',
  SHOWROOM_VISIT: 'PRODUCT_DISCUSSION',
  SITE_VISIT: 'SITE_MEASUREMENT',
  MEETING: 'PRODUCT_DISCUSSION',
  EMAIL: 'QUOTATION_DISCUSSION',
  NOTE: 'OTHER',
}

export function LogActivityForm({
  action,
  opportunities,
  defaultOpportunityId,
  defaultType = 'CALL',
  showNextAction = true,
  onDone,
  requestPhotoUpload,
  attachPhoto,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>
  opportunities: { id: string; title: string; stage: string }[]
  defaultOpportunityId?: string | null
  defaultType?: ActivityType
  showNextAction?: boolean
  onDone?: () => void
  /** Both or neither. Without them a site visit simply has no photo step. */
  requestPhotoUpload?: (input: UploadRequest) => Promise<UploadTicket>
  attachPhoto?: (input: { entityId: string; path: string }) => Promise<string[]>
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE)
  const [type, setType] = useState<ActivityType>(defaultType)
  // Purpose defaults from the type and stays collapsed (§11.5), but it is a
  // default rather than a rule: once the user overrides it, changing the type
  // must not silently undo their choice.
  const [purpose, setPurpose] = useState(DEFAULT_PURPOSE[defaultType])
  const [purposeTouched, setPurposeTouched] = useState(false)
  const [outcome, setOutcome] = useState('NEUTRAL')
  const [nextActionDate, setNextActionDate] = useState('')
  const [cannotSay, setCannotSay] = useState(false)
  const router = useRouter()

  const dates = quickDates()

  // The saved activity is waiting for its photographs. The panel stays open;
  // everything else about the activity is already committed.
  const photoStage = Boolean(
    state.ok && state.createdId && type === 'SITE_VISIT' && requestPhotoUpload && attachPhoto,
  )

  useEffect(() => {
    if (!state.ok) return
    router.refresh()
    // Closing here would take the retry with it, so a site visit with photos to
    // add closes itself when the user says it is finished.
    if (!photoStage) onDone?.()
  }, [state.ok, photoStage, onDone, router])

  if (photoStage && state.createdId && requestPhotoUpload && attachPhoto) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Site visit saved. Add photographs if you have them — the visit is already recorded
          either way.
        </p>
        <FileUpload
          entityId={state.createdId}
          requestUpload={requestPhotoUpload}
          attach={attachPhoto}
          label="Add photos"
          accept="image/jpeg,image/png,image/webp"
        />
        <Button type="button" variant="secondary" onClick={() => onDone?.()}>
          Done
        </Button>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="outcome" value={outcome} />
      <input type="hidden" name="clearNextAction" value={cannotSay ? '1' : '0'} />

      {/* Tap 1 — what kind of contact was this? */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">What happened?</legend>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {(Object.keys(TYPE_ICONS) as ActivityType[]).map((option) => {
            const Icon = TYPE_ICONS[option]
            const active = type === option
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setType(option)
                  if (!purposeTouched) setPurpose(DEFAULT_PURPOSE[option])
                }}
                aria-pressed={active}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px] transition-colors',
                  active ? 'border-primary bg-secondary font-medium' : 'border-border hover:bg-accent',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {ACTIVITY_TYPE_LABELS[option]}
              </button>
            )
          })}
        </div>
      </fieldset>

      {/* Tap 2 — how did it go? */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">How did it go?</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ACTIVITY_OUTCOME_LABELS) as (keyof typeof ACTIVITY_OUTCOME_LABELS)[]).map((option) => (
            <Button
              key={option}
              variant={outcome === option ? 'primary' : 'outline'}
              size="sm"
              aria-pressed={outcome === option}
              onClick={() => setOutcome(option)}
            >
              {ACTIVITY_OUTCOME_LABELS[option]}
            </Button>
          ))}
        </div>
      </fieldset>

      {/* Tap 3 — what was said. */}
      <Field label="Summary" htmlFor="summary" required error={state.fieldErrors.summary}>
        <Textarea
          id="summary"
          name="summary"
          rows={3}
          required
          minLength={3}
          placeholder="Wants 600x600 vitrified for the hall. Comparing with Kajaria."
          defaultValue={state.values?.summary}
        />
      </Field>

      {opportunities.length > 0 ? (
        <Field label="Which enquiry?" htmlFor="opportunityId" hint="Optional — leave blank to log against the customer only.">
          <Select
            id="opportunityId"
            name="opportunityId"
            defaultValue={defaultOpportunityId ?? ''}
            placeholder="Not linked to an enquiry"
            options={opportunities.map((row) => ({ value: row.id, label: row.title }))}
          />
        </Field>
      ) : null}

      {/* §11.5 — site visits carry measurements and a location note. */}
      {type === 'SITE_VISIT' ? (
        <>
          <Field label="Measurements" htmlFor="measurements">
            <Textarea
              id="measurements"
              name="measurements"
              rows={2}
              placeholder="Hall 18x14, 2 bedrooms 12x11, 3 bathrooms"
              defaultValue={state.values?.measurements}
            />
          </Field>
          <Field label="Location note" htmlFor="locationNote">
            <Input id="locationNote" name="locationNote" defaultValue={state.values?.locationNote} />
          </Field>
        </>
      ) : null}

      {showNextAction ? (
        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">What&apos;s next?</legend>
          <div className="flex flex-wrap gap-2">
            {dates.map((option) => (
              <Button
                key={option.date}
                variant={!cannotSay && nextActionDate === option.date ? 'primary' : 'outline'}
                size="sm"
                onClick={() => {
                  setCannotSay(false)
                  setNextActionDate(option.date)
                }}
              >
                {option.label}
              </Button>
            ))}
            {/* §8.3 — a real answer, not a failure to fill the form in. */}
            <Button
              variant={cannotSay ? 'primary' : 'outline'}
              size="sm"
              onClick={() => {
                setCannotSay(true)
                setNextActionDate('')
              }}
            >
              Can&apos;t say yet
            </Button>
          </div>

          {!cannotSay ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                aria-label="Next action type"
                name="nextAction"
                defaultValue="CALL"
                options={optionsFrom(NEXT_ACTION_LABELS)}
              />
              <Input
                aria-label="Next action date"
                name="nextActionDate"
                type="date"
                value={nextActionDate}
                onChange={(event) => setNextActionDate(event.target.value)}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              This enquiry will appear under &ldquo;Missing next action&rdquo; on Today until you set one.
            </p>
          )}

          {state.fieldErrors.nextActionDate ? (
            <p role="alert" className="text-sm text-destructive">
              {state.fieldErrors.nextActionDate}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Change purpose or time</summary>
        <div className="mt-3 flex flex-col gap-3">
          <Field label="Purpose" htmlFor="purposeVisible">
            <Select
              id="purposeVisible"
              name="purpose"
              value={purpose}
              onChange={(event) => {
                setPurpose(event.target.value)
                setPurposeTouched(true)
              }}
              options={optionsFrom(ACTIVITY_PURPOSE_LABELS)}
            />
          </Field>
          <Field label="When did this happen?" htmlFor="occurredAt" hint="Leave blank for now.">
            <Input id="occurredAt" name="occurredAt" type="datetime-local" />
          </Field>
        </div>
      </details>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Saving…' : 'Log it'}
      </Button>
    </form>
  )
}
