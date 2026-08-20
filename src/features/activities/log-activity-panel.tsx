'use client'

import { useState } from 'react'

import type { UploadRequest, UploadTicket } from '@/components/shared/file-upload'
import { Button } from '@/components/ui/button'
import { LogActivityForm } from './log-activity-form'
import type { FormState } from '@/lib/form-state'
import type { ActivityType } from '@/types/domain'

/**
 * The "Log activity" affordance on a record page (§11.5).
 *
 * A disclosure rather than a modal: on a phone a bottom sheet that covers the
 * record hides the very context the salesperson is looking at while they type.
 *
 * **Context is inferred, never chosen** (§10.2) — the account, project and
 * opportunity come from the page and are bound into the action on the server.
 * The salesperson never picks a foreign key.
 */
export function LogActivityPanel({
  action,
  opportunities,
  defaultOpportunityId,
  defaultType,
  label = 'Log activity',
  requestPhotoUpload,
  attachPhoto,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>
  opportunities: { id: string; title: string; stage: string }[]
  defaultOpportunityId?: string | null
  defaultType?: ActivityType
  label?: string
  requestPhotoUpload?: (input: UploadRequest) => Promise<UploadTicket>
  attachPhoto?: (input: { entityId: string; path: string }) => Promise<string[]>
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }

  return (
    <div className="w-full rounded-lg border border-border p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">What happened?</h3>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <LogActivityForm
        action={action}
        opportunities={opportunities}
        defaultOpportunityId={defaultOpportunityId}
        defaultType={defaultType}
        onDone={() => setOpen(false)}
        requestPhotoUpload={requestPhotoUpload}
        attachPhoto={attachPhoto}
      />
    </div>
  )
}
