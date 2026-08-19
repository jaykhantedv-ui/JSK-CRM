'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'

import { StageBadge } from '@/components/shared/stage-badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { IDLE_FORM_STATE } from '@/lib/form-state'
import { LOST_REASON_LABELS, STAGE_LABELS, optionsFrom } from '@/lib/labels'
import { isBackward, type Stage } from '@/lib/opportunity/transitions'
import { changeStageAction } from './actions'

/**
 * The stage control (§11.7, §11.8).
 *
 * The list of targets comes from the server, which built it from the transition
 * matrix for this user's role. **This component decides nothing** — it collects
 * the fields §9.3 requires for the chosen target and posts them. An invalid
 * transition should be unreachable from here, and the service rejects it anyway
 * (CLAUDE.md §8).
 *
 * Which extra fields appear is driven by the target stage:
 *   `quoted` → quotation reference, date and quoted value (`quoted_requires_quotation`)
 *   `won`    → confirmed order value (`won_requires_value`)
 *   `lost`   → a reason (`lost_requires_reason`)
 *   `nurture`→ a date to revisit (`nurture_needs_date`)
 *   backward → a reason, stored on the audit row
 */
export function StageControl({
  opportunityId,
  currentStage,
  allowedStages,
  quotationRef,
  quotationDate,
}: {
  opportunityId: string
  currentStage: Stage
  allowedStages: Stage[]
  quotationRef: string | null
  quotationDate: string | null
}) {
  const boundAction = changeStageAction.bind(null, opportunityId)
  const [state, formAction, pending] = useActionState(boundAction, IDLE_FORM_STATE)
  const [target, setTarget] = useState<Stage | ''>('')
  const router = useRouter()

  useEffect(() => {
    if (state.ok) {
      setTarget('')
      router.refresh()
    }
  }, [state.ok, router])

  const backward = target ? isBackward(currentStage, target as Stage) : false

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Stage</span>
        <StageBadge stage={currentStage} />
      </div>

      {allowedStages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This opportunity is closed. A manager can reopen it if it was closed in error.
        </p>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          {state.error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {allowedStages.map((stage) => (
              <Button
                key={stage}
                variant={target === stage ? 'primary' : 'outline'}
                size="sm"
                aria-pressed={target === stage}
                onClick={() => setTarget(stage)}
              >
                {STAGE_LABELS[stage]}
              </Button>
            ))}
          </div>

          {target ? (
            <div className="flex flex-col gap-3 rounded-md border border-border p-3">
              <input type="hidden" name="toStage" value={target} />
              <p className="text-sm">
                Move to <span className="font-medium">{STAGE_LABELS[target as Stage]}</span>
              </p>

              {target === 'quoted' ? (
                <>
                  <Field label="Quotation reference" htmlFor="quotationRef" required error={state.fieldErrors.quotationRef}>
                    <Input id="quotationRef" name="quotationRef" required defaultValue={quotationRef ?? ''} />
                  </Field>
                  <Field label="Quotation date" htmlFor="quotationDate" required>
                    <Input id="quotationDate" name="quotationDate" type="date" required defaultValue={quotationDate ?? ''} />
                  </Field>
                  <Field label="Quoted value" htmlFor="quotedValue" required hint="In rupees.">
                    <Input id="quotedValue" name="quotedValue" inputMode="decimal" required />
                  </Field>
                </>
              ) : null}

              {target === 'won' ? (
                <>
                  <Field
                    label="Confirmed order value"
                    htmlFor="finalOrderValue"
                    required
                    error={state.fieldErrors.finalOrderValue ?? state.fieldErrors.final_order_value}
                    hint="In rupees. This is what the customer actually ordered."
                  >
                    <Input id="finalOrderValue" name="finalOrderValue" inputMode="decimal" required />
                  </Field>
                  <Field label="Order reference" htmlFor="orderReference" hint="Optional — the reference used in your accounting system.">
                    <Input id="orderReference" name="orderReference" />
                  </Field>
                </>
              ) : null}

              {target === 'lost' ? (
                <>
                  <Field label="Why was it lost?" htmlFor="lostReason" required error={state.fieldErrors.lostReason ?? state.fieldErrors.lost_reason}>
                    <Select
                      id="lostReason"
                      name="lostReason"
                      required
                      placeholder="Choose a reason"
                      options={optionsFrom(LOST_REASON_LABELS)}
                    />
                  </Field>
                  <Field label="Detail" htmlFor="lostDetail">
                    <Textarea id="lostDetail" name="lostDetail" rows={2} />
                  </Field>
                  <Field label="Competitor" htmlFor="competitor">
                    <Input id="competitor" name="competitor" />
                  </Field>
                </>
              ) : null}

              {target === 'nurture' ? (
                <Field
                  label="When should we revisit this?"
                  htmlFor="nextActionDate"
                  required
                  error={state.fieldErrors.nextActionDate ?? state.fieldErrors.next_action_date}
                  hint="Nurture is for genuine future business. Anything sooner than two weeks probably belongs in the pipeline."
                >
                  <>
                    <input type="hidden" name="nextAction" value="AWAIT_CUSTOMER" />
                    <Input id="nextActionDate" name="nextActionDate" type="date" required />
                  </>
                </Field>
              ) : null}

              {backward ? (
                <Field
                  label="Why is this moving back?"
                  htmlFor="reason"
                  required
                  error={state.fieldErrors.reason}
                  hint="Recorded permanently on the opportunity's history."
                >
                  <Textarea id="reason" name="reason" rows={2} required />
                </Field>
              ) : null}

              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? 'Saving…' : `Move to ${STAGE_LABELS[target as Stage]}`}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setTarget('')} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      )}
    </div>
  )
}
