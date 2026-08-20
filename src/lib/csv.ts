import { paiseToRupees } from '@/lib/money'

/**
 * CSV serialisation for management exports (§3.1, decision C-2).
 *
 * **This is a boundary, and two things cross it that must be handled
 * deliberately.**
 *
 * 1. **Money leaves as rupees.** Paise are the storage unit and nothing outside
 *    the database understands them (CLAUDE.md §9). A spreadsheet column reading
 *    `4200000` when the deal was ₹42,000 is the kind of error that ends up in a
 *    meeting.
 *
 * 2. **A cell is data, never a formula.** Excel and LibreOffice execute a cell
 *    beginning `=`, `+`, `-`, `@` or a control character, so a customer named
 *    `=HYPERLINK(...)` becomes code the moment a manager opens the export. Every
 *    such cell is prefixed with an apostrophe here. This is the export half of
 *    the same rule that makes the application escape what it renders (§25).
 */

export type CsvColumn<T> = {
  key: string
  header: string
  /** Returns the cell as a primitive. Money columns return PAISE; see `money`. */
  value: (row: T) => string | number | null | undefined
  /** Marks a paise column, converted to rupees on the way out. */
  money?: boolean
}

/** Cells that a spreadsheet would execute rather than display. */
const FORMULA_START = /^[=+\-@\t\r]/

function escapeCell(raw: string | number | null | undefined, isMoney: boolean): string {
  if (raw === null || raw === undefined) return ''

  let text: string
  if (typeof raw === 'number') {
    // Rupees with two decimals: a spreadsheet reads it as a number, and the
    // paise are not lost the way a rounded display figure would lose them.
    text = isMoney ? paiseToRupees(raw).toFixed(2) : String(raw)
  } else {
    text = raw
  }

  // Neutralise a formula before quoting, not after: quoting alone does not stop
  // the spreadsheet, it only stops the CSV parser.
  if (FORMULA_START.test(text)) text = `'${text}`

  // RFC 4180 quoting. Applied whenever the cell contains a delimiter, a quote or
  // a newline — and to a leading apostrophe, so the guard survives the round trip.
  if (/[",\n\r]/.test(text) || text.startsWith("'")) {
    return `"${text.replace(/"/g, '""')}"`
  }

  return text
}

/**
 * Serialise rows to CSV.
 *
 * CRLF line endings and a UTF-8 byte-order mark, both for Excel on Windows:
 * without the BOM, `₹` and Tamil names in a customer list open as mojibake, and
 * the first thing the business would do is stop using the export.
 */
export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const header = columns.map((column) => escapeCell(column.header, false)).join(',')
  const body = rows.map((row) =>
    columns.map((column) => escapeCell(column.value(row), column.money ?? false)).join(','),
  )

  return `﻿${[header, ...body].join('\r\n')}\r\n`
}

/**
 * A safe download filename: `jsk-opportunities-2026-08-20.csv`.
 *
 * Everything outside `[a-z0-9-]` is stripped rather than escaped. A filename is
 * echoed straight into a `Content-Disposition` header, and a header is one of the
 * few places where "escape it properly" has more failure modes than "do not
 * accept it at all".
 */
export function csvFilename(dataset: string, isoDate: string): string {
  const safeDataset = dataset.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : 'export'
  return `jsk-${safeDataset || 'export'}-${safeDate}.csv`
}

export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'
