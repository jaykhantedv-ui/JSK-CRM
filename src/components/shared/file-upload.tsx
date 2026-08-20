'use client'

import { Loader2, Paperclip, RotateCcw, TriangleAlert } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES, SIGNATURE_BYTES } from '@/lib/files'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

/**
 * The upload control (ADR-005).
 *
 * **This is the single approved exception to "no client-side Supabase writes"**
 * (CLAUDE.md §7): a 10 MB file exceeds the platform request-body limit, so the
 * bytes go straight from the browser to Storage. Everything else stays on the
 * server:
 *
 *   1. `requestUpload` — a Server Action. It checks that this user can see the
 *      parent entity, validates the file, and returns a short-lived signed URL
 *      naming ONE path. Nothing about the URL lets the browser write anywhere
 *      else.
 *   2. the browser PUTs the bytes to that URL.
 *   3. `attach` — a Server Action. **The database row that references the file is
 *      written here, never by the browser**, and only after the server has
 *      re-checked the bytes Storage actually holds.
 *
 * Both actions arrive as props rather than being imported. `components/shared`
 * is reachable from every feature, and importing one feature's actions into it
 * would make every other feature depend on that feature (§18).
 *
 * **A failed upload never costs the user their work** (§11.5). This control only
 * ever appears once the parent record is committed, and a failure leaves a
 * `Retry` button and the record untouched.
 */

export type UploadRequest = {
  entityId: string
  fileName: string
  size: number
  mimeType: string
  /** The first bytes, base64. The server checks them before issuing a URL. */
  head: string
}

export type UploadTicket = { path: string; token: string }

type Status =
  | { state: 'idle' }
  | { state: 'busy'; fileName: string }
  | { state: 'failed'; fileName: string; message: string }

export function FileUpload({
  entityId,
  requestUpload,
  attach,
  label = 'Add a file',
  accept = ALLOWED_MIME_TYPES.join(','),
  multiple = true,
  onAttached,
}: {
  entityId: string
  requestUpload: (input: UploadRequest) => Promise<UploadTicket>
  attach: (input: { entityId: string; path: string }) => Promise<string[]>
  label?: string
  accept?: string
  multiple?: boolean
  onAttached?: (paths: string[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const [lastFile, setLastFile] = useState<File | null>(null)

  const upload = useCallback(
    async (file: File) => {
      setLastFile(file)
      setStatus({ state: 'busy', fileName: file.name })

      try {
        if (file.size > MAX_FILE_BYTES) {
          throw new Error(`Files must be ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB or smaller.`)
        }

        // The first bytes, so the server can check what this file really is
        // before it hands out a URL. The server checks the stored bytes again
        // afterwards — this half is the specified gate, not the guarantee.
        const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer())
        const ticket = await requestUpload({
          entityId,
          fileName: file.name,
          size: file.size,
          mimeType: file.type,
          head: btoa(String.fromCharCode(...head)),
        })

        const supabase = createSupabaseBrowserClient()
        const { error } = await supabase.storage
          .from('crm-files')
          .uploadToSignedUrl(ticket.path, ticket.token, file)

        if (error) throw new Error(error.message)

        const paths = await attach({ entityId, path: ticket.path })
        onAttached?.(paths)
        setStatus({ state: 'idle' })
        setLastFile(null)
      } catch (error) {
        setStatus({
          state: 'failed',
          fileName: file.name,
          message: error instanceof Error ? error.message : 'The upload did not finish.',
        })
      }
    },
    [attach, entityId, onAttached, requestUpload],
  )

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={async (event) => {
          const files = [...(event.target.files ?? [])]
          // Reset first: picking the same file twice after a failure must still
          // fire `change`.
          event.target.value = ''
          for (const file of files) await upload(file)
        }}
      />

      <Button
        type="button"
        variant="secondary"
        onClick={() => inputRef.current?.click()}
        disabled={status.state === 'busy'}
      >
        {status.state === 'busy' ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Uploading {status.fileName}…
          </>
        ) : (
          <>
            <Paperclip className="size-4" aria-hidden />
            {label}
          </>
        )}
      </Button>

      {status.state === 'failed' ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <strong className="font-medium">{status.fileName}</strong> was not attached.{' '}
              {status.message}
              <br />
              Everything else you entered is saved.
            </span>
          </p>
          {lastFile ? (
            <Button type="button" variant="secondary" onClick={() => upload(lastFile)}>
              <RotateCcw className="size-4" aria-hidden />
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        JPG, PNG, WebP or PDF · up to {Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB
      </p>
    </div>
  )
}
