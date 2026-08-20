'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  moneyField, optionalField, requireField, stateFromError, valuesFrom, type FormState,
} from '@/lib/form-state'
import { rupeesToPaise } from '@/lib/money'
import {
  bulkReassign, changeOpportunityStage, createOpportunity, markOpportunityLost,
  markOpportunityWon, reassignOpportunity, reopenOpportunity, updateNextAction,
  updateOpportunity,
} from '@/services/opportunity.service'
import type { Stage } from '@/lib/opportunity/transitions'
import {
  attachQuotationFile,
  createSignedDownloadUrl,
  createSignedUpload,
} from '@/services/storage.service'

/**
 * Opportunity Server Actions.
 *
 * Every one of them hands straight to a service. **No transition rule, no
 * required-field rule and no role rule is decided here** — the matrix lives in
 * `lib/opportunity/transitions.ts`, the required fields are check constraints,
 * and the role gate is RLS (CLAUDE.md §8).
 */

const optionalMoney = (formData: FormData, name: string): number | null => {
  const raw = optionalField(formData, name)
  return raw ? rupeesToPaise(raw) : null
}

export async function createOpportunityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)
  let opportunityId: string

  try {
    const opportunity = await createOpportunity({
      accountId: requireField(formData, 'accountId', 'Choose the customer.'),
      projectId: optionalField(formData, 'projectId'),
      outletId: requireField(formData, 'outletId', 'Choose the branch.'),
      category: requireField(formData, 'category', 'Choose a category.') as never,
      estimatedValuePaise: moneyField(formData, 'estimatedValue', 'Enter the estimated value in rupees.'),
      title: optionalField(formData, 'title'),
      materialNotes: optionalField(formData, 'materialNotes'),
      expectedCloseDate: optionalField(formData, 'expectedCloseDate'),
      nextAction: optionalField(formData, 'nextAction') as never,
      nextActionDate: optionalField(formData, 'nextActionDate'),
      nextActionNote: optionalField(formData, 'nextActionNote'),
      source: (optionalField(formData, 'source') ?? 'WALK_IN') as never,
    })
    opportunityId = opportunity.id
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath('/opportunities')
  revalidatePath('/today')
  redirect(`/opportunities/${opportunityId}`)
}

export async function updateOpportunityAction(
  opportunityId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)

  try {
    await updateOpportunity(opportunityId, {
      title: requireField(formData, 'title', 'Give this enquiry a title.'),
      category: requireField(formData, 'category', 'Choose a category.') as never,
      estimatedValuePaise: moneyField(formData, 'estimatedValue', 'Enter the estimated value in rupees.'),
      materialNotes: optionalField(formData, 'materialNotes'),
      expectedCloseDate: optionalField(formData, 'expectedCloseDate'),
      projectId: optionalField(formData, 'projectId'),
      quotationRef: optionalField(formData, 'quotationRef'),
      quotationDate: optionalField(formData, 'quotationDate'),
      quotedValuePaise: optionalMoney(formData, 'quotedValue'),
      quotationStatus: optionalField(formData, 'quotationStatus') as never,
      quotationValidUntil: optionalField(formData, 'quotationValidUntil'),
      competitor: optionalField(formData, 'competitor'),
    })
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath(`/opportunities/${opportunityId}`)
  redirect(`/opportunities/${opportunityId}`)
}

/**
 * §11.6 — the most-used write in the product.
 *
 * Writes only the two next-action fields. "Can't say yet" clears them, which is a
 * deliberate state and not an error (§8.3).
 */
export async function updateNextActionAction(
  opportunityId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)

  try {
    if (formData.get('clearNextAction') === '1') {
      await updateNextAction(opportunityId, null)
    } else {
      await updateNextAction(opportunityId, {
        nextAction: requireField(formData, 'nextAction', 'Choose what to do next.') as never,
        nextActionDate: requireField(formData, 'nextActionDate', 'Choose a date.'),
        nextActionNote: optionalField(formData, 'nextActionNote'),
      })
    }
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath(`/opportunities/${opportunityId}`)
  revalidatePath('/today')
  return { ok: true, error: null, fieldErrors: {} }
}

