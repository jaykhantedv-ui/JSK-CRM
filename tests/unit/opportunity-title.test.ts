import { describe, expect, it } from 'vitest'

import { CATEGORY_LABELS, opportunityTitle } from '@/lib/opportunity/title'
import { MAX_PAGE_SIZE, pageRange, paginate, parsePageParams } from '@/lib/pagination'

/**
 * The auto-generated title (§8.4) and list pagination (§12.8).
 *
 * Both are small, and both are the kind of thing that silently goes wrong: a
 * title generated in the server's month rather than the customer's, or a page
 * parameter from a URL nobody validated turning a list into a full table scan.
 */
describe('opportunity title (§8.4)', () => {
  const AUGUST = '2026-08-19T06:00:00Z'

  it('uses the project name when there is one', () => {
    expect(
      opportunityTitle({
        accountName: 'Ravi Kumar',
        projectName: 'Ravi House Flooring',
        category: 'TILES',
        now: AUGUST,
      }),
    ).toBe('Ravi House Flooring — Tiles — Aug 26')
  })

  it('falls back to the customer name when there is no site', () => {
    expect(opportunityTitle({ accountName: 'Ravi Kumar', category: 'GRANITE', now: AUGUST })).toBe(
      'Ravi Kumar — Granite — Aug 26',
    )
  })

  it('treats a blank project name as no project', () => {
    expect(
      opportunityTitle({ accountName: 'Ravi Kumar', projectName: '   ', category: 'MARBLE', now: AUGUST }),
    ).toBe('Ravi Kumar — Marble — Aug 26')
  })

  it('uses the Asia/Kolkata month, not the server month', () => {
    // 31 Aug 2026 at 23:00 IST is 17:30 UTC on the 31st — same month either way.
    expect(
      opportunityTitle({ accountName: 'Late Enquiry', category: 'TILES', now: '2026-08-31T17:30:00Z' }),
    ).toContain('Aug 26')

    // 1 Sep 2026 at 00:30 IST is 19:00 UTC on 31 Aug. In IST the month has
    // turned; a UTC-based month would still title this "Aug 26".
    expect(
      opportunityTitle({ accountName: 'Late Enquiry', category: 'TILES', now: '2026-08-31T19:00:00Z' }),
    ).toContain('Sep 26')
  })

  it('has a readable label for every product category', () => {
    for (const [value, label] of Object.entries(CATEGORY_LABELS)) {
      expect(label).not.toBe(value)
      expect(label).not.toMatch(/_/)
    }
  })
})

describe('pagination (§12.8 — no unbounded list query anywhere)', () => {
  it('defaults to page 1 with the size the caller asked for', () => {
    expect(parsePageParams({}, 25)).toEqual({ page: 1, pageSize: 25 })
  })

  it('ignores a page number that is not a positive integer', () => {
    // These arrive from a URL a user can edit, so none of them may throw and none
    // may produce an unbounded or negative range.
    for (const page of ['0', '-3', 'abc', '', 'NaN', '1e9999']) {
      expect(parsePageParams({ page }, 25).page).toBeGreaterThanOrEqual(1)
    }
  })

  it('caps a hostile page size rather than honouring it', () => {
    expect(parsePageParams({ pageSize: '100000' }, 25).pageSize).toBe(MAX_PAGE_SIZE)
  })

  it('takes the first value when a param is repeated in the query string', () => {
    expect(parsePageParams({ page: ['3', '9'] }, 25).page).toBe(3)
  })

  it('turns a page into the inclusive range PostgREST wants', () => {
    expect(pageRange({ page: 1, pageSize: 25 })).toEqual({ from: 0, to: 24 })
    expect(pageRange({ page: 3, pageSize: 25 })).toEqual({ from: 50, to: 74 })
  })

  it('reports at least one page even when there is nothing to show', () => {
    const empty = paginate([], 0, { page: 1, pageSize: 25 })
    expect(empty.totalPages).toBe(1)
    expect(empty.hasNext).toBe(false)
    expect(empty.hasPrevious).toBe(false)
  })

  it('knows where it is in a multi-page list', () => {
    const middle = paginate([1, 2], 60, { page: 2, pageSize: 25 })
    expect(middle.totalPages).toBe(3)
    expect(middle.hasPrevious).toBe(true)
    expect(middle.hasNext).toBe(true)
  })
})
