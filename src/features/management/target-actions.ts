'use server'

import { revalidatePath } from 'next/cache'

import { optionalField, requireField, stateFromError, valuesFrom, type FormState } from '@/lib/form-state'
import { rupeesToPaise } from '@/lib/money'
import { setTarget } from '@/services/target.service'

/**
 * The sales-target Server Action (§10).
 *
 * Four things and no more (CLAUDE.md §8): authenticate — done inside the service
 * by `requireUser()` — validate, call a service, map errors. Who may set which
 * target is `target.service.ts` and the RLS policies on `sales_targets`; none of
 * that rule is restated here.
 *
 * **Rupees become paise at this boundary and nowhere else** (CLAUDE.md §9). A
 * manager types "5,00,000" and `50000000` is stored. Note the deliberate absence
 * of `parseFloat`: `rupeesToPaise` parses the whole and fractional parts as
 * integers, so no float ever touches the amount.
 */
export async function setTargetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)

  try {
    const rupees = optionalField(formData, 'targetRupees')
    // An empty box is a target of ZERO, not an absent one. `sales_targets` has no
    // DELETE policy (ADR-021, CLAUDE.md §11), so zero is how a target is
    // withdrawn — and `targetProgress()` renders a zero target as met rather than
    // as a 0% failure.
    const paise = rupees === undefined ? 0 : (rupeesToPaise(rupees) ?? 0)

    await setTarget({
      periodMonth: requireField(formData, 'periodMonth', 'Choose the month this target covers.'),
      outletId: optionalField(formData, 'outletId') ?? null,
      userId: optionalField(formData, 'userId') ?? null,
      targetPaise: paise,
      note: optionalField(formData, 'note') ?? null,
    })
  } catch (error) {
    return stateFromError(error, values)
  }

  // The dashboard's Won-Value tile compares against this figure, so it has to be
  // refreshed alongside the target screen itself.
  revalidatePath('/reports/targets')
  revalidatePath('/dashboard')
  revalidatePath('/reports/won-lost')

  return { ok: true, error: null, fieldErrors: {} }
}