/** §11.7 — one entry point for every stage change, including won and lost. */
export async function changeStageAction(
  opportunityId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)
  const toStage = requireField(formData, 'toStage', 'Choose a stage.') as Stage

  try {
    if (toStage === 'won') {
      await markOpportunityWon(opportunityId, {
        finalOrderValuePaise: moneyField(
          formData,
          'finalOrderValue',
          'Enter the confirmed order value before marking this won.',
        ),
        orderReference: optionalField(formData, 'orderReference'),
      })
    } else if (toStage === 'lost') {
      await markOpportunityLost(opportunityId, {
        lostReason: requireField(formData, 'lostReason', 'Choose a reason before marking this lost.') as never,
        lostDetail: optionalField(formData, 'lostDetail'),
        competitor: optionalField(formData, 'competitor'),
      })
    } else {
      await changeOpportunityStage(
        opportunityId,
        toStage,
        {
          quotationRef: optionalField(formData, 'quotationRef'),
          quotationDate: optionalField(formData, 'quotationDate'),
          quotedValuePaise: optionalMoney(formData, 'quotedValue'),
          nextAction: optionalField(formData, 'nextAction') as never,
          nextActionDate: optionalField(formData, 'nextActionDate'),
        },
        optionalField(formData, 'reason'),
      )
    }
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath(`/opportunities/${opportunityId}`)
  revalidatePath('/opportunities')
  revalidatePath('/today')
  return { ok: true, error: null, fieldErrors: {} }
}

/** ADR-007 — MANAGER/OWNER only, reason required. The WON event is preserved. */
export async function reopenOpportunityAction(
  opportunityId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await reopenOpportunity(opportunityId, requireField(formData, 'reason', 'Give a reason for reopening this.'))
  } catch (error) {
    return stateFromError(error, valuesFrom(formData))
  }

  revalidatePath(`/opportunities/${opportunityId}`)
  return { ok: true, error: null, fieldErrors: {} }
}

/** §11.9 — MANAGER/OWNER only. Activities keep their original `performed_by`. */
export async function reassignOpportunityAction(
  opportunityId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await reassignOpportunity(
      opportunityId,
      requireField(formData, 'ownerId', 'Choose who should own this.'),
      requireField(formData, 'reason', 'Give a reason for the reassignment.'),
    )
  } catch (error) {
    return stateFromError(error, valuesFrom(formData))
  }

  revalidatePath(`/opportunities/${opportunityId}`)
  revalidatePath('/opportunities')
  return { ok: true, error: null, fieldErrors: {} }
}

export async function bulkReassignAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const result = await bulkReassign(
      requireField(formData, 'fromUserId', 'Choose whose work to move.'),
      requireField(formData, 'toUserId', 'Choose who should receive it.'),
      requireField(formData, 'reason', 'Give a reason for the reassignment.'),
    )
    revalidatePath('/opportunities')
    return { ok: true, error: null, fieldErrors: {}, values: { moved: String(result.moved) } }
  } catch (error) {
    return stateFromError(error, valuesFrom(formData))
  }
}

/**
 * §8.6 — quotation PDFs on the opportunity.
 *
 * Lightweight by design: the quotation document itself is produced in the
 * existing system, and V1 stores a reference plus the file. **No line items, no
 * pricing engine, no revision table, no quotation table** — the paths live on the
 * opportunity row (migration 024) exactly as site-visit photos live on the
 * activity.
 */
export async function requestQuotationUploadAction(input: {
  entityId: string
  fileName: string
  size: number
  mimeType: string
  head: string
}) {
  const { path, token } = await createSignedUpload({
    entityType: 'opportunity',
    entityId: input.entityId,
    fileName: input.fileName,
    size: input.size,
    mimeType: input.mimeType,
    head: input.head,
  })
  return { path, token }
}

export async function attachQuotationFileAction(input: { entityId: string; path: string }) {
  const paths = await attachQuotationFile(input)
  revalidatePath(`/opportunities/${input.entityId}`)
  return paths
}

/**
 * A 60-second URL for one stored file (§15.6).
 *
 * Minted on demand rather than rendered into the page: a URL embedded in HTML
 * outlives the page in a browser history, and a minute is the whole point.
 */
export async function getFileUrlAction(path: string): Promise<string> {
  return createSignedDownloadUrl(path)
}
