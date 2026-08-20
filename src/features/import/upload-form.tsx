'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Select } from '@/components/ui/field'
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '@/lib/files'
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state'

/**
 * Step 1 of §20.1: upload.
 *
 * Nothing is created in the business tables here. The file is parsed, validated
 * and stored as `import_rows` for review — the customers appear only after a
 * person has looked at the preview and pressed the button on the next screen.
 */
export function ImportUploadForm({
  action,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE)

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="What are you importing?" htmlFor="entity">
        <Select
          id="entity"
          name="entity"
          defaultValue="accounts"
          options={[
            { value: 'accounts', label: 'Customers' },
            { value: 'contacts', label: 'Contacts' },
          ]}
        />
      </Field>

      <Field
        label="CSV file"
        htmlFor="file"
        error={state.fieldErrors.file}
        hint={`Up to ${Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))} MB and ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} rows.`}
      >
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm"
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? 'Checking the file…' : 'Upload and check'}
      </Button>
    </form>
  )
}
