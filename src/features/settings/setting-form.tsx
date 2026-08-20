'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state'

/**
 * One editable setting (§5.10).
 *
 * **Changing any of these must never require a deploy** — that is the whole
 * reason `system_settings` exists and the reason no threshold in this repository
 * is a constant (CLAUDE.md §3). The owner summary hour is the clearest case:
 * `vercel.json` fires the route hourly and the value here decides which hour
 * actually sends (ADR-011).
 */
export function SettingForm({
  settingKey,
  label,
  description,
  value,
  action,
  kind,
}: {
  settingKey: string
  label: string
  description: string
  value: unknown
  action: (previous: FormState, formData: FormData) => Promise<FormState>
  kind: 'number' | 'lines' | 'json' | 'schedule'
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE)

  return (
    <form action={formAction} className="flex flex-col gap-2 border-b border-border py-4 last:border-0">
      <Field
        label={label}
        htmlFor={settingKey}
        hint={description}
        error={state.fieldErrors.value ?? state.fieldErrors[settingKey]}
      >
        {kind === 'number' ? (
          <Input
            id={settingKey}
            name="value"
            type="number"
            min={0}
            defaultValue={String(value ?? '')}
          />
        ) : kind === 'lines' ? (
          <Textarea
            id={settingKey}
            name="value"
            rows={6}
            defaultValue={(Array.isArray(value) ? value : []).join('\n')}
          />
        ) : kind === 'json' ? (
          <Textarea
            id={settingKey}
            name="value"
            rows={5}
            className="font-mono text-xs"
            defaultValue={JSON.stringify(value, null, 2)}
          />
        ) : (
          <ScheduleFields value={value as { cadence?: string; hour?: number } | null} />
        )}
      </Field>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="text-sm text-emerald-700">Saved.</p> : null}

      <div>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

function ScheduleFields({ value }: { value: { cadence?: string; hour?: number } | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Select
        name="cadence"
        aria-label="Cadence"
        defaultValue={value?.cadence ?? 'daily'}
        options={[
          { value: 'daily', label: 'Every day' },
          { value: 'weekly', label: 'Mondays' },
        ]}
      />
      <Select
        name="hour"
        aria-label="Hour (IST)"
        defaultValue={String(value?.hour ?? 19)}
        options={Array.from({ length: 24 }, (_, hour) => ({
          value: String(hour),
          label: `${String(hour).padStart(2, '0')}:00 IST`,
        }))}
      />
      {/* The form posts `cadence` and `hour`; `value` is unused for this kind. */}
      <input type="hidden" name="value" value="schedule" />
    </div>
  )
}
