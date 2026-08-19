import type { Metadata } from 'next'

import { NotImplemented } from '../not-implemented'

export const metadata: Metadata = { title: 'Dashboard · JSK CRM' }

/** The manager and owner landing screen (§13.3, §13.4). */
export default function DashboardPage() {
  return <NotImplemented screen="Dashboard" phase="Master Phase 4" />
}
