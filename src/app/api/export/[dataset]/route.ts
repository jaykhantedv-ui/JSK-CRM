import { NextResponse, type NextRequest } from 'next/server'

import { isAppError } from '@/lib/errors'
import { buildExport, isExportDataset } from '@/services/export.service'

/**
 * CSV export (§3.1, decision C-2, Master Phase 3 §17).
 *
 * A route handler does exactly four things (CLAUDE.md §8): **authenticate,
 * validate, call a service, map errors.** There is no business rule below and no
 * database call — `buildExport` performs the role check, reads through the
 * caller's own session so RLS applies, and refuses anything over the row limit.
 *
 * **The role check is here, on the server, not on the button.** A manager's
 * browser renders an Export control; an ADMIN's does not. That difference is
 * cosmetic. What actually refuses an ADMIN is `canExportCsv()` inside the service
 * — and this route is the surface the security suite attacks to prove it (§19.4).
 *
 * `force-dynamic` because the response depends on the caller's session and their
 * query string. A cached export would be somebody else's data (§25).
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dataset: string }> },
) {
  const { dataset } = await params

  if (!isExportDataset(dataset)) {
    return NextResponse.json({ error: 'There is no export by that name.' }, { status: 404 })
  }

  const raw = Object.fromEntries(request.nextUrl.searchParams.entries())

  try {
    const result = await buildExport(dataset, raw)

    return new NextResponse(result.csv, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        // The filename is built by `csvFilename()`, which strips everything
        // outside `[a-z0-9-]`. A header is one of the few places where refusing
        // input beats escaping it.
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        // An export is one caller's filtered view of their own scope. Nothing
        // between here and the browser may keep a copy (§25).
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * The error contract (§16.2) as an HTTP status.
 *
 * FORBIDDEN is 403 with the service's own sentence, so a salesperson or an ADMIN
 * hitting this route directly is told plainly that export is not theirs — not
 * handed a CSV, and not left guessing at a 500.
 */
function errorResponse(error: unknown): NextResponse {
  if (isAppError(error)) {
    const status =
      error.code === 'FORBIDDEN'
        ? 403
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'VALIDATION_FAILED'
            ? 400
            : 500

    return NextResponse.json({ error: error.message, code: error.code }, { status })
  }

  // Never surface an unrecognised error's own words: they leak schema detail and
  // mean nothing to the person reading them (§16.2).
  console.error('Export failed', error)
  return NextResponse.json({ error: 'That export could not be produced.' }, { status: 500 })
}
