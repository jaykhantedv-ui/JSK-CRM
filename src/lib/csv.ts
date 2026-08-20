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

/**
 * Parse a CSV file (§20.1).
 *
 * Hand-rolled, and deliberately so: §17.1 freezes the dependency list, and the
 * subset of RFC 4180 an import file actually needs — quoted fields, escaped
 * quotes, embedded newlines, CRLF or LF, a UTF-8 BOM — is small enough to read in
 * one screen. A parser dependency would be more surface than the format.
 *
 * Headers are lower-cased and trimmed so `Owner Email`, `owner_email` and
 * `OWNER_EMAIL` are the same column. A business preparing its first export from a
 * paper register should not lose an afternoon to a capital letter.
 *
 * Rows shorter than the header are padded with empty strings rather than
 * rejected: a trailing empty column is the single most common thing a
 * spreadsheet emits, and treating it as a structural error would fail whole files
 * for nothing. A row with MORE cells than headers is a genuine misalignment and
 * is reported.
 */
export type ParsedCsv = {
  headers: string[]
  rows: Record<string, string>[]
  /** Row numbers (1-based, header excluded) whose cell count exceeded the header. */
  malformedRows: number[]
}

function splitCsv(text: string): string[][] {
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false

  // Strip the BOM Excel writes; left in place it becomes part of the first
  // header name and every lookup against that column misses.
  const source = text.replace(/^﻿/, '')

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote (RFC 4180).
        if (source[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      record.push(field)
      field = ''
    } else if (char === '\r') {
      // Consume CRLF as one terminator; a lone CR is treated the same way.
      if (source[i + 1] === '\n') i += 1
      record.push(field)
      records.push(record)
      field = ''
      record = []
    } else if (char === '\n') {
      record.push(field)
      records.push(record)
      field = ''
      record = []
    } else {
      field += char
    }
  }

  // The final record, when the file does not end with a newline.
  if (field.length > 0 || record.length > 0) {
    record.push(field)
    records.push(record)
  }

  return records
}

export function parseCsv(text: string): ParsedCsv {
  const records = splitCsv(text).filter(
    (record) => !(record.length === 1 && record[0].trim() === ''),
  )

  if (records.length === 0) return { headers: [], rows: [], malformedRows: [] }

  const headers = records[0].map((header) => header.trim().toLowerCase())
  const rows: Record<string, string>[] = []
  const malformedRows: number[] = []

  records.slice(1).forEach((record, index) => {
    if (record.length > headers.length) malformedRows.push(index + 1)

    const row: Record<string, string> = {}
    headers.forEach((header, column) => {
      row[header] = (record[column] ?? '').trim()
    })
    rows.push(row)
  })

  return { headers, rows, malformedRows }
}
