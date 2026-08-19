import type { Metadata } from 'next'

import { NotImplemented } from '../not-implemented'

export const metadata: Metadata = { title: 'Reports · JSK CRM' }

/**
 * Not built in Master Phase 2 — and deliberately showing nothing rather than a
 * mock (CLAUDE.md §15). A screen that is not built must look unbuilt.
 */
export default function Page() {
  return <NotImplemented screen="Reports" phase="a later master phase" />
}
