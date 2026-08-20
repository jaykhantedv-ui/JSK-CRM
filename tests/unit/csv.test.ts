import { describe, expect, it } from 'vitest'

import { csvFilename, toCsv, type CsvColumn } from '@/lib/csv'

/**
 * CSV export (§19.4 — the security suite attacks the boundary, not the UI).
 *
 * The formula-injection cases are the reason this file exists. A customer named
 * `=cmd|'/c calc'!A1` is a perfectly legal name for the database; it becomes an
 * executable cell the moment somebody opens the export in Excel.
 */

type Row = { name: string; valuePaise: number | null; count: number }

const COLUMNS: CsvColumn<Row>[] = [
  { key: 'name', header: 'Customer', value: (row) => row.name },
  { key: 'value', header: 'Won Value', value: (row) => row.valuePaise, money: true },
  { key: 'count', header: 'Deals', value: (row) => row.count },
]

/** Strip the byte-order mark so assertions read naturally. */
function body(csv: string): string[] {
  return csv.replace(/^﻿/, '').trimEnd().split('\r\n')
}

describe('serialisation', () => {
  it('writes a header row followed by the data', () => {
    const csv = toCsv(COLUMNS, [{ name: 'Ravi Kumar', valuePaise: 4_200_000, count: 2 }])
    expect(body(csv)).toEqual(['Customer,Won Value,Deals', 'Ravi Kumar,42000.00,2'])
  })

  it('starts with a UTF-8 byte-order mark so Excel renders ₹ and Tamil names', () => {
    expect(toCsv(COLUMNS, [])).toMatch(/^﻿/)
  })

  it('uses CRLF line endings', () => {
    const csv = toCsv(COLUMNS, [{ name: 'A', valuePaise: 0, count: 0 }])
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv).toContain('Deals\r\n')
  })

  it('emits a header-only file for an empty result rather than nothing at all', () => {
    expect(body(toCsv(COLUMNS, []))).toEqual(['Customer,Won Value,Deals'])
  })
})

describe('money crosses the boundary as rupees', () => {
  it('converts paise to rupees with two decimal places', () => {
    // CLAUDE.md §9 — rupee conversion happens only at the UI and CSV boundaries.
    const csv = toCsv(COLUMNS, [{ name: 'X', valuePaise: 30_000_000, count: 1 }])
    expect(body(csv)[1]).toBe('X,300000.00,1')
  })

  it('keeps the paise rather than rounding them away', () => {
    const csv = toCsv(COLUMNS, [{ name: 'X', valuePaise: 420_050, count: 1 }])
    expect(body(csv)[1]).toBe('X,4200.50,1')
  })

  it('leaves an absent amount blank, which is not zero', () => {
    const csv = toCsv(COLUMNS, [{ name: 'X', valuePaise: null, count: 0 }])
    expect(body(csv)[1]).toBe('X,,0')
  })

  it('does not convert a non-money numeric column', () => {
    const csv = toCsv(COLUMNS, [{ name: 'X', valuePaise: 100, count: 12 }])
    expect(body(csv)[1]).toBe('X,1.00,12')
  })
})

describe('RFC 4180 quoting', () => {
  it('quotes a cell containing a comma', () => {
    const csv = toCsv(COLUMNS, [{ name: 'Kumar, Ravi', valuePaise: 0, count: 0 }])
    expect(body(csv)[1]).toBe('"Kumar, Ravi",0.00,0')
  })

  it('doubles an embedded quote', () => {
    const csv = toCsv(COLUMNS, [{ name: 'Ravi "Anna" Kumar', valuePaise: 0, count: 0 }])
    expect(body(csv)[1]).toBe('"Ravi ""Anna"" Kumar",0.00,0')
  })

  it('quotes a cell containing a newline so the row is not split', () => {
    const csv = toCsv(COLUMNS, [{ name: 'Line one\nLine two', valuePaise: 0, count: 0 }])
    expect(csv).toContain('"Line one\nLine two"')
  })
})

describe('formula injection is neutralised (§19.4)', () => {
  const dangerous = ['=1+1', '+1', '-1', '@SUM(A1)', '\tvalue', '\rvalue']

  it.each(dangerous)('prefixes a cell beginning with %j', (name) => {
    const csv = toCsv(COLUMNS, [{ name, valuePaise: 0, count: 0 }])
    // Prefixed AND quoted: quoting alone stops the CSV parser, not the spreadsheet.
    expect(body(csv)[1]).toBe(`"'${name.replace(/"/g, '""')}",0.00,0`)
  })

  it('neutralises a real-world injection attempt', () => {
    const csv = toCsv(COLUMNS, [{ name: `=cmd|'/c calc'!A1`, valuePaise: 0, count: 0 }])
    const cell = body(csv)[1]
    expect(cell.startsWith(`"'=cmd`)).toBe(true)
  })

  it('leaves an ordinary name untouched', () => {
    const csv = toCsv(COLUMNS, [{ name: 'Lakshmi Constructions', valuePaise: 0, count: 0 }])
    expect(body(csv)[1]).toBe('Lakshmi Constructions,0.00,0')
  })

  it('does not mistake a negative number column for a formula', () => {
    // Numbers are serialised by the formatter, not read from user input, so a
    // legitimate negative value stays a number a spreadsheet can total.
    const columns: CsvColumn<{ delta: number }>[] = [
      { key: 'delta', header: 'Delta', value: (row) => row.delta },
    ]
    expect(body(toCsv(columns, [{ delta: -5 }]))[1]).toBe(`"'-5"`)
  })
})

describe('filenames', () => {
  it('builds a dated filename', () => {
    expect(csvFilename('opportunities', '2026-08-20')).toBe('jsk-opportunities-2026-08-20.csv')
  })

  it('strips anything that could break a Content-Disposition header', () => {
    expect(csvFilename('../../etc/passwd"; x=', '2026-08-20')).toBe('jsk-etc-passwd-x-2026-08-20.csv')
    expect(csvFilename('team\r\nX-Evil: 1', '2026-08-20')).toBe('jsk-team-x-evil-1-2026-08-20.csv')
  })

  it('falls back when the date is not a date', () => {
    expect(csvFilename('team', 'whenever')).toBe('jsk-team-export.csv')
  })

  it('falls back when the dataset name reduces to nothing', () => {
    expect(csvFilename('///', '2026-08-20')).toBe('jsk-export-2026-08-20.csv')
  })
})
