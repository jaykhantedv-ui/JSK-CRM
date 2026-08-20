'use client'

import { FileText, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { FileUpload, type UploadRequest, type UploadTicket } from '@/components/shared/file-upload'
import { Button } from '@/components/ui/button'
import { displayFileName } from '@/lib/files'

/**
 * Quotation files on an opportunity (§8.6, §11.5).
 *
 * The list is paths, not URLs. **There are no public URLs in this system** — a
 * link is minted on click, lives for sixty seconds, and is never rendered into
 * the page. A URL baked into HTML survives in a browser history and a shared
 * screenshot long after the sixty seconds that were supposed to bound it.
 *
 * Nothing here offers a delete. `storage.objects` has no delete policy and
 * neither does anything else in the schema (CLAUDE.md §11).
 */
export function QuotationFiles({
  opportunityId,
  paths,
  canUpload,
  requestUpload,
  attach,
  getUrl,
}: {
  opportunityId: string
  paths: string[]
  canUpload: boolean
  requestUpload: (input: UploadRequest) => Promise<UploadTicket>
  attach: (input: { entityId: string; path: string }) => Promise<string[]>
  getUrl: (path: string) => Promise<string>
}) {
  const [files, setFiles] = useState(paths)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function open(path: string) {
    setOpening(path)
    setError(null)
    try {
      const url = await getUrl(path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setError('That file could not be opened. It may have been moved.')
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No quotation file attached.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((path) => (
            <li key={path}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => open(path)}
                disabled={opening === path}
              >
                {opening === path ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <FileText className="size-4" aria-hidden />
                )}
                <span className="truncate">{displayFileName(path)}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {canUpload ? (
        <FileUpload
          entityId={opportunityId}
          requestUpload={requestUpload}
          attach={attach}
          label="Attach quotation"
          accept="application/pdf,image/jpeg,image/png"
          onAttached={setFiles}
        />
      ) : null}
    </div>
  )
}
