import { describe, expect, it } from 'vitest'

import { parseCsv, toCsv } from '@/lib/csv'

/**
 * The CSV parser (§20.1).
 *
 * Hand-rolled, so the RFC 4180 corners it does support are worth pinning down —
 * particularly the ones a spreadsheet actually emits: a UTF-8 BOM from Excel,
 * CRLF line endings, quoted fields containing commas and newlines, and doubled
 * quotes.
 */

describe('parseCsv', () => {
  it('reads a simple file', () => {
    const { headers, rows } = parseCsv('name,phone\nRavi,9843011111\nMeena,9843022222\n')
    expect(headers).toEqual(['name', 'phone'])
    expect(rows).toEqual([
      { name: 'Ravi', phone: '9843011111' },
      { name: 'Meena', phone: '9843022222' },
    ])
  })

  it('lower-cases and trims headers so capitalisation does not matter', () => {
    const { headers, rows } = parseCsv('  Name , Owner Email \nRavi,a@b.c\n')
    expect(headers).toEqual(['name', 'owner email'])
    expect(rows[0]).toEqual({ name: 'Ravi', 'owner email': 'a@b.c' })
  })

  it('strips the BOM Excel writes', () => {
    // Left in place the BOM becomes part of the first header name and every
    // lookup against that column silently misses.
    const { headers } = parseCsv('﻿name,phone\nRavi,98430\n')
    expect(headers).toEqual(['name', 'phone'])
  })

  it('handles CRLF', () => {
    const { rows } = parseCsv('name,phone\r\nRavi,9843011111\r\n')
    expect(rows).toEqual([{ name: 'Ravi', phone: '9843011111' }])
  })

  it('handles a quoted field containing a comma', () => {
    const { rows } = parseCsv('name,address\n"Kumar, Ravi","12 Main St, Erode"\n')
    expect(rows[0]).toEqual({ name: 'Kumar, Ravi', address: '12 Main St, Erode' })
  })

  it('handles a doubled quote inside a quoted field', () => {
    const { rows } = parseCsv('name\n"Ravi ""The Boss"" Kumar"\n')
    expect(rows[0].name).toBe('Ravi "The Boss" Kumar')
  })

  it('handles a newline inside a quoted field', () => {
    const { rows } = parseCsv('name,notes\nRavi,"line one\nline two"\n')
    expect(rows).toHaveLength(1)
    expect(rows[0].notes).toBe('line one\nline two')
  })

  it('reads a final row with no trailing newline', () => {
    const { rows } = parseCsv('name\nRavi')
    expect(rows).toEqual([{ name: 'Ravi' }])
  })

  it('pads a short row rather than failing the file', () => {
    // A trailing empty column is the commonest thing a spreadsheet emits.
    const { rows } = parseCsv('name,phone,email\nRavi,9843011111\n')
    expect(rows[0]).toEqual({ name: 'Ravi', phone: '9843011111', email: '' })
  })

  it('reports a row with MORE cells than the header', () => {
    const { rows, malformedRows } = parseCsv('name,phone\nRavi,98430,extra\n')
    expect(malformedRows).toEqual([1])
    expect(rows[0]).toEqual({ name: 'Ravi', phone: '98430' })
  })

  it('skips blank lines', () => {
    const { rows } = parseCsv('name\nRavi\n\n\nMeena\n')
    expect(rows).toEqual([{ name: 'Ravi' }, { name: 'Meena' }])
  })

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [], malformedRows: [] })
    expect(parseCsv('\n\n')).toEqual({ headers: [], rows: [], malformedRows: [] })
  })

  it('round-trips what toCsv produced, formula guard and all', () => {
    const csv = toCsv(
      [
        { key: 'name', header: 'name', value: (row: { name: string }) => row.name },
      ],
      [{ name: '=HYPERLINK("http://evil")' }],
    )
    const { rows } = parseCsv(csv)
    // The apostrophe survives: it is what stops the spreadsheet executing the
    // cell, and re-importing must not silently strip it.
    expect(rows[0].name).toBe('\'=HYPERLINK("http://evil")')
  })
})
