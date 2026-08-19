import type { Metadata } from 'next'

import { NotImplemented } from '../not-implemented'

export const metadata: Metadata = { title: 'Settings · JSK CRM' }

/** The administrator landing screen (§12.2, decision M-01). */
export default function SettingsPage() {
  return <NotImplemented screen="Settings" phase="Master Phase 5" />
}
