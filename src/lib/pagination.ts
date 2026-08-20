/**
 * List pagination (§12.8).
 *
 * **No unbounded list query anywhere.** Every list in the application goes
 * through `pageRange()`, so a missing or hostile `?page=` cannot turn a screen
 * into a full table scan.
 *
 * 25 on mobile, 50 on desktop. The server cannot see the viewport, so the page
 * size is a parameter the route passes rather than something guessed here.
 */

export const MOBILE_PAGE_SIZE = 25
export const DESKTOP_PAGE_SIZE = 50

/** The hard ceiling. A caller asking for more gets this, not an error. */
export const MAX_PAGE_SIZE = 100

export type PageParams = { page: number; pageSize: number }

/** Parse `?page=` and a requested size into something safe. Never throws. */
export function parsePageParams(
  raw: { page?: string | string[] | null; pageSize?: string | string[] | null } = {},
  fallbackSize: number = DESKTOP_PAGE_SIZE,
): PageParams {
  const first = (value: string | string[] | null | undefined) =>
    Array.isArray(value) ? value[0] : value

  const page = Number.parseInt(first(raw.page) ?? '', 10)
  const size = Number.parseInt(first(raw.pageSize) ?? '', 10)

  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize:
      Number.isFinite(size) && size > 0 ? Math.min(size, MAX_PAGE_SIZE) : Math.min(fallbackSize, MAX_PAGE_SIZE),
  }
}

/** The inclusive `[from, to]` a PostgREST `.range()` call wants. */
export function pageRange({ page, pageSize }: PageParams): { from: number; to: number } {
  const from = (page - 1) * pageSize
  return { from, to: from + pageSize - 1 }
}

export type Paginated<T> = {
  rows: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasPrevious: boolean
  hasNext: boolean
}

export function paginate<T>(rows: T[], total: number, params: PageParams): Paginated<T> {
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize))
  return {
    rows,
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages,
    hasPrevious: params.page > 1,
    hasNext: params.page < totalPages,
  }
}
