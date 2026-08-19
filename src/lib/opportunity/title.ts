import type { Database } from '@/types/database.types'

/**
 * The auto-generated opportunity title (§8.4).
 *
 *   `{project name or account name} — {category} — {MMM yy}`
 *
 * Editable by the user afterwards — this is a starting point, not a format the
 * record is held to. It exists so the primary mobile flow (§11.1, sixty seconds)
 * never asks a salesperson to name something before they have described it.
 *
 * The month is the Asia/Kolkata month, not the server's: a deal created at 11pm
 * IST on 31 August must not be titled "Sep 26" (CLAUDE.md §10).
 */

type Category = Database['public']['Enums']['product_category']

export const CATEGORY_LABELS: Record<Category, string> = {
  TILES: 'Tiles',
  MARBLE: 'Marble',
  GRANITE: 'Granite',
  SANITARYWARE: 'Sanitaryware',
  CP_FITTINGS: 'CP Fittings',
  ALLIED: 'Allied',
  MIXED: 'Mixed',
}

// `en-US`, not `en-GB`: the latter abbreviates September to "Sept" and every
// other month to three letters, so titles would not line up. See lib/dates.ts.
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  month: 'short',
  year: '2-digit',
})

export function opportunityTitle(input: {
  accountName: string
  projectName?: string | null
  category: Category
  now?: Date | string
}): string {
  const subject = input.projectName?.trim() || input.accountName.trim()
  const when = MONTH_YEAR.format(
    input.now instanceof Date ? input.now : input.now ? new Date(input.now) : new Date(),
  )
  return `${subject} — ${CATEGORY_LABELS[input.category]} — ${when}`
}
